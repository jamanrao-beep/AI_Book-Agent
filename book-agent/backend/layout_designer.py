"""
layout_designer.py  ·  v2.0
AI-powered internal book layout designer — with full book-type awareness.

Pipeline:
  1. Extract raw text from PDF / DOCX / ZIP
  2. Detect chapter boundaries
  3. Build book-type defaults (novel, academic, religious, poetry, children, business)
  4. Ask GPT-4o to produce a complete typographic layout concept (JSON),
     seeded with type-aware defaults and any user overrides
  5. Apply hard user overrides on top of the AI concept  (user always wins)
  6. Render PDF  (ReportLab)
  7. Render DOCX (python-docx)
  8. Return paths + metadata to the caller

Supported book_type values
  "novel"     | "academic"  | "religious" | "poetry" | "children" | "business"
  Any other / empty string → AI chooses freely.
"""

from __future__ import annotations

import io
import json
import math
import os
import re
import shutil
import unicodedata
import uuid
import zipfile
from pathlib import Path
from typing import Callable, Optional

# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
from openai import OpenAI

load_dotenv()
_api_key = os.getenv("OPENAI_API_KEY")
if not _api_key:
    raise RuntimeError(
        "OPENAI_API_KEY is not set. Add it to your .env file or environment variables."
    )
client = OpenAI(api_key=_api_key)
MODEL = "gpt-4o"


# ─────────────────────────────────────────────────────────────────────────────
# Book-type default profiles
# Every value here is a "strong suggestion" passed to the AI in the system
# prompt.  The user can still override any single field at will.
# ─────────────────────────────────────────────────────────────────────────────

