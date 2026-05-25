"""
layout_designer.py
AI-powered internal book layout designer.

Pipeline:
  1. Extract raw text from PDF / DOCX / ZIP
  2. Detect chapter boundaries
  3. Ask GPT-4o to produce a complete typographic layout concept (JSON)
  4. Typeset every chapter with ReportLab → PDF
  5. Also produce a styled DOCX with python-docx
  6. Return paths + metadata to the caller
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
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_title(raw: str, fallback: str = "book") -> str:
    """Strip non-filename characters; fall back if empty."""
    cleaned = "".join(
        c for c in raw if unicodedata.category(c) not in ("Cc", "Cs") and c not in r'\/:*?"<>|'
    ).strip()
    return cleaned[:120] or fallback


def _hex_to_rgb(h: str) -> tuple[float, float, float]:
    """#RRGGBB → (r, g, b) in 0-1 range."""
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _hex_to_docx_rgb(h: str):
    """#RRGGBB → python-docx RGBColor."""
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
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            pages.append(text)
        return "\n\n".join(pages)
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
    """Extract text from the first PDF or DOCX found inside the zip."""
    texts: list[str] = []
    scratch = zip_path + "_scratch"
    os.makedirs(scratch, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            members = [
                m
                for m in zf.namelist()
                if os.path.splitext(m)[1].lower() in {".pdf", ".docx"}
                and not m.startswith("__MACOSX")
                and not os.path.basename(m).startswith(".")
            ]
            if not members:
                raise ValueError("No .pdf or .docx files found inside the zip.")
            for member in members[:5]:  # cap at 5 files
                ext = os.path.splitext(member)[1].lower()
                tmp = os.path.join(scratch, f"{uuid.uuid4().hex}{ext}")
                with zf.open(member) as src, open(tmp, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                if ext == ".pdf":
                    texts.append(_extract_from_pdf(tmp))
                else:
                    texts.append(_extract_from_docx(tmp))
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

# Patterns that typically mark a chapter heading
_CHAPTER_RE = re.compile(
    r"^(?:"
    r"chapter\s+(?:\d+|[ivxlcdm]+)[^\n]*"      # Chapter 1 / Chapter I
    r"|part\s+(?:\d+|[ivxlcdm]+)[^\n]*"         # Part 1 / Part I
    r"|\d{1,3}[.\)]\s+[A-Z][^\n]{3,60}"         # 1. Title / 1) Title
    r"|[A-Z][A-Z\s]{4,50}$"                     # ALL CAPS HEADING
    r")",
    re.IGNORECASE | re.MULTILINE,
)

MAX_CHAPTERS = 60
MIN_CHAPTER_CHARS = 300  # skip trivially short chunks


def parse_chapters(raw_text: str) -> list[dict]:
    """
    Return a list of {title, body} dicts.
    Falls back to fixed-size splitting if no headings found.
    """
    lines = raw_text.split("\n")
    splits: list[int] = []

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if _CHAPTER_RE.match(stripped) and len(stripped) < 120:
            splits.append(i)

    # Fallback: no headings detected — split every ~1 500 words
    if len(splits) < 2:
        words = raw_text.split()
        chunk_size = 1_500
        chapters = []
        for idx in range(0, len(words), chunk_size):
            chunk = " ".join(words[idx : idx + chunk_size])
            if len(chunk) >= MIN_CHAPTER_CHARS:
                chapters.append(
                    {"title": f"Section {len(chapters) + 1}", "body": chunk}
                )
        return chapters[:MAX_CHAPTERS]

    # Build chapters from detected splits
    chapters: list[dict] = []
    for k, start_line in enumerate(splits[:MAX_CHAPTERS]):
        end_line = splits[k + 1] if k + 1 < len(splits) else len(lines)
        heading = lines[start_line].strip()
        body_lines = lines[start_line + 1 : end_line]
        body = "\n".join(body_lines).strip()
        if len(body) < MIN_CHAPTER_CHARS:
            # Too short — merge into previous if possible
            if chapters:
                chapters[-1]["body"] += "\n\n" + heading + "\n" + body
                continue
        chapters.append({"title": heading, "body": body})

    # If we still have nothing meaningful, fall back
    if not chapters:
        return [{"title": "Full Text", "body": raw_text}]

    return chapters


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — AI layout concept
# ─────────────────────────────────────────────────────────────────────────────

LAYOUT_SYSTEM_PROMPT = """You are a world-class book typographer and interior layout designer.
Given a book title, a sample of the book's text, and optional design instructions, you create a
complete internal layout specification.

Respond ONLY with valid JSON — no markdown, no code fences, nothing else.

The JSON must contain exactly these keys:
{
  "style_name": "<short descriptive name, e.g. 'Classic Serif' or 'Modern Dark'>",
  "page_bg": "<hex color for page background, e.g. '#fffdf6' for cream>",
  "text_color": "<hex for main body text>",
  "chapter_title_color": "<hex for chapter heading text>",
  "accent_color": "<hex for rules, ornaments, page-number color>",
  "body_font": "<ReportLab built-in: one of Helvetica | Times-Roman | Courier | Helvetica-Oblique | Times-Italic>",
  "body_font_size": <number, 9–14>,
  "line_spacing": <number, 1.2–2.0, the leading multiplier>,
  "first_para_indent_mm": <number, 0–10, first-line indent in mm>,
  "margin_top_mm": <number, 15–40>,
  "margin_bottom_mm": <number, 15–40>,
  "margin_left_mm": <number, 15–40>,
  "margin_right_mm": <number, 15–40>,
  "chapter_font": "<same set as body_font>",
  "chapter_font_size": <number, 16–36>,
  "chapter_prefix": "<e.g. 'Chapter' or 'PART' or '' to omit>",
  "show_drop_cap": <true|false>,
  "ornament": "<a short unicode ornament string, e.g. '❧' or '✦' or '—◆—' or '' to skip>",
  "header_text": "<running header text, e.g. the book title, or '' to omit>",
  "show_page_numbers": <true|false>
}"""


def generate_layout_concept(
    book_title: str,
    sample_text: str,
    design_instructions: str = "",
    page_width_mm: float = 210,
    page_height_mm: float = 297,
) -> dict:
    sample = sample_text[:3_000]  # keep prompt compact
    user_msg = (
        f"Book title: {book_title}\n"
        f"Page size: {page_width_mm:.0f} × {page_height_mm:.0f} mm\n"
    )
    if design_instructions:
        user_msg += f"Design instructions: {design_instructions}\n"
    user_msg += f"\nSample text (first 3 000 chars):\n{sample}"

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": LAYOUT_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.75,
        max_tokens=900,
    )
    raw = response.choices[0].message.content.strip()
    # Strip any accidental markdown fences
    raw = raw.replace("```json", "").replace("```", "").strip()
    s = raw.find("{")
    e = raw.rfind("}") + 1
    if s == -1 or e == 0:
        raise ValueError("No JSON returned by layout AI.")
    concept = json.loads(raw[s:e])

    # Normalise / clamp
    concept.setdefault("style_name", "Custom")
    concept.setdefault("page_bg", "#ffffff")
    concept.setdefault("text_color", "#1a1a1a")
    concept.setdefault("chapter_title_color", "#111111")
    concept.setdefault("accent_color", "#555555")
    concept.setdefault("body_font", "Times-Roman")
    concept["body_font_size"] = max(9, min(14, float(concept.get("body_font_size", 11))))
    concept["line_spacing"] = max(1.2, min(2.0, float(concept.get("line_spacing", 1.5))))
    concept["first_para_indent_mm"] = max(0, min(10, float(concept.get("first_para_indent_mm", 5))))
    for key, default in [
        ("margin_top_mm", 20),
        ("margin_bottom_mm", 20),
        ("margin_left_mm", 22),
        ("margin_right_mm", 22),
    ]:
        concept[key] = max(10, min(50, float(concept.get(key, default))))
    concept.setdefault("chapter_font", "Times-Roman")
    concept["chapter_font_size"] = max(16, min(36, float(concept.get("chapter_font_size", 22))))
    concept.setdefault("chapter_prefix", "Chapter")
    concept.setdefault("show_drop_cap", True)
    concept.setdefault("ornament", "—◆—")
    concept.setdefault("header_text", book_title)
    concept.setdefault("show_page_numbers", True)

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
    from reportlab.pdfgen import canvas as rl_canvas  # pyrefly: ignore [missing-import]
    from reportlab.lib.units import mm  # pyrefly: ignore [missing-import]
    from reportlab.lib.colors import Color  # pyrefly: ignore [missing-import]
    from reportlab.platypus import (  # pyrefly: ignore [missing-import]
        SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # pyrefly: ignore [missing-import]
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY  # pyrefly: ignore [missing-import]

    PW = page_width_mm * mm
    PH = page_height_mm * mm

    mt = concept["margin_top_mm"] * mm
    mb = concept["margin_bottom_mm"] * mm
    ml = concept["margin_left_mm"] * mm
    mr = concept["margin_right_mm"] * mm

    bg_r, bg_g, bg_b = _hex_to_rgb(concept["page_bg"])
    tx_r, tx_g, tx_b = _hex_to_rgb(concept["text_color"])
    ch_r, ch_g, ch_b = _hex_to_rgb(concept["chapter_title_color"])
    ac_r, ac_g, ac_b = _hex_to_rgb(concept["accent_color"])

    body_font      = concept["body_font"]
    body_size      = concept["body_font_size"]
    leading        = body_size * concept["line_spacing"]
    indent_pt      = concept["first_para_indent_mm"] * mm
    chapter_font   = concept["chapter_font"]
    chapter_size   = concept["chapter_font_size"]
    show_drop      = concept["show_drop_cap"]
    ornament       = concept.get("ornament", "")
    header_text    = concept.get("header_text", book_title)
    show_pn        = concept["show_page_numbers"]
    chapter_prefix = concept.get("chapter_prefix", "Chapter")

    page_num = [1]  # mutable reference for the canvas callback

    def _on_page(canvas, doc):
        """Draw background, header rule, and page number on every page."""
        canvas.saveState()
        # Background fill
        canvas.setFillColorRGB(bg_r, bg_g, bg_b)
        canvas.rect(0, 0, PW, PH, fill=1, stroke=0)

        # Running header
        if header_text and doc.page > 1:
            canvas.setFillColorRGB(ac_r, ac_g, ac_b)
            canvas.setFont(body_font, 8)
            canvas.drawCentredString(PW / 2, PH - mt * 0.55, header_text)
            canvas.setStrokeColorRGB(ac_r, ac_g, ac_b, alpha=0.4)
            canvas.setLineWidth(0.5)
            canvas.line(ml, PH - mt * 0.65, PW - mr, PH - mt * 0.65)

        # Page number
        if show_pn and doc.page > 1:
            canvas.setFillColorRGB(ac_r, ac_g, ac_b)
            canvas.setFont(body_font, 8)
            canvas.drawCentredString(PW / 2, mb * 0.45, str(doc.page))

        canvas.restoreState()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=(PW, PH),
        leftMargin=ml,
        rightMargin=mr,
        topMargin=mt,
        bottomMargin=mb,
    )

    styles = getSampleStyleSheet()

    # Chapter title style
    ch_style = ParagraphStyle(
        "ChapterTitle",
        fontName=chapter_font,
        fontSize=chapter_size,
        leading=chapter_size * 1.25,
        textColor=Color(ch_r, ch_g, ch_b),
        spaceAfter=chapter_size * 0.6,
        spaceBefore=chapter_size * 0.4,
        alignment=TA_LEFT,
    )

    # Prefix label style (e.g. "Chapter 1")
    prefix_style = ParagraphStyle(
        "ChapterPrefix",
        fontName=body_font,
        fontSize=body_size * 0.85,
        leading=body_size * 1.2,
        textColor=Color(ac_r, ac_g, ac_b),
        spaceBefore=0,
        spaceAfter=4,
        alignment=TA_LEFT,
        letterSpacing=1.5,
    )

    # Body paragraph style
    body_style = ParagraphStyle(
        "Body",
        fontName=body_font,
        fontSize=body_size,
        leading=leading,
        textColor=Color(tx_r, tx_g, tx_b),
        firstLineIndent=indent_pt,
        alignment=TA_JUSTIFY,
        spaceAfter=0,
        spaceBefore=0,
    )

    # Ornament style
    orn_style = ParagraphStyle(
        "Ornament",
        fontName=body_font,
        fontSize=body_size + 2,
        leading=(body_size + 2) * 1.5,
        textColor=Color(ac_r, ac_g, ac_b),
        alignment=TA_CENTER,
        spaceBefore=10,
        spaceAfter=10,
    )

    story = []

    # ── Title page ──────────────────────────────────────────────────────────
    title_style = ParagraphStyle(
        "TitlePage",
        fontName=chapter_font,
        fontSize=min(36, chapter_size * 1.6),
        leading=min(36, chapter_size * 1.6) * 1.2,
        textColor=Color(ch_r, ch_g, ch_b),
        alignment=TA_CENTER,
        spaceAfter=20,
    )
    story.append(Spacer(1, PH * 0.28))
    story.append(Paragraph(book_title, title_style))
    if ornament:
        story.append(Spacer(1, 12))
        story.append(Paragraph(ornament, orn_style))
    story.append(PageBreak())

    # ── Chapters ─────────────────────────────────────────────────────────────
    for idx, chapter in enumerate(chapters, start=1):
        # Chapter prefix label
        if chapter_prefix:
            story.append(
                Paragraph(
                    f"{chapter_prefix.upper()} {idx}".strip(),
                    prefix_style,
                )
            )

        # Chapter title
        story.append(Paragraph(chapter["title"], ch_style))

        # Accent rule under title
        story.append(Spacer(1, 4))

        # Ornament divider after heading
        if ornament:
            story.append(Paragraph(ornament, orn_style))
            story.append(Spacer(1, 6))

        # Body paragraphs
        raw_body = chapter.get("body", "").strip()
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_body) if p.strip()]

        if not paragraphs:
            paragraphs = [raw_body] if raw_body else ["[No content]"]

        for p_idx, para_text in enumerate(paragraphs):
            # Sanitise XML-unsafe chars for ReportLab
            safe = para_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

            if p_idx == 0 and show_drop and len(safe) > 1:
                # Drop cap: render first letter in large font via inline HTML
                first_char = safe[0]
                rest = safe[1:]
                drop_cap_html = (
                    f'<font name="{chapter_font}" size="{int(body_size * 2.8)}">'
                    f"{first_char}</font>{rest}"
                )
                story.append(Paragraph(drop_cap_html, body_style))
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
    from docx import Document  # pyrefly: ignore [missing-import]
    from docx.shared import Pt, Cm, RGBColor  # pyrefly: ignore [missing-import]
    from docx.enum.text import WD_ALIGN_PARAGRAPH  # pyrefly: ignore [missing-import]
    from docx.oxml.ns import qn  # pyrefly: ignore [missing-import]
    from docx.oxml import OxmlElement  # pyrefly: ignore [missing-import]

    def rgb(hex_str: str) -> RGBColor:
        return _hex_to_docx_rgb(hex_str)

    # Map ReportLab font names to something recognisable in DOCX
    _FONT_MAP = {
        "Times-Roman":     "Times New Roman",
        "Times-Italic":    "Times New Roman",
        "Helvetica":       "Arial",
        "Helvetica-Oblique": "Arial",
        "Courier":         "Courier New",
    }

    def docx_font(rl_name: str) -> str:
        return _FONT_MAP.get(rl_name, "Times New Roman")

    body_font_name    = docx_font(concept["body_font"])
    chapter_font_name = docx_font(concept["chapter_font"])
    body_size         = float(concept["body_font_size"])
    chapter_size      = float(concept["chapter_font_size"])
    line_spacing      = float(concept["line_spacing"])
    ml_cm             = concept["margin_left_mm"] / 10
    mr_cm             = concept["margin_right_mm"] / 10
    mt_cm             = concept["margin_top_mm"] / 10
    mb_cm             = concept["margin_bottom_mm"] / 10
    ornament          = concept.get("ornament", "")
    chapter_prefix    = concept.get("chapter_prefix", "Chapter")

    doc = Document()
    section = doc.sections[0]
    section.page_width       = Cm(page_width_mm / 10)
    section.page_height      = Cm(page_height_mm / 10)
    section.left_margin      = Cm(ml_cm)
    section.right_margin     = Cm(mr_cm)
    section.top_margin       = Cm(mt_cm)
    section.bottom_margin    = Cm(mb_cm)

    def add_para(text: str, font_name: str, size: float,
                 bold: bool = False, italic: bool = False,
                 color: str = "#1a1a1a",
                 align=WD_ALIGN_PARAGRAPH.LEFT,
                 space_before: float = 0, space_after: float = 0,
                 line_space: float = 1.5) -> None:
        p = doc.add_paragraph()
        p.alignment = align
        pf = p.paragraph_format
        pf.space_before = Pt(space_before)
        pf.space_after  = Pt(space_after)
        pf.line_spacing = Pt(size * line_space)
        run = p.add_run(text)
        run.font.name  = font_name
        run.font.size  = Pt(size)
        run.font.bold  = bold
        run.font.italic = italic
        run.font.color.rgb = rgb(color)

    def add_rule(color_hex: str) -> None:
        """Insert a horizontal paragraph border rule."""
        p = doc.add_paragraph()
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bottom_el = OxmlElement("w:bottom")
        bottom_el.set(qn("w:val"), "single")
        bottom_el.set(qn("w:sz"), "6")
        bottom_el.set(qn("w:space"), "1")
        bottom_el.set(qn("w:color"), color_hex.lstrip("#"))
        pBdr.append(bottom_el)
        pPr.append(pBdr)

    # ── Title page ───────────────────────────────────────────────────────────
    for _ in range(4):
        doc.add_paragraph()

    add_para(
        book_title,
        chapter_font_name,
        min(36, chapter_size * 1.5),
        bold=True,
        color=concept["chapter_title_color"],
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=10,
    )

    if ornament:
        add_para(
            ornament,
            body_font_name,
            body_size + 2,
            color=concept["accent_color"],
            align=WD_ALIGN_PARAGRAPH.CENTER,
            space_before=6,
            space_after=6,
        )

    doc.add_page_break()

    # ── Chapters ─────────────────────────────────────────────────────────────
    for idx, chapter in enumerate(chapters, start=1):
        # Chapter prefix
        if chapter_prefix:
            add_para(
                f"{chapter_prefix.upper()} {idx}".strip(),
                body_font_name,
                body_size * 0.85,
                color=concept["accent_color"],
                space_before=6,
                space_after=2,
            )

        # Chapter title
        add_para(
            chapter["title"],
            chapter_font_name,
            chapter_size,
            bold=True,
            color=concept["chapter_title_color"],
            space_after=8,
        )

        # Accent rule
        add_rule(concept["accent_color"])

        # Ornament
        if ornament:
            add_para(
                ornament,
                body_font_name,
                body_size + 1,
                color=concept["accent_color"],
                align=WD_ALIGN_PARAGRAPH.CENTER,
                space_before=4,
                space_after=8,
            )

        # Body
        raw_body = chapter.get("body", "").strip()
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_body) if p.strip()]
        if not paragraphs:
            paragraphs = [raw_body] if raw_body else ["[No content]"]

        for para_text in paragraphs:
            add_para(
                para_text,
                body_font_name,
                body_size,
                color=concept["text_color"],
                align=WD_ALIGN_PARAGRAPH.JUSTIFY,
                space_after=4,
                line_space=line_spacing,
            )

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
    progress_callback: Optional[Callable[[str, int, str], None]] = None,
) -> dict:
    """
    Full pipeline:
      1. Extract text
      2. Detect chapters
      3. AI layout concept
      4. Render PDF
      5. Render DOCX
    Returns a dict with keys: title, style_name, concept, chapter_count,
                               chapter_titles, pdf_path, docx_path
    """

    def progress(stage: str, pct: int, message: str) -> None:
        if progress_callback:
            progress_callback(stage, pct, message)

    os.makedirs(output_dir, exist_ok=True)

    # Auto-detect title from filename if not provided
    if not book_title:
        book_title = (
            Path(filename).stem.replace("_", " ").replace("-", " ").title()
        )
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

    # ── 3. AI concept ─────────────────────────────────────────────────────────
    progress("designing", 38, "AI is designing your layout concept…")
    concept = generate_layout_concept(
        book_title=book_title,
        sample_text=raw_text,
        design_instructions=design_instructions,
        page_width_mm=page_width_mm,
        page_height_mm=page_height_mm,
    )

    job_id = uuid.uuid4().hex
    safe_name = _safe_title(book_title, "book").replace(" ", "_")

    # ── 4. Render PDF ─────────────────────────────────────────────────────────
    progress("rendering", 58, "Typesetting PDF with your layout…")
    pdf_filename = f"layout_{safe_name}_{job_id}.pdf"
    pdf_path = os.path.join(output_dir, pdf_filename)
    render_layout_pdf(
        chapters=chapters,
        concept=concept,
        output_path=pdf_path,
        page_width_mm=page_width_mm,
        page_height_mm=page_height_mm,
        book_title=book_title,
    )

    # ── 5. Render DOCX ────────────────────────────────────────────────────────
    progress("rendering_docx", 80, "Generating DOCX version…")
    docx_filename = f"layout_{safe_name}_{job_id}.docx"
    docx_path = os.path.join(output_dir, docx_filename)
    render_layout_docx(
        chapters=chapters,
        concept=concept,
        output_path=docx_path,
        page_width_mm=page_width_mm,
        page_height_mm=page_height_mm,
        book_title=book_title,
    )

    progress("done", 100, "Layout design complete!")

    return {
        "title":          book_title,
        "style_name":     concept["style_name"],
        "concept":        concept,
        "chapter_count":  len(chapters),
        "chapter_titles": [c["title"] for c in chapters],
        "pdf_path":       pdf_path,
        "docx_path":      docx_path,
        "job_id":         job_id,
    }