"""
book_editor.py — Fixed & improved version
Key fixes:
  1. BUG FIX: _estimate_tokens received an int (total_chars) but called len() on it →
     TypeError 'object of type int has no len()'. Fixed by accepting int or str.
  2. BUG FIX: chapter content fields that are None or non-str crashed len() inside
     apply_edit. Added defensive str-coercion before all len() calls.
  3. BUG FIX: conversation_history messages with non-string 'content' were passed raw
     to the OpenAI API. Now sanitised to str and invalid roles are filtered out.
  4. IMPROVEMENT: _edit_single_chapter retries once on transient API errors instead of
     silently falling back immediately.
  5. IMPROVEMENT: max_tokens for chapter edits now scales with chapter length
     (up to 8192) instead of a hard-coded 4096, preventing truncated outputs.
  6. IMPROVEMENT: Return values from _edit_single_chapter always coerce title/content
     to str so downstream PDF/DOCX generators never receive unexpected types.
"""

import os
import re
import json
import uuid
import shutil
import zipfile
import datetime
from pathlib import Path
from typing import Optional

# pyrefly: ignore [missing-import]
from openai import OpenAI
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"

# ─────────────────────────────────────────────────────────────────────────────
# Text extraction (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_from_docx(path: str) -> str:
    # pyrefly: ignore [missing-import]
    from docx import Document
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_text_from_pdf(path: str) -> str:
    # pyrefly: ignore [missing-import]
    import pdfplumber
    text = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text.append(t)
    return "\n".join(text)


def extract_text_from_zip(path: str) -> str:
    texts = []
    scratch = os.path.join(os.path.dirname(path), f"zip_ed_{uuid.uuid4().hex}")
    os.makedirs(scratch, exist_ok=True)
    try:
        with zipfile.ZipFile(path, "r") as z:
            for name in sorted(z.namelist()):
                ext = Path(name).suffix.lower()
                if ext not in {".txt", ".md", ".docx", ".pdf"}:
                    continue
                tmp = os.path.join(scratch, f"f{uuid.uuid4().hex}{ext}")
                with z.open(name) as src, open(tmp, "wb") as dst:
                    dst.write(src.read())
                if ext == ".docx":
                    texts.append(extract_text_from_docx(tmp))
                elif ext == ".pdf":
                    texts.append(extract_text_from_pdf(tmp))
                else:
                    with open(tmp, "r", encoding="utf-8", errors="replace") as f:
                        texts.append(f.read())
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return "\n\n".join(texts)