BOOK_TYPE_PROFILES: dict[str, dict] = {
    "novel": {
        "_label": "Novel / Literary Fiction",
        "_description": (
            "A literary novel demands an intimate, reader-friendly interior. "
            "Use a warm cream page with a classic serif body font (Times-Roman), "
            "generous side margins, 1.5× line spacing, a chapter-opening drop cap, "
            "and a subtle ornamental divider.  Page numbers centred at the bottom.  "
            "Chapter headings should feel understated and elegant."
        ),
        "page_bg":             "#fffdf6",
        "text_color":          "#1c1a17",
        "chapter_title_color": "#2d2416",
        "accent_color":        "#8b6914",
        "body_font":           "Times-Roman",
        "body_font_size":      11.5,
        "line_spacing":        1.55,
        "first_para_indent_mm": 6,
        "margin_top_mm":       22,
        "margin_bottom_mm":    22,
        "margin_left_mm":      25,
        "margin_right_mm":     22,
        "chapter_font":        "Times-Roman",
        "chapter_font_size":   24,
        "chapter_prefix":      "Chapter",
        "show_drop_cap":       True,
        "ornament":            "—◆—",
        "header_text":         "",          # will be replaced by book title
        "show_page_numbers":   True,
    },

    "academic": {
        "_label": "Academic / Educational",
        "_description": (
            "An academic or educational book needs clear visual hierarchy and maximum "
            "readability.  White page background, sans-serif body font (Helvetica), "
            "structured numbered chapter headings, no drop cap, tight but comfortable "
            "1.4× spacing.  Running header with the book title; page numbers in the "
            "footer.  Accent colour should be a professional blue or teal.  "
            "No decorative ornaments."
        ),
        "page_bg":             "#ffffff",
        "text_color":          "#111827",
        "chapter_title_color": "#1e3a5f",
        "accent_color":        "#2563eb",
        "body_font":           "Helvetica",
        "body_font_size":      11,
        "line_spacing":        1.4,
        "first_para_indent_mm": 0,
        "margin_top_mm":       25,
        "margin_bottom_mm":    25,
        "margin_left_mm":      28,
        "margin_right_mm":     25,
        "chapter_font":        "Helvetica",
        "chapter_font_size":   20,
        "chapter_prefix":      "Chapter",
        "show_drop_cap":       False,
        "ornament":            "",
        "header_text":         "",
        "show_page_numbers":   True,
    },

    "religious": {
        "_label": "Religious / Spiritual",
        "_description": (
            "A religious or spiritual text calls for a reverent, traditional feel.  "
            "Warm ivory page, classic serif body (Times-Roman), generous margins, "
            "gold or saffron accent colour, ornate chapter-opening ornaments, "
            "decorative drop cap on every chapter.  Chapter prefix may be omitted "
            "or replaced with a verse reference.  Centred chapter titles with "
            "a double-rule accent below.  Comfortable 1.6× leading."
        ),
        "page_bg":             "#fef9f0",
        "text_color":          "#2d1f0a",
        "chapter_title_color": "#7c3d0a",
        "accent_color":        "#c8830a",
        "body_font":           "Times-Roman",
        "body_font_size":      11.5,
        "line_spacing":        1.6,
        "first_para_indent_mm": 5,
        "margin_top_mm":       24,
        "margin_bottom_mm":    24,
        "margin_left_mm":      28,
        "margin_right_mm":     28,
        "chapter_font":        "Times-Roman",
        "chapter_font_size":   22,
        "chapter_prefix":      "",
        "show_drop_cap":       True,
        "ornament":            "✦  ✦  ✦",
        "header_text":         "",
        "show_page_numbers":   True,
    },

    "poetry": {
        "_label": "Poetry / Shayari",
        "_description": (
            "A poetry collection must preserve the poet's line breaks and white space.  "
            "Soft off-white page, elegant italic serif (Times-Italic) body, "
            "very generous left and right margins to frame each poem, "
            "1.8× line spacing for breathing room.  No first-line indent — poetry "
            "is left-aligned.  Minimal ornamentation; a thin floral or asterism "
            "ornament between poems works well.  Chapter (poem) titles should be "
            "small-caps-style in a complementary serif."
        ),
        "page_bg":             "#fdfaf5",
        "text_color":          "#1e1523",
        "chapter_title_color": "#6b2d8b",
        "accent_color":        "#b45fc0",
        "body_font":           "Times-Italic",
        "body_font_size":      12,
        "line_spacing":        1.8,
        "first_para_indent_mm": 0,
        "margin_top_mm":       30,
        "margin_bottom_mm":    30,
        "margin_left_mm":      35,
        "margin_right_mm":     35,
        "chapter_font":        "Times-Roman",
        "chapter_font_size":   18,
        "chapter_prefix":      "",
        "show_drop_cap":       False,
        "ornament":            "❧",
        "header_text":         "",
        "show_page_numbers":   True,
    },

    "children": {
        "_label": "Children's Book",
        "_description": (
            "A children's book needs large, clear type and lots of white space for "
            "illustrations.  Pure white background, large sans-serif body font "
            "(Helvetica, 14pt+), very wide margins to leave room for artwork, "
            "double-spaced (2.0×) text, friendly short chapter titles in a bold "
            "round-looking font, bright cheerful accent colour (coral, teal, or "
            "sunshine yellow).  No drop cap — just friendly text.  Centred page "
            "numbers at the bottom.  No running header."
        ),
        "page_bg":             "#ffffff",
        "text_color":          "#1a1a2e",
        "chapter_title_color": "#e05a2b",
        "accent_color":        "#f4a535",
        "body_font":           "Helvetica",
        "body_font_size":      14,
        "line_spacing":        2.0,
        "first_para_indent_mm": 0,
        "margin_top_mm":       30,
        "margin_bottom_mm":    30,
        "margin_left_mm":      32,
        "margin_right_mm":     32,
        "chapter_font":        "Helvetica",
        "chapter_font_size":   22,
        "chapter_prefix":      "",
        "show_drop_cap":       False,
        "ornament":            "★",
        "header_text":         "",
        "show_page_numbers":   True,
    },

    "business": {
        "_label": "Business / Self-help",
        "_description": (
            "A business or self-help book should feel modern, authoritative, and "
            "easy to skim.  Crisp white page, clean Helvetica body font (11pt), "
            "1.45× spacing, bold sans-serif chapter headings, a strong accent colour "
            "(deep navy, electric blue, or confident purple), no drop cap, "
            "a thin top accent rule under each chapter title.  "
            "Running header on even pages; page numbers bottom-right.  "
            "Tight margins for a modern 'trade paperback' feel."
        ),
        "page_bg":             "#ffffff",
        "text_color":          "#0f172a",
        "chapter_title_color": "#1e3a5f",
        "accent_color":        "#4f46e5",
        "body_font":           "Helvetica",
        "body_font_size":      11,
        "line_spacing":        1.45,
        "first_para_indent_mm": 0,
        "margin_top_mm":       22,
        "margin_bottom_mm":    22,
        "margin_left_mm":      24,
        "margin_right_mm":     22,
        "chapter_font":        "Helvetica",
        "chapter_font_size":   26,
        "chapter_prefix":      "Chapter",
        "show_drop_cap":       False,
        "ornament":            "—",
        "header_text":         "",
        "show_page_numbers":   True,
    },
}


def get_book_type_profile(book_type: Optional[str]) -> Optional[dict]:
    """Return the profile dict for a known book type, or None if unrecognised."""
    if not book_type:
        return None
    return BOOK_TYPE_PROFILES.get(book_type.lower().strip())


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_title(raw: str, fallback: str = "book") -> str:
    cleaned = "".join(
        c for c in raw
        if unicodedata.category(c) not in ("Cc", "Cs") and c not in r'\/:*?"<>|'
    ).strip()
    return cleaned[:120] or fallback


def _hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i: i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _hex_to_docx_rgb(h: str):
    from docx.shared import RGBColor  # pyrefly: ignore [missing-import]
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Text extraction
# ─────────────────────────────────────────────────────────────────────────────

def _extract_from_pdf(path: str) -> str:
    try:
        from pypdf import PdfReader  # pyrefly: ignore [missing-import]
        reader = PdfReader(path)
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        raise RuntimeError(f"PDF extraction failed: {exc}") from exc


def _extract_from_docx(path: str) -> str:
    try:
        from docx import Document  # pyrefly: ignore [missing-import]
        doc = Document(path)
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as exc:
        raise RuntimeError(f"DOCX extraction failed: {exc}") from exc


