"""
book_editor.py
Conversational AI book editor.
- Accepts PDF / DOCX / ZIP input
- Extracts full text and structure
- Maintains multi-turn conversation history
- Processes natural-language edit commands:
    • Rewrite specific chapters or sections
    • Edit particular pages / paragraphs
    • Change writing style / tone / theme
    • Add new chapters or sections
    • Remove content
    • Translate the book
    • Change formatting theme (scifi, romance, academic, etc.)
- Re-generates PDF + DOCX after every successful edit turn
- Returns structured diff info + download paths
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
# Text extraction (reuses proofreader helpers where possible)
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
    # Truncate if huge (keep first ~80k chars for parsing)
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
        # Fallback: naive chapter split
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
# AI edit processor
# ─────────────────────────────────────────────────────────────────────────────

EDITOR_SYSTEM = """You are an expert book editor and author assistant.
The user provides a book (as structured JSON) and a natural-language edit instruction.

You MUST:
1. Apply the requested edit faithfully and thoroughly.
2. Keep all other content EXACTLY as-is unless explicitly asked to change it.
3. If asked to change the theme/style (e.g. 'make it sci-fi', 'romantic tone', 'academic'), rewrite
   chapter content in that style while preserving the plot/facts/structure.
4. If asked to edit specific chapters, pages, or paragraphs, locate and edit ONLY those.
5. If asked to add content, insert it at the appropriate location.
6. If asked to remove content, omit it cleanly.

Respond ONLY with valid JSON:
{
  "title": "<book title — update only if user explicitly asked>",
  "author": "<author>",
  "chapters": [
    {
      "chapter_number": 1,
      "title": "<chapter title>",
      "content": "<full chapter content after edit>"
    }
  ],
  "edit_summary": "<2-3 sentence plain English summary of what you changed>",
  "chapters_changed": [<list of chapter numbers that were modified>]
}
"""

def apply_edit(
    book_structure: dict,
    user_instruction: str,
    conversation_history: list[dict],
) -> dict:
    """
    Apply a natural-language edit instruction to the book structure.
    Returns updated book structure dict with extra keys: edit_summary, chapters_changed.
    """
    book_json = json.dumps(book_structure, ensure_ascii=False)

    # Keep last 6 turns of history to stay within context
    recent_history = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history

    messages = [{"role": "system", "content": EDITOR_SYSTEM}]
    for msg in recent_history:
        messages.append(msg)
    messages.append({
        "role": "user",
        "content": (
            f"Current book (JSON):\n{book_json[:40000]}\n\n"
            f"Edit instruction: {user_instruction}"
        ),
    })

    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=4096,
    )
    raw = resp.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    s = raw.find("{"); e = raw.rfind("}") + 1
    if s == -1 or e == 0:
        raise ValueError("No valid JSON returned from editor")
    result = json.loads(raw[s:e])
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Theme definitions for PDF/DOCX rendering
# ─────────────────────────────────────────────────────────────────────────────

THEMES = {
    "normal":     {"bg": "#FFFFFF", "accent": "#374151", "title_col": "#111827", "body_col": "#374151", "font_body": "Helvetica",       "font_head": "Helvetica-Bold"},
    "premium":    {"bg": "#FAFAF8", "accent": "#1D4ED8", "title_col": "#0F172A", "body_col": "#1E293B", "font_body": "Helvetica",       "font_head": "Helvetica-Bold"},
    "scifi":      {"bg": "#050A14", "accent": "#00D4FF", "title_col": "#00D4FF", "body_col": "#A0C8E0", "font_body": "Courier",         "font_head": "Courier-Bold"},
    "fantasy":    {"bg": "#0D0A1A", "accent": "#C084FC", "title_col": "#E9D5FF", "body_col": "#DDD6FE", "font_body": "Helvetica",       "font_head": "Helvetica-Bold"},
    "romance":    {"bg": "#FFF5F5", "accent": "#E11D48", "title_col": "#9F1239", "body_col": "#4C0519", "font_body": "Helvetica-Oblique","font_head": "Helvetica-Bold"},
    "thriller":   {"bg": "#0A0A0A", "accent": "#EF4444", "title_col": "#FAFAFA", "body_col": "#D1D5DB", "font_body": "Helvetica",       "font_head": "Helvetica-Bold"},
    "academic":   {"bg": "#F9FAFB", "accent": "#1E40AF", "title_col": "#1E3A5F", "body_col": "#374151", "font_body": "Times-Roman",     "font_head": "Times-Bold"},
    "minimalist": {"bg": "#FFFFFF", "accent": "#000000", "title_col": "#000000", "body_col": "#333333", "font_body": "Helvetica",       "font_head": "Helvetica"},
    "vibrant":    {"bg": "#1A0533", "accent": "#F59E0B", "title_col": "#FDE68A", "body_col": "#FEF3C7", "font_body": "Helvetica",       "font_head": "Helvetica-Bold"},
    "retro":      {"bg": "#FDF6E3", "accent": "#B45309", "title_col": "#78350F", "body_col": "#451A03", "font_body": "Courier",         "font_head": "Courier-Bold"},
}


def _hex_to_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))


# ─────────────────────────────────────────────────────────────────────────────
# PDF generator (theme-aware)
# ─────────────────────────────────────────────────────────────────────────────

def generate_edited_pdf(book: dict, output_path: str, theme_name: str = "premium") -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, HRFlowable
    from reportlab.lib.colors import HexColor, Color, white, black

    theme = THEMES.get(theme_name, THEMES["premium"])
    is_dark = _hex_to_rgb(theme["bg"])[0] < 0.5  # dark bg detection

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
    doc.title = book.get("title", "Book")

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
                story.append(Paragraph(para, body_s))
        story.append(PageBreak())

    doc.build(story, onFirstPage=on_cover, onLaterPages=on_page)
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# DOCX generator (theme-aware)
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

    # Cover
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
# Main orchestrator: process one chat turn
# ─────────────────────────────────────────────────────────────────────────────

def process_editor_turn(
    book_structure: dict,
    user_message: str,
    conversation_history: list[dict],
    output_dir: str,
    theme: str = "premium",
    job_id: str = "",
) -> dict:
    """
    Process one conversational editing turn.
    Returns:
    {
        "updated_book": <new book structure dict>,
        "edit_summary": "...",
        "chapters_changed": [...],
        "pdf_path": "...",
        "docx_path": "...",
        "version": <int>,
        "theme": "..."
    }
    """
    os.makedirs(output_dir, exist_ok=True)

    # Detect if user wants a theme change in the message
    theme_keywords = list(THEMES.keys())
    detected_theme = theme
    msg_lower = user_message.lower()
    for kw in theme_keywords:
        if kw in msg_lower:
            detected_theme = kw
            break

    # Apply the edit
    updated = apply_edit(book_structure, user_message, conversation_history)

    # Extract edit metadata
    edit_summary = updated.pop("edit_summary", "Changes applied.")
    chapters_changed = updated.pop("chapters_changed", [])

    # Generate outputs
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