def extract_book_text(file_path: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".docx":
        return extract_text_from_docx(file_path)
    elif ext == ".pdf":
        return extract_text_from_pdf(file_path)
    elif ext == ".zip":
        return extract_text_from_zip(file_path)
    else:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()


# ─────────────────────────────────────────────────────────────────────────────
# Parse raw text into structured chapters
# ─────────────────────────────────────────────────────────────────────────────

PARSE_SYSTEM = """You are a book structure parser.
Given raw extracted book text, output ONLY valid JSON:
{
  "title": "<book title — infer from content or use 'Untitled'>",
  "author": "<author name if present, else ''>",
  "chapters": [
    {
      "chapter_number": 1,
      "title": "<chapter title>",
      "content": "<full chapter text with paragraphs separated by \\n\\n>"
    }
  ]
}
Rules:
- If no chapter breaks exist, treat the whole text as a single chapter titled 'Full Text'.
- Preserve every word of the original text.
- Do NOT summarise or alter content.
"""

def parse_book_structure(raw_text: str, filename: str = "") -> dict:
    sample = raw_text[:80000]
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": PARSE_SYSTEM},
                {"role": "user", "content": f"Parse this book text:\n\n{sample}"},
            ],
            max_tokens=4096,
        )
        raw = resp.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        s = raw.find("{"); e = raw.rfind("}") + 1
        if s == -1 or e == 0:
            raise ValueError("No JSON")
        return json.loads(raw[s:e])
    except Exception as ex:
        print(f"  ⚠️  parse_book_structure fallback: {ex}")
        title = Path(filename).stem.replace("_", " ").replace("-", " ").title() if filename else "Untitled"
        chapters = []
        ch_pattern = re.split(r"(?i)(chapter\s+\w+[^\n]*)", raw_text)
        if len(ch_pattern) > 1:
            for i in range(1, len(ch_pattern), 2):
                ch_title = ch_pattern[i].strip()
                ch_body = ch_pattern[i + 1].strip() if i + 1 < len(ch_pattern) else ""
                chapters.append({"chapter_number": (i // 2) + 1, "title": ch_title, "content": ch_body})
        if not chapters:
            chapters = [{"chapter_number": 1, "title": "Full Text", "content": raw_text}]
        return {"title": title, "author": "", "chapters": chapters}


# ─────────────────────────────────────────────────────────────────────────────
# JSON repair utilities
# ─────────────────────────────────────────────────────────────────────────────

def _try_parse_json(text: str) -> Optional[dict]:
    """Attempt multiple strategies to extract valid JSON from text."""
    # Strategy 1: direct parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # Strategy 2: find outermost braces
    s = text.find("{")
    e = text.rfind("}") + 1
    if s != -1 and e > s:
        try:
            return json.loads(text[s:e])
        except Exception:
            pass

    # Strategy 3: try to repair truncated JSON by closing open structures
    if s != -1:
        truncated = text[s:]
        repaired = _repair_truncated_json(truncated)
        if repaired:
            try:
                return json.loads(repaired)
            except Exception:
                pass

    return None


def _repair_truncated_json(text: str) -> Optional[str]:
    """
    Attempt to repair JSON that was cut off mid-stream.
    Closes unclosed strings, arrays, and objects.
    """
    # Count open/close braces and brackets
    in_string = False
    escape_next = False
    depth_brace = 0
    depth_bracket = 0

    result = list(text)
    i = 0
    while i < len(result):
        ch = result[i]
        if escape_next:
            escape_next = False
        elif ch == '\\' and in_string:
            escape_next = True
        elif ch == '"':
            in_string = not in_string
        elif not in_string:
            if ch == '{':
                depth_brace += 1
            elif ch == '}':
                depth_brace -= 1
            elif ch == '[':
                depth_bracket += 1
            elif ch == ']':
                depth_bracket -= 1
        i += 1

    # If we're inside a string, close it
    suffix = ""
    if in_string:
        suffix += '"'

    # Close open brackets and braces
    suffix += "]" * depth_bracket
    suffix += "}" * depth_brace

    if suffix:
        return text + suffix
    return text


# ─────────────────────────────────────────────────────────────────────────────
# Single-chapter editor (processes one chapter at a time for large books)
# ─────────────────────────────────────────────────────────────────────────────

CHAPTER_EDIT_SYSTEM = """You are an expert book editor. You will receive ONE chapter of a book and an edit instruction.

Apply the instruction to this chapter ONLY.
Return ONLY valid JSON — no markdown, no explanation:
{
  "title": "<chapter title, updated if requested>",
  "content": "<full chapter content after edit, newlines as \\n>",
  "changed": true
}

If the instruction doesn't apply to this chapter, return the chapter unchanged with "changed": false.
CRITICAL: Return complete content, never truncate with placeholders.
"""

def _edit_single_chapter(chapter: dict, instruction: str, book_title: str, chapter_idx: int, total_chapters: int) -> dict:
    """Edit a single chapter. Returns the (possibly modified) chapter dict."""
    # Trim very long chapters to fit context
    content = chapter.get("content", "")
    if not isinstance(content, str):
        content = str(content or "")
    max_content = 30000
    truncated = len(content) > max_content
    if truncated:
        content = content[:max_content] + "\n\n[REST OF CHAPTER — preserve in output]"

    payload = json.dumps({
        "title": chapter.get("title", ""),
        "content": content
    }, ensure_ascii=False)

    messages = [
        {"role": "system", "content": CHAPTER_EDIT_SYSTEM},
        {"role": "user", "content": (
            f"Book: \"{book_title}\" | Chapter {chapter_idx + 1} of {total_chapters}\n"
            f"Edit instruction: {instruction}\n\n"
            f"Chapter JSON:\n{payload}"
        )}
    ]

    # Scale max_tokens to chapter length so long chapters aren't truncated
    estimated_output_tokens = min(8192, max(2048, len(content) // 3))

    last_exc = None
    for attempt in range(2):  # retry once on transient errors
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                max_tokens=estimated_output_tokens,
                temperature=0.7,
            )
            raw = resp.choices[0].message.content.strip()
            raw = re.sub(r'^```json\s*', '', raw, flags=re.IGNORECASE)
            raw = re.sub(r'\s*```$', '', raw)

            result = _try_parse_json(raw)
            if result and isinstance(result, dict):
                return {
                    "chapter_number": chapter.get("chapter_number", chapter_idx + 1),
                    "title": str(result.get("title", chapter.get("title", ""))),
                    "content": str(result.get("content", chapter.get("content", ""))),
                    "_changed": result.get("changed", True),
                }
        except Exception as ex:
            last_exc = ex
            print(f"  Warning: Chapter {chapter_idx + 1} edit attempt {attempt + 1} failed: {ex}")

    if last_exc:
        print(f"  Error: Chapter {chapter_idx + 1} permanently failed, keeping original. Error: {last_exc}")

    # Return original chapter on failure — ensure content is a str
    return {**chapter, "content": content, "_changed": False}


# ─────────────────────────────────────────────────────────────────────────────
# Whole-book editor (for small books — original approach, improved)
# ─────────────────────────────────────────────────────────────────────────────

EDITOR_SYSTEM = """You are an expert book editor and author assistant.
The user provides a book (as structured JSON) and a natural-language edit instruction.

You MUST:
1. Apply the requested edit faithfully and thoroughly.
2. Keep all other content EXACTLY as-is unless explicitly asked to change it.
3. If asked to change the theme/style (e.g. 'make it sci-fi', 'romantic tone', 'academic'), rewrite chapter content in that style while preserving the plot/facts/structure.
4. IMPORTANT: Always return the COMPLETE book with ALL chapters fully written out.

Respond ONLY with valid JSON:
{
  "title": "<book title>",
  "author": "<author>",
  "chapters": [
    {
      "chapter_number": 1,
      "title": "<chapter title>",
      "content": "<full chapter content after edit, newlines as \\n>"
    }
  ],
  "edit_summary": "<2-3 sentence summary of what you changed>",
  "chapters_changed": [<list of chapter numbers that were modified>]
}
CRITICAL: Return valid JSON. Never truncate content with placeholders.
"""


def _estimate_tokens(text) -> int:
    """Rough token estimate: ~4 chars per token.
    Accepts either a string or a pre-computed character count (int).
    """
    if isinstance(text, int):
        return text // 4
    if not isinstance(text, str):
        text = str(text)
    return len(text) // 4


def apply_edit(
    book_structure: dict,
    user_instruction: str,
    conversation_history: list[dict],
) -> dict:
    """
    Apply a natural-language edit instruction to the book structure.
    
    Strategy:
    - Small books (< 8k tokens): send whole book to GPT in one shot
    - Large books: edit chapter by chapter, then synthesize summary
    """
    chapters = book_structure.get("chapters", [])
    book_title = book_structure.get("title", "Untitled")

    # Safely coerce every chapter's content to str before measuring
    for ch in chapters:
        if not isinstance(ch.get("content"), str):
            ch["content"] = str(ch.get("content") or "")

    total_chars = sum(len(ch.get("content", "")) for ch in chapters)
    estimated_tokens = _estimate_tokens(total_chars)

    print(f"  📚 Book: {len(chapters)} chapters, ~{estimated_tokens} tokens")

    # For large books, edit chapter by chapter
    if estimated_tokens > 6000 or len(chapters) > 3:
        return _apply_edit_chunked(book_structure, user_instruction, conversation_history)

    # For small books, use the original whole-book approach
    return _apply_edit_whole_book(book_structure, user_instruction, conversation_history)


def _apply_edit_whole_book(
    book_structure: dict,
    user_instruction: str,
    conversation_history: list[dict],
) -> dict:
    """Edit small books in a single API call."""
    book_json = json.dumps(book_structure, ensure_ascii=False)

    # Trim if still too large
    if len(book_json) > 50000:
        book_json = book_json[:50000] + '...(truncated)}'

    recent_history = conversation_history[-4:] if len(conversation_history) > 4 else conversation_history
    # Ensure every history message has a string 'content' (OpenAI rejects non-strings)
    safe_history = [
        {**msg, "content": str(msg.get("content") or "")}
        for msg in recent_history
        if isinstance(msg, dict) and msg.get("role") in ("user", "assistant", "system")
    ]
    messages = [{"role": "system", "content": EDITOR_SYSTEM}]
    for msg in safe_history:
        messages.append(msg)
    messages.append({
        "role": "user",
        "content": f"Current book (JSON):\n{book_json}\n\nEdit instruction: {user_instruction}"
    })

    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=4096,
        temperature=0.7,
    )
    raw = resp.choices[0].message.content.strip()
    raw = re.sub(r'^```json\s*', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'\s*```$', '', raw)

    result = _try_parse_json(raw)
    if result and isinstance(result, dict) and "chapters" in result:
        return result

    raise ValueError(
        "The AI returned an invalid response for this edit. "
        "Try breaking your request into smaller, more specific edits."
    )


def _apply_edit_chunked(
    book_structure: dict,
    user_instruction: str,
    conversation_history: list[dict],
) -> dict:
    """
    Edit large books chapter by chapter.
    Returns a merged result dict with edit_summary and chapters_changed.
    """
    chapters = book_structure.get("chapters", [])
    book_title = book_structure.get("title", "Untitled")
    author = book_structure.get("author", "")

    updated_chapters = []
    changed_chapter_numbers = []

    print(f"  🔄 Chunked edit: processing {len(chapters)} chapters individually...")

    for idx, chapter in enumerate(chapters):
        print(f"    Chapter {idx + 1}/{len(chapters)}: {chapter.get('title', '')[:40]}")
        result_ch = _edit_single_chapter(chapter, user_instruction, book_title, idx, len(chapters))

        ch_number = result_ch.get("chapter_number", idx + 1)
        if result_ch.pop("_changed", False):
            changed_chapter_numbers.append(ch_number)

        updated_chapters.append(result_ch)

    # Generate a summary of the changes
    edit_summary = _generate_edit_summary(user_instruction, changed_chapter_numbers, book_title)

    return {
        "title": book_title,
        "author": author,
        "chapters": updated_chapters,
        "edit_summary": edit_summary,
        "chapters_changed": changed_chapter_numbers,
    }


def _generate_edit_summary(instruction: str, changed_chapters: list, book_title: str) -> str:
    """Generate a short summary of what was edited."""
    if not changed_chapters:
        return f"The edit '{instruction}' was applied. No chapters required significant changes."

    ch_list = ", ".join(f"Chapter {n}" for n in changed_chapters[:5])
    if len(changed_chapters) > 5:
        ch_list += f" and {len(changed_chapters) - 5} more"

    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{
                "role": "user",
                "content": (
                    f"Write a 2-sentence summary of this book edit:\n"
                    f"Book: '{book_title}'\n"
                    f"Edit instruction: '{instruction}'\n"
                    f"Chapters modified: {ch_list}\n"
                    f"Keep it concise and professional."
                )
            }],
            max_tokens=150,
            temperature=0.5,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return f"Applied '{instruction}' to {ch_list}."


# ─────────────────────────────────────────────────────────────────────────────
# Theme definitions (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

THEMES = {
    "normal":     {"bg": "#FFFFFF", "accent": "#374151", "title_col": "#111827", "body_col": "#374151", "font_body": "Helvetica",        "font_head": "Helvetica-Bold"},
    "premium":    {"bg": "#FAFAF8", "accent": "#1D4ED8", "title_col": "#0F172A", "body_col": "#1E293B", "font_body": "Helvetica",        "font_head": "Helvetica-Bold"},
    "scifi":      {"bg": "#050A14", "accent": "#00D4FF", "title_col": "#00D4FF", "body_col": "#A0C8E0", "font_body": "Courier",          "font_head": "Courier-Bold"},
    "fantasy":    {"bg": "#0D0A1A", "accent": "#C084FC", "title_col": "#E9D5FF", "body_col": "#DDD6FE", "font_body": "Helvetica",        "font_head": "Helvetica-Bold"},
    "romance":    {"bg": "#FFF5F5", "accent": "#E11D48", "title_col": "#9F1239", "body_col": "#4C0519", "font_body": "Helvetica-Oblique", "font_head": "Helvetica-Bold"},
    "thriller":   {"bg": "#0A0A0A", "accent": "#EF4444", "title_col": "#FAFAFA", "body_col": "#D1D5DB", "font_body": "Helvetica",        "font_head": "Helvetica-Bold"},
    "academic":   {"bg": "#F9FAFB", "accent": "#1E40AF", "title_col": "#1E3A5F", "body_col": "#374151", "font_body": "Times-Roman",      "font_head": "Times-Bold"},
    "minimalist": {"bg": "#FFFFFF", "accent": "#000000", "title_col": "#000000", "body_col": "#333333", "font_body": "Helvetica",        "font_head": "Helvetica"},
    "vibrant":    {"bg": "#1A0533", "accent": "#F59E0B", "title_col": "#FDE68A", "body_col": "#FEF3C7", "font_body": "Helvetica",        "font_head": "Helvetica-Bold"},
    "retro":      {"bg": "#FDF6E3", "accent": "#B45309", "title_col": "#78350F", "body_col": "#451A03", "font_body": "Courier",          "font_head": "Courier-Bold"},
}


def _hex_to_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))