def _extract_from_zip(zip_path: str) -> str:
    texts: list[str] = []
    scratch = zip_path + "_scratch"
    os.makedirs(scratch, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            members = [
                m for m in zf.namelist()
                if os.path.splitext(m)[1].lower() in {".pdf", ".docx"}
                and not m.startswith("__MACOSX")
                and not os.path.basename(m).startswith(".")
            ]
            if not members:
                raise ValueError("No .pdf or .docx files found inside the zip.")
            for member in members[:5]:
                ext = os.path.splitext(member)[1].lower()
                tmp = os.path.join(scratch, f"{uuid.uuid4().hex}{ext}")
                with zf.open(member) as src, open(tmp, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                texts.append(_extract_from_pdf(tmp) if ext == ".pdf" else _extract_from_docx(tmp))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return "\n\n".join(texts)


def extract_text(file_path: str, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return _extract_from_pdf(file_path)
    if ext == ".docx":
        return _extract_from_docx(file_path)
    if ext == ".zip":
        return _extract_from_zip(file_path)
    raise ValueError(f"Unsupported file type: {ext}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Chapter detection
# ─────────────────────────────────────────────────────────────────────────────

_CHAPTER_RE = re.compile(
    r"^(?:"
    r"chapter\s+(?:\d+|[ivxlcdm]+)[^\n]*"
    r"|part\s+(?:\d+|[ivxlcdm]+)[^\n]*"
    r"|\d{1,3}[.\)]\s+[A-Z][^\n]{3,60}"
    r"|[A-Z][A-Z\s]{4,50}$"
    r")",
    re.IGNORECASE | re.MULTILINE,
)

MAX_CHAPTERS = 60
MIN_CHAPTER_CHARS = 300


def parse_chapters(raw_text: str) -> list[dict]:
    lines = raw_text.split("\n")
    splits: list[int] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and _CHAPTER_RE.match(stripped) and len(stripped) < 120:
            splits.append(i)

    if len(splits) < 2:
        words = raw_text.split()
        chunk_size = 1_500
        chapters = []
        for idx in range(0, len(words), chunk_size):
            chunk = " ".join(words[idx: idx + chunk_size])
            if len(chunk) >= MIN_CHAPTER_CHARS:
                chapters.append({"title": f"Section {len(chapters) + 1}", "body": chunk})
        return chapters[:MAX_CHAPTERS]

    chapters: list[dict] = []
    for k, start_line in enumerate(splits[:MAX_CHAPTERS]):
        end_line = splits[k + 1] if k + 1 < len(splits) else len(lines)
        heading = lines[start_line].strip()
        body = "\n".join(lines[start_line + 1: end_line]).strip()
        if len(body) < MIN_CHAPTER_CHARS:
            if chapters:
                chapters[-1]["body"] += "\n\n" + heading + "\n" + body
                continue
        chapters.append({"title": heading, "body": body})

    return chapters or [{"title": "Full Text", "body": raw_text}]


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — AI layout concept  (book-type aware)
# ─────────────────────────────────────────────────────────────────────────────

_LAYOUT_SYSTEM_BASE = """You are a world-class book typographer and interior layout designer with 25 years of experience designing print-ready book interiors for major publishing houses.

Given a book title, its type/genre, a sample of the text, page dimensions, and optional design instructions, you create a complete, production-quality typographic layout specification.

You MUST respond ONLY with valid JSON — no markdown, no code fences, no commentary, nothing else.

The JSON must contain exactly these keys:
{
  "style_name":            "<short evocative name, e.g. 'Warm Classic Serif' or 'Modern Academic'>",
  "page_bg":               "<hex color for page background>",
  "text_color":            "<hex for main body text — must be readable on page_bg>",
  "chapter_title_color":   "<hex for chapter heading text>",
  "accent_color":          "<hex for rules, ornaments, running header, page-number color>",
  "body_font":             "<one of: Helvetica | Times-Roman | Courier | Helvetica-Oblique | Times-Italic>",
  "body_font_size":        <number 9–14 — appropriate for the book type>,
  "line_spacing":          <number 1.2–2.0 — the leading multiplier>,
  "first_para_indent_mm":  <number 0–10 — first-line indent; use 0 for poetry/children>,
  "margin_top_mm":         <number 15–45>,
  "margin_bottom_mm":      <number 15–45>,
  "margin_left_mm":        <number 15–45>,
  "margin_right_mm":       <number 15–45>,
  "chapter_font":          "<same allowable set as body_font>",
  "chapter_font_size":     <number 16–36>,
  "chapter_prefix":        "<e.g. 'Chapter' or 'Part' or '' to omit>",
  "show_drop_cap":         <true|false>,
  "ornament":              "<a short unicode ornament, e.g. '—◆—' or '✦  ✦  ✦' or '❧' or '' to skip>",
  "header_text":           "<running header text, usually the book title, or '' to omit>",
  "show_page_numbers":     <true|false>
}

Typography rules you must follow:
- NEVER choose a body_font_size below 9 or above 14.
- NEVER choose a chapter_font_size below 16 or above 36.
- NEVER choose line_spacing below 1.2 or above 2.0.
- All colour pairs must have sufficient contrast for print (WCAG AA on paper).
- For cream/ivory backgrounds, always use dark brown or near-black text, never grey.
- For dark backgrounds, always use near-white or light text.
- font choices must be from the five allowed values only.
"""


def _build_system_prompt(profile: Optional[dict]) -> str:
    """Append book-type guidance to the base system prompt if a profile exists."""
    if not profile:
        return _LAYOUT_SYSTEM_BASE
    return (
        _LAYOUT_SYSTEM_BASE
        + f"\n\n--- BOOK TYPE GUIDANCE ---\n"
        + f"This book is a {profile['_label']}.\n"
        + f"{profile['_description']}\n"
        + "Apply these genre conventions unless the user has explicitly overridden a specific value.\n"
        + "--- END GUIDANCE ---\n"
    )


def generate_layout_concept(
    book_title: str,
    sample_text: str,
    design_instructions: str = "",
    page_width_mm: float = 210,
    page_height_mm: float = 297,
    book_type: Optional[str] = None,
    profile_defaults: Optional[dict] = None,
) -> dict:
    """
    Call GPT-4o to produce a layout concept.
    profile_defaults (if supplied) are injected into the user message so the
    AI knows what field values are already 'strongly suggested'.
    """
    sample = sample_text[:3_000]
    system_prompt = _build_system_prompt(
        BOOK_TYPE_PROFILES.get(book_type.lower().strip()) if book_type else None
    )

    user_msg = (
        f"Book title: {book_title}\n"
        f"Page size: {page_width_mm:.0f} × {page_height_mm:.0f} mm\n"
    )
    if book_type:
        user_msg += f"Book type: {book_type}\n"
    if profile_defaults:
        # Share suggested defaults so AI can align its non-overridden choices
        subset = {
            k: v for k, v in profile_defaults.items()
            if not k.startswith("_")
        }
        user_msg += f"Suggested defaults for this book type: {json.dumps(subset)}\n"
    if design_instructions:
        user_msg += f"Design instructions: {design_instructions}\n"
    user_msg += f"\nSample text (first 3,000 chars):\n{sample}"

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.7,
        max_tokens=1500,
    )
    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    s = raw.find("{")
    e = raw.rfind("}") + 1
    if s == -1 or e == 0:
        raise ValueError(f"No JSON returned by the layout AI. Raw response: {raw[:300]}")
    try:
        concept = json.loads(raw[s:e])
    except json.JSONDecodeError as exc:
        raise ValueError(f"Layout AI returned invalid JSON: {exc}. Raw snippet: {raw[s:s+200]}") from exc

    # ── Normalise & clamp ─────────────────────────────────────────────────────
    # Use profile defaults as fallbacks, then hard-coded universal fallbacks
    pd = profile_defaults or {}
    concept.setdefault("style_name",            "Custom Layout")
    concept.setdefault("page_bg",               pd.get("page_bg", "#ffffff"))
    concept.setdefault("text_color",            pd.get("text_color", "#1a1a1a"))
    concept.setdefault("chapter_title_color",   pd.get("chapter_title_color", "#111111"))
    concept.setdefault("accent_color",          pd.get("accent_color", "#555555"))
    concept.setdefault("body_font",             pd.get("body_font", "Times-Roman"))
    concept.setdefault("chapter_font",          pd.get("chapter_font", "Times-Roman"))
    concept.setdefault("chapter_prefix",        pd.get("chapter_prefix", "Chapter"))
    concept.setdefault("show_drop_cap",         pd.get("show_drop_cap", True))
    concept.setdefault("ornament",              pd.get("ornament", "—◆—"))
    concept.setdefault("header_text",           book_title)
    concept.setdefault("show_page_numbers",     pd.get("show_page_numbers", True))

    concept["body_font_size"]        = max(9,  min(14, float(concept.get("body_font_size",  pd.get("body_font_size",  11)))))
    concept["line_spacing"]          = max(1.2, min(2.0, float(concept.get("line_spacing",   pd.get("line_spacing",   1.5)))))
    concept["first_para_indent_mm"]  = max(0,  min(10, float(concept.get("first_para_indent_mm", pd.get("first_para_indent_mm", 5)))))
    concept["chapter_font_size"]     = max(16, min(36, float(concept.get("chapter_font_size", pd.get("chapter_font_size", 22)))))
    for key, default in [
        ("margin_top_mm",    pd.get("margin_top_mm",    20)),
        ("margin_bottom_mm", pd.get("margin_bottom_mm", 20)),
        ("margin_left_mm",   pd.get("margin_left_mm",   22)),
        ("margin_right_mm",  pd.get("margin_right_mm",  22)),
    ]:
        concept[key] = max(10, min(50, float(concept.get(key, default))))

    # Validate font names
    _ALLOWED_FONTS = {"Helvetica", "Times-Roman", "Courier", "Helvetica-Oblique", "Times-Italic"}
    if concept["body_font"] not in _ALLOWED_FONTS:
        concept["body_font"] = pd.get("body_font", "Times-Roman")
    if concept["chapter_font"] not in _ALLOWED_FONTS:
        concept["chapter_font"] = pd.get("chapter_font", "Times-Roman")

    return concept


# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — PDF typesetting with ReportLab
# ─────────────────────────────────────────────────────────────────────────────

def render_layout_pdf(
    chapters: list[dict],
    concept: dict,
    output_path: str,
    page_width_mm: float,
    page_height_mm: float,
    book_title: str,
) -> str:
    from reportlab.lib.units import mm                                       # pyrefly: ignore [missing-import]
    from reportlab.lib.colors import Color                                   # pyrefly: ignore [missing-import]
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak  # pyrefly: ignore [missing-import]
    from reportlab.lib.styles import ParagraphStyle                          # pyrefly: ignore [missing-import]
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY          # pyrefly: ignore [missing-import]

    PW = page_width_mm * mm
    PH = page_height_mm * mm
    mt = concept["margin_top_mm"]    * mm
    mb = concept["margin_bottom_mm"] * mm
    ml = concept["margin_left_mm"]   * mm
    mr = concept["margin_right_mm"]  * mm

    bg_r,  bg_g,  bg_b  = _hex_to_rgb(concept["page_bg"])
    tx_r,  tx_g,  tx_b  = _hex_to_rgb(concept["text_color"])
    ch_r,  ch_g,  ch_b  = _hex_to_rgb(concept["chapter_title_color"])
    ac_r,  ac_g,  ac_b  = _hex_to_rgb(concept["accent_color"])

    body_font      = concept["body_font"]
    body_size      = concept["body_font_size"]
    leading        = body_size * concept["line_spacing"]
    indent_pt      = concept["first_para_indent_mm"] * mm
    chapter_font   = concept["chapter_font"]
    chapter_size   = concept["chapter_font_size"]
    show_drop      = concept["show_drop_cap"]
    ornament       = concept.get("ornament", "")
    header_text    = concept.get("header_text", book_title) or book_title
    show_pn        = concept["show_page_numbers"]
    chapter_prefix = concept.get("chapter_prefix", "Chapter")

    def _on_page(canvas, doc):
        canvas.saveState()
        canvas.setFillColorRGB(bg_r, bg_g, bg_b)
        canvas.rect(0, 0, PW, PH, fill=1, stroke=0)
        if header_text and doc.page > 1:
            canvas.setFillColorRGB(ac_r, ac_g, ac_b)
            canvas.setFont(body_font, 8)
            canvas.drawCentredString(PW / 2, PH - mt * 0.55, header_text)
            canvas.setStrokeColorRGB(ac_r, ac_g, ac_b, alpha=0.35)
            canvas.setLineWidth(0.4)
            canvas.line(ml, PH - mt * 0.65, PW - mr, PH - mt * 0.65)
        if show_pn and doc.page > 1:
            canvas.setFillColorRGB(ac_r, ac_g, ac_b)
            canvas.setFont(body_font, 8)
            canvas.drawCentredString(PW / 2, mb * 0.45, str(doc.page))
        canvas.restoreState()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=(PW, PH),
        leftMargin=ml, rightMargin=mr,
        topMargin=mt,  bottomMargin=mb,
    )

    # ── Paragraph styles ──────────────────────────────────────────────────────
    ch_style = ParagraphStyle(
        "ChapterTitle",
        fontName=chapter_font, fontSize=chapter_size,
        leading=chapter_size * 1.25,
        textColor=Color(ch_r, ch_g, ch_b),
        spaceAfter=chapter_size * 0.55, spaceBefore=chapter_size * 0.35,
        alignment=TA_LEFT,
    )
    prefix_style = ParagraphStyle(
        "ChapterPrefix",
        fontName=body_font, fontSize=body_size * 0.82,
        leading=body_size * 1.2,
        textColor=Color(ac_r, ac_g, ac_b),
        spaceBefore=0, spaceAfter=3, alignment=TA_LEFT, letterSpacing=1.8,
    )
    body_style = ParagraphStyle(
        "Body",
        fontName=body_font, fontSize=body_size, leading=leading,
        textColor=Color(tx_r, tx_g, tx_b),
        firstLineIndent=indent_pt,
        alignment=TA_JUSTIFY,
        spaceAfter=0, spaceBefore=0,
    )
    orn_style = ParagraphStyle(
        "Ornament",
        fontName=body_font, fontSize=body_size + 2,
        leading=(body_size + 2) * 1.5,
        textColor=Color(ac_r, ac_g, ac_b),
        alignment=TA_CENTER, spaceBefore=10, spaceAfter=10,
    )

    story = []

    # ── Title page ────────────────────────────────────────────────────────────
    title_style = ParagraphStyle(
        "TitlePage",
        fontName=chapter_font,
        fontSize=min(36, chapter_size * 1.6),
        leading=min(36, chapter_size * 1.6) * 1.2,
        textColor=Color(ch_r, ch_g, ch_b),
        alignment=TA_CENTER, spaceAfter=20,
    )
    story.append(Spacer(1, PH * 0.28))
    story.append(Paragraph(book_title, title_style))
    if ornament:
        story.append(Spacer(1, 14))
        story.append(Paragraph(ornament, orn_style))
    story.append(PageBreak())

    # ── Chapters ──────────────────────────────────────────────────────────────
    for idx, chapter in enumerate(chapters, start=1):
        if chapter_prefix:
            story.append(Paragraph(f"{chapter_prefix.upper()} {idx}".strip(), prefix_style))
        story.append(Paragraph(chapter["title"], ch_style))
        story.append(Spacer(1, 4))
        if ornament:
            story.append(Paragraph(ornament, orn_style))
            story.append(Spacer(1, 6))

        raw_body = chapter.get("body", "").strip()
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_body) if p.strip()]
        if not paragraphs:
            paragraphs = [raw_body] if raw_body else ["[No content]"]

        for p_idx, para_text in enumerate(paragraphs):
            safe = para_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            if p_idx == 0 and show_drop and len(safe) > 1:
                first_char = safe[0]
                rest = safe[1:]
                drop_html = (
                    f'<font name="{chapter_font}" size="{int(body_size * 2.8)}">'
                    f"{first_char}</font>{rest}"
                )
                story.append(Paragraph(drop_html, body_style))
            else:
                story.append(Paragraph(safe, body_style))

        story.append(PageBreak())

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# Step 5 — DOCX typesetting
# ─────────────────────────────────────────────────────────────────────────────