# ─────────────────────────────────────────────────────────────────────────────
# PDF generator (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def generate_edited_pdf(book: dict, output_path: str, theme_name: str = "premium") -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, HRFlowable
    from reportlab.lib.colors import HexColor

    theme = THEMES.get(theme_name, THEMES["premium"])
    BG     = HexColor(theme["bg"])
    ACCENT = HexColor(theme["accent"])
    TITLE  = HexColor(theme["title_col"])
    BODY   = HexColor(theme["body_col"])
    MARGIN = 22 * mm

    def S(name, **kw): return ParagraphStyle(name, **kw)

    cover_title = S("ct", fontName=theme["font_head"], fontSize=30, textColor=TITLE,   leading=38, alignment=TA_CENTER, spaceAfter=8)
    cover_sub   = S("cs", fontName=theme["font_body"], fontSize=12, textColor=BODY,    leading=16, alignment=TA_CENTER)
    ch_label    = S("cl", fontName=theme["font_body"], fontSize=10, textColor=ACCENT,  leading=14, spaceBefore=0, spaceAfter=3)
    ch_title_s  = S("cht",fontName=theme["font_head"], fontSize=20, textColor=TITLE,   leading=26, spaceBefore=2, spaceAfter=5)
    body_s      = S("bs", fontName=theme["font_body"], fontSize=10.5, textColor=BODY,  leading=17, spaceAfter=8, alignment=TA_JUSTIFY)

    def on_cover(canvas, doc):
        w, h = A4
        r, g, b = _hex_to_rgb(theme["bg"])
        canvas.setFillColorRGB(r, g, b)
        canvas.rect(0, 0, w, h, fill=1, stroke=0)
        ar, ag, ab = _hex_to_rgb(theme["accent"])
        canvas.setFillColorRGB(ar, ag, ab)
        canvas.rect(0, h * 0.38, w, 3, fill=1, stroke=0)
        canvas.setFillColorRGB(max(0, r-0.05), max(0, g-0.05), max(0, b-0.05))
        canvas.rect(0, 0, w, 16 * mm, fill=1, stroke=0)
        canvas.setFillColorRGB(0.4, 0.4, 0.4)
        canvas.setFont("Helvetica", 8)
        canvas.drawCentredString(w / 2, 6 * mm, f"Edited with Editorial AI  ·  {datetime.date.today()}")

    def on_page(canvas, doc):
        w, h = A4
        canvas.saveState()
        r, g, b = _hex_to_rgb(theme["bg"])
        dark_r = max(0, r - 0.05); dark_g = max(0, g - 0.05); dark_b = max(0, b - 0.05)
        canvas.setFillColorRGB(dark_r, dark_g, dark_b)
        canvas.rect(0, 0, w, 9 * mm, fill=1, stroke=0)
        tr, tg, tb = _hex_to_rgb(theme["body_col"])
        canvas.setFillColorRGB(tr, tg, tb)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(MARGIN, 3 * mm, book.get("title", "Book"))
        canvas.drawRightString(w - MARGIN, 3 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=18 * mm,
        title=book.get("title", "Book"),
    )

    story = []
    story.append(Spacer(1, 52 * mm))
    story.append(Paragraph(book.get("title", "Untitled"), cover_title))
    story.append(Spacer(1, 5 * mm))
    if book.get("author"):
        story.append(Paragraph(f"by {book['author']}", cover_sub))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(f"Theme: {theme_name.title()}", cover_sub))
    story.append(PageBreak())

    for ch in book.get("chapters", []):
        story.append(Spacer(1, 8 * mm))
        story.append(Paragraph(f"Chapter {ch['chapter_number']}", ch_label))
        story.append(Paragraph(ch.get("title", ""), ch_title_s))
        story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=10))
        for para in ch.get("content", "").split("\n\n"):
            para = para.strip()
            if para:
                safe = para.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                story.append(Paragraph(safe, body_s))
        story.append(PageBreak())

    doc.build(story, onFirstPage=on_cover, onLaterPages=on_page)
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# DOCX generator (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def generate_edited_docx(book: dict, output_path: str, theme_name: str = "premium") -> str:
    # pyrefly: ignore [missing-import]
    from docx import Document
    # pyrefly: ignore [missing-import]
    from docx.shared import Pt, RGBColor, Cm
    # pyrefly: ignore [missing-import]
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    theme = THEMES.get(theme_name, THEMES["premium"])

    def rgb_from_hex(h):
        h = h.lstrip("#")
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    TITLE_RGB  = rgb_from_hex(theme["title_col"])
    BODY_RGB   = rgb_from_hex(theme["body_col"])
    ACCENT_RGB = rgb_from_hex(theme["accent"])

    doc = Document()
    section = doc.sections[0]
    section.page_height = Cm(29.7); section.page_width = Cm(21.0)
    section.left_margin = section.right_margin = Cm(2.5)
    section.top_margin = Cm(2.5); section.bottom_margin = Cm(2.0)

    style_n = doc.styles["Normal"]
    is_courier = "Courier" in theme["font_body"]
    style_n.font.name = "Courier New" if is_courier else "Calibri"
    style_n.font.size = Pt(11)

    for _ in range(4): doc.add_paragraph()
    t = doc.add_paragraph(); t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run(book.get("title", "Untitled"))
    r.font.size = Pt(26); r.font.bold = True; r.font.color.rgb = TITLE_RGB
    if book.get("author"):
        ap = doc.add_paragraph(); ap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        ar = ap.add_run(f"by {book['author']}"); ar.font.size = Pt(13); ar.font.color.rgb = BODY_RGB
    tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    tr = tp.add_run(f"Theme: {theme_name.title()}  ·  Edited {datetime.date.today().strftime('%B %d, %Y')}")
    tr.font.size = Pt(10); tr.font.italic = True; tr.font.color.rgb = ACCENT_RGB
    doc.add_page_break()

    for ch in book.get("chapters", []):
        lbl = doc.add_paragraph()
        lr = lbl.add_run(f"Chapter {ch['chapter_number']}")
        lr.font.size = Pt(10); lr.font.bold = True; lr.font.color.rgb = ACCENT_RGB

        heading = doc.add_heading(ch.get("title", ""), level=1)
        for run in heading.runs:
            run.font.color.rgb = TITLE_RGB

        doc.add_paragraph()
        for para in ch.get("content", "").split("\n\n"):
            para = para.strip()
            if para:
                p = doc.add_paragraph(para)
                p.style = doc.styles["Normal"]
                p.paragraph_format.space_after = Pt(6)
                p.paragraph_format.line_spacing = Pt(16)
                p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        doc.add_page_break()

    doc.save(output_path)
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# Main orchestrator
# ─────────────────────────────────────────────────────────────────────────────