def render_layout_docx(
    chapters: list[dict],
    concept: dict,
    output_path: str,
    page_width_mm: float,
    page_height_mm: float,
    book_title: str,
) -> str:
    from docx import Document                                   # pyrefly: ignore [missing-import]
    from docx.shared import Pt, Cm, RGBColor                   # pyrefly: ignore [missing-import]
    from docx.enum.text import WD_ALIGN_PARAGRAPH              # pyrefly: ignore [missing-import]
    from docx.oxml.ns import qn                                # pyrefly: ignore [missing-import]
    from docx.oxml import OxmlElement                          # pyrefly: ignore [missing-import]

    _FONT_MAP = {
        "Times-Roman":       "Times New Roman",
        "Times-Italic":      "Times New Roman",
        "Helvetica":         "Arial",
        "Helvetica-Oblique": "Arial",
        "Courier":           "Courier New",
    }

    def docx_font(rl_name: str) -> str:
        return _FONT_MAP.get(rl_name, "Times New Roman")

    def rgb(hex_str: str) -> RGBColor:
        return _hex_to_docx_rgb(hex_str)

    body_fn    = docx_font(concept["body_font"])
    chapter_fn = docx_font(concept["chapter_font"])
    body_size  = float(concept["body_font_size"])
    ch_size    = float(concept["chapter_font_size"])
    ls         = float(concept["line_spacing"])
    ornament   = concept.get("ornament", "")
    prefix     = concept.get("chapter_prefix", "Chapter")

    doc     = Document()
    section = doc.sections[0]
    section.page_width    = Cm(page_width_mm  / 10)
    section.page_height   = Cm(page_height_mm / 10)
    section.left_margin   = Cm(concept["margin_left_mm"]   / 10)
    section.right_margin  = Cm(concept["margin_right_mm"]  / 10)
    section.top_margin    = Cm(concept["margin_top_mm"]    / 10)
    section.bottom_margin = Cm(concept["margin_bottom_mm"] / 10)

    def add_para(text, font_name, size, bold=False, italic=False,
                 color="#1a1a1a", align=WD_ALIGN_PARAGRAPH.LEFT,
                 space_before=0, space_after=0, line_space=1.5):
        p  = doc.add_paragraph()
        p.alignment = align
        pf = p.paragraph_format
        pf.space_before = Pt(space_before)
        pf.space_after  = Pt(space_after)
        pf.line_spacing = Pt(size * line_space)
        run = p.add_run(text)
        run.font.name   = font_name
        run.font.size   = Pt(size)
        run.font.bold   = bold
        run.font.italic = italic
        run.font.color.rgb = rgb(color)

    def add_rule(color_hex):
        p   = doc.add_paragraph()
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bt   = OxmlElement("w:bottom")
        bt.set(qn("w:val"),   "single")
        bt.set(qn("w:sz"),    "6")
        bt.set(qn("w:space"), "1")
        bt.set(qn("w:color"), color_hex.lstrip("#"))
        pBdr.append(bt)
        pPr.append(pBdr)

    # Title page
    for _ in range(4):
        doc.add_paragraph()
    add_para(book_title, chapter_fn, min(36, ch_size * 1.5), bold=True,
             color=concept["chapter_title_color"], align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
    if ornament:
        add_para(ornament, body_fn, body_size + 2, color=concept["accent_color"],
                 align=WD_ALIGN_PARAGRAPH.CENTER, space_before=6, space_after=6)
    doc.add_page_break()

    # Chapters
    for idx, chapter in enumerate(chapters, start=1):
        if prefix:
            add_para(f"{prefix.upper()} {idx}".strip(), body_fn, body_size * 0.82,
                     color=concept["accent_color"], space_before=6, space_after=2)
        add_para(chapter["title"], chapter_fn, ch_size, bold=True,
                 color=concept["chapter_title_color"], space_after=8)
        add_rule(concept["accent_color"])
        if ornament:
            add_para(ornament, body_fn, body_size + 1, color=concept["accent_color"],
                     align=WD_ALIGN_PARAGRAPH.CENTER, space_before=4, space_after=8)

        raw_body = chapter.get("body", "").strip()
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_body) if p.strip()]
        if not paragraphs:
            paragraphs = [raw_body] if raw_body else ["[No content]"]
        for para_text in paragraphs:
            add_para(para_text, body_fn, body_size, color=concept["text_color"],
                     align=WD_ALIGN_PARAGRAPH.JUSTIFY, space_after=4, line_space=ls)

        doc.add_page_break()

    doc.save(output_path)
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# Main orchestrator
# ─────────────────────────────────────────────────────────────────────────────