def process_editor_turn(
    book_structure: dict,
    user_message: str,
    conversation_history: list[dict],
    output_dir: str,
    theme: str = "premium",
    job_id: str = "",
) -> dict:
    os.makedirs(output_dir, exist_ok=True)

    theme_keywords = list(THEMES.keys())
    detected_theme = theme
    msg_lower = user_message.lower()
    for kw in theme_keywords:
        if kw in msg_lower:
            detected_theme = kw
            break

    try:
        updated = apply_edit(book_structure, user_message, conversation_history)
    except Exception as e:
        raise ValueError(f"Edit failed: {str(e)}")

    edit_summary = updated.pop("edit_summary", "Changes applied.")
    chapters_changed = updated.pop("chapters_changed", [])

    safe_title = "".join(c for c in updated.get("title", "book") if c.isalnum() or c in (" ", "-", "_")).strip() or "book"
    version_id = job_id or uuid.uuid4().hex
    pdf_path  = os.path.join(output_dir, f"{safe_title}_{version_id}.pdf")
    docx_path = os.path.join(output_dir, f"{safe_title}_{version_id}.docx")

    generate_edited_pdf(updated, pdf_path, detected_theme)
    generate_edited_docx(updated, docx_path, detected_theme)

    return {
        "updated_book": updated,
        "edit_summary": edit_summary,
        "chapters_changed": chapters_changed,
        "pdf_path": pdf_path,
        "docx_path": docx_path,
        "theme": detected_theme,
    }