def design_layout(
    file_path: str,
    filename: str,
    output_dir: str,
    page_width_mm: float = 210.0,
    page_height_mm: float = 297.0,
    book_title: str = "",
    design_instructions: str = "",
    book_type: Optional[str] = None,          # NEW — "novel"|"academic"|"religious"|"poetry"|"children"|"business"
    visual_template: Optional[str] = None,    # NEW — template key (injected into design_instructions)
    progress_callback: Optional[Callable[[str, int, str], None]] = None,
    # ── Typography overrides (None = AI/profile decides) ─────────────────────
    body_font: Optional[str] = None,
    chapter_font: Optional[str] = None,
    body_font_size: Optional[float] = None,
    chapter_font_size: Optional[float] = None,
    line_spacing: Optional[float] = None,
    margin_top_mm: Optional[float] = None,
    margin_bottom_mm: Optional[float] = None,
    margin_left_mm: Optional[float] = None,
    margin_right_mm: Optional[float] = None,
    show_drop_cap: Optional[bool] = None,
    show_page_numbers: Optional[bool] = None,
) -> dict:
    """
    Full pipeline — book-type aware:
      1. Extract text
      2. Detect chapters
      3. Look up book-type profile (smart genre defaults)
      4. Build override hints (user values + profile)
      5. Ask GPT-4o for a layout concept (seeded with profile)
      6. Apply hard user overrides (user always wins)
      7. Render PDF (ReportLab)
      8. Render DOCX (python-docx)

    Returns dict with: title, style_name, concept, chapter_count,
                       chapter_titles, pdf_path, docx_path, job_id,
                       book_type, book_type_label
    """

    def progress(stage: str, pct: int, message: str) -> None:
        if progress_callback:
            progress_callback(stage, pct, message)

    os.makedirs(output_dir, exist_ok=True)

    if not book_title:
        book_title = Path(filename).stem.replace("_", " ").replace("-", " ").title()
    book_title = _safe_title(book_title, fallback="My Book")

    # ── 1. Extract ────────────────────────────────────────────────────────────
    progress("extracting", 8, "Extracting text from your manuscript…")
    raw_text = extract_text(file_path, filename)
    if not raw_text.strip():
        raise ValueError("The uploaded file appears to contain no extractable text.")

    # ── 2. Parse chapters ─────────────────────────────────────────────────────
    progress("parsing", 20, "Detecting chapters and structure…")
    chapters = parse_chapters(raw_text)
    if not chapters:
        raise ValueError("Could not detect any chapters or sections in the manuscript.")

    # ── 3. Book-type profile ──────────────────────────────────────────────────
    profile = get_book_type_profile(book_type)
    if profile:
        progress("designing", 30, f"Applying {profile['_label']} design profile…")
    else:
        progress("designing", 30, "AI is designing your layout concept…")

    # ── 4. Build effective design instructions ────────────────────────────────
    override_hints: list[str] = []
    if body_font:            override_hints.append(f"body font MUST be {body_font}")
    if chapter_font:         override_hints.append(f"chapter heading font MUST be {chapter_font}")
    if body_font_size:       override_hints.append(f"body font size MUST be {body_font_size}pt")
    if chapter_font_size:    override_hints.append(f"chapter font size MUST be {chapter_font_size}pt")
    if line_spacing:         override_hints.append(f"line spacing MUST be {line_spacing}×")
    if margin_top_mm is not None:    override_hints.append(f"margin top MUST be {margin_top_mm}mm")
    if margin_bottom_mm is not None: override_hints.append(f"margin bottom MUST be {margin_bottom_mm}mm")
    if margin_left_mm is not None:   override_hints.append(f"margin left MUST be {margin_left_mm}mm")
    if margin_right_mm is not None:  override_hints.append(f"margin right MUST be {margin_right_mm}mm")
    if show_drop_cap is not None:
        override_hints.append("drop caps: " + ("ENABLED" if show_drop_cap else "DISABLED"))
    if show_page_numbers is not None:
        override_hints.append("page numbers: " + ("SHOWN" if show_page_numbers else "HIDDEN"))

    effective_instructions = design_instructions or ""

    # Visual template description — always injected, prepended before any
    # user design_instructions so both are honoured together.
    _TEMPLATE_HINTS = {
        "classic_novel":    "Classic cream pages with serif fonts, generous margins, drop caps and ornamental chapter dividers — think vintage Penguin Classics.",
        "premium_hardcover":"Luxury dark background (#0f0f0f), cream/gold text, gold accent (#c8a200), wide margins — elegant premium edition.",
        "modern_minimal":   "Pure white page, clean Helvetica, minimal decoration, thin accent rule under chapter titles, airy spacing.",
        "sanskrit_style":   "Warm ivory page, saffron/gold accent (#c8830a), ornate ornament dividers, classic serif — traditional sacred text aesthetic.",
        "school_guide":     "White page, structured sans-serif layout, blue accent (#2563eb), numbered chapters, no drop cap — clear academic style.",
        "thriller_dark":    "Dark page (#111827) with near-white body text (#f3f4f6), red accent (#ef4444), high contrast, sharp Helvetica headings.",
        "retro_vintage":    "Warm sepia page (#f5ead0), brown text, antique brown accent, italic serif body, diagonal/decorative ornament.",
        "poetry_bloom":     "Soft blush page (#fff0f5), purple/magenta accent (#d63384), italic serif body, floral ornaments, wide margins.",
    }
    if visual_template:
        hint = _TEMPLATE_HINTS.get(visual_template, "")
        if hint:
            # Prepend template hint; user instructions (if any) refine further
            effective_instructions = hint + (("\n" + effective_instructions) if effective_instructions else "")

    if override_hints:
        hint_str = "; ".join(override_hints)
        effective_instructions = (
            (effective_instructions + "\n" if effective_instructions else "")
            + f"[HARD USER OVERRIDES — honour exactly: {hint_str}]"
        )

    # ── 5. AI concept (seeded with profile defaults) ──────────────────────────
    progress("designing", 40, "AI is crafting your personalised layout…")
    concept = generate_layout_concept(
        book_title=book_title,
        sample_text=raw_text,
        design_instructions=effective_instructions,
        page_width_mm=page_width_mm,
        page_height_mm=page_height_mm,
        book_type=book_type,
        profile_defaults=profile,
    )

    # ── 6. Apply hard user overrides (user always wins over AI + profile) ─────
    if body_font:
        concept["body_font"]          = body_font
    if chapter_font:
        concept["chapter_font"]       = chapter_font
    if body_font_size is not None:
        concept["body_font_size"]     = float(body_font_size)
    if chapter_font_size is not None:
        concept["chapter_font_size"]  = float(chapter_font_size)
    if line_spacing is not None:
        concept["line_spacing"]       = float(line_spacing)
    if margin_top_mm is not None:
        concept["margin_top_mm"]      = float(margin_top_mm)
    if margin_bottom_mm is not None:
        concept["margin_bottom_mm"]   = float(margin_bottom_mm)
    if margin_left_mm is not None:
        concept["margin_left_mm"]     = float(margin_left_mm)
    if margin_right_mm is not None:
        concept["margin_right_mm"]    = float(margin_right_mm)
    if show_drop_cap is not None:
        concept["show_drop_cap"]      = show_drop_cap
    if show_page_numbers is not None:
        concept["show_page_numbers"]  = show_page_numbers

    # Tag concept with book type for downstream use
    concept["_book_type"]       = book_type or "auto"
    concept["_book_type_label"] = profile["_label"] if profile else "Auto (AI chosen)"

    job_id    = uuid.uuid4().hex
    safe_name = _safe_title(book_title, "book").replace(" ", "_")

    # ── 7. Render PDF ─────────────────────────────────────────────────────────
    progress("rendering", 58, "Typesetting PDF with your layout…")
    pdf_path = os.path.join(output_dir, f"layout_{safe_name}_{job_id}.pdf")
    render_layout_pdf(
        chapters=chapters, concept=concept, output_path=pdf_path,
        page_width_mm=page_width_mm, page_height_mm=page_height_mm, book_title=book_title,
    )

    # ── 8. Render DOCX ────────────────────────────────────────────────────────
    progress("rendering_docx", 80, "Generating DOCX version…")
    docx_path = os.path.join(output_dir, f"layout_{safe_name}_{job_id}.docx")
    render_layout_docx(
        chapters=chapters, concept=concept, output_path=docx_path,
        page_width_mm=page_width_mm, page_height_mm=page_height_mm, book_title=book_title,
    )

    progress("done", 100, "Layout design complete!")

    return {
        "title":            book_title,
        "style_name":       concept["style_name"],
        "concept":          concept,
        "chapter_count":    len(chapters),
        "chapter_titles":   [c["title"] for c in chapters],
        "pdf_path":         pdf_path,
        "docx_path":        docx_path,
        "job_id":           job_id,
        "book_type":        book_type or "auto",
        "book_type_label":  profile["_label"] if profile else "Auto (AI chosen)",
    }