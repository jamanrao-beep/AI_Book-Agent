"""
translator.py
─────────────────────────────────────────────────────────────────────────────
Book Translator — accepts PDF / DOCX / ZIP, translates to any target language
using OpenAI GPT-4o, and exports both a PDF and a DOCX of the translated book.

Public API
──────────
    translate_book(
        file_path: str,
        filename: str,
        output_dir: str,
        target_language: str,
        source_language: str = "",          # "" → auto-detect
        progress_callback: callable = None, # (stage, pct, message) → None
    ) -> dict
        Returns:
            {
              "title": str,
              "source_language": str,
              "target_language": str,
              "total_words": int,
              "chapters": int,
              "chapter_titles": list[str],
              "pdf_path": str,
              "docx_path": str,
            }
"""

from __future__ import annotations

import os
import re
import uuid
import zipfile
import shutil
from typing import Callable, Optional

# ── Third-party ───────────────────────────────────────────────────────────────
# pyrefly: ignore [missing-import]
import openai                          # openai >= 1.0
# pyrefly: ignore [missing-import]
import pdfplumber                      # PDF text extraction
# pyrefly: ignore [missing-import]
from docx import Document              # python-docx  — read DOCX
# pyrefly: ignore [missing-import]
from docx.shared import Pt, RGBColor, Inches
# pyrefly: ignore [missing-import]
from docx.enum.text import WD_ALIGN_PARAGRAPH
# pyrefly: ignore [missing-import]
from reportlab.lib.pagesizes import A4
# pyrefly: ignore [missing-import]
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
# pyrefly: ignore [missing-import]
from reportlab.lib.units import cm
# pyrefly: ignore [missing-import]
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, HRFlowable,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Constants ─────────────────────────────────────────────────────────────────
_client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
_MODEL  = "gpt-4o"

# Maximum characters sent to the model in a single translation call.
# Keeps each request well inside the 128 k context window.
_CHUNK_CHARS = 12_000

SUPPORTED_UPLOAD_EXTS = {".pdf", ".docx", ".zip"}

# ─────────────────────────────────────────────────────────────────────────────
# 1. TEXT EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

def _extract_pdf(path: str) -> str:
    """Return all text from a PDF, pages joined by double newlines."""
    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            txt = page.extract_text() or ""
            if txt.strip():
                parts.append(txt.strip())
    return "\n\n".join(parts)


def _extract_docx(path: str) -> str:
    """Return all text from a DOCX, paragraphs joined by newlines."""
    doc = Document(path)
    lines: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            lines.append(text)
    return "\n".join(lines)


def _extract_zip(zip_path: str, scratch_dir: str) -> tuple[str, str]:
    """
    Extract the *first* .pdf or .docx found inside a zip.
    Returns (raw_text, detected_filename).
    Raises ValueError if nothing suitable is found.
    """
    with zipfile.ZipFile(zip_path, "r") as zf:
        members = [
            m for m in zf.namelist()
            if os.path.splitext(m)[1].lower() in {".pdf", ".docx"}
            and not m.startswith("__MACOSX")
            and not os.path.basename(m).startswith(".")
        ]
        if not members:
            raise ValueError(
                "No .pdf or .docx files found inside the zip archive."
            )
        # Use the first suitable file
        member = members[0]
        ext    = os.path.splitext(member)[1].lower()
        tmp    = os.path.join(scratch_dir, f"zip_extracted_{uuid.uuid4().hex}{ext}")
        with zf.open(member) as src, open(tmp, "wb") as dst:
            shutil.copyfileobj(src, dst)

    base_name = os.path.basename(member)
    if ext == ".pdf":
        text = _extract_pdf(tmp)
    else:
        text = _extract_docx(tmp)
    os.remove(tmp)
    return text, base_name


def extract_book_text(file_path: str, filename: str, scratch_dir: str) -> tuple[str, str]:
    """
    Dispatch to the correct extractor based on file extension.
    Returns (raw_text, source_filename).
    """
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return _extract_pdf(file_path), filename
    if ext == ".docx":
        return _extract_docx(file_path), filename
    if ext == ".zip":
        return _extract_zip(file_path, scratch_dir)
    raise ValueError(f"Unsupported file type: {ext}")


# ─────────────────────────────────────────────────────────────────────────────
# 2. STRUCTURE PARSING  (title + chapters)
# ─────────────────────────────────────────────────────────────────────────────

_CHAPTER_RE = re.compile(
    r"^(?:"
    r"(?:chapter|ch\.?|part|section|unit)\s+[\dIVXivx]+[:\.\s].*"  # "Chapter 1: …"
    r"|[\dIVX]+[\.]\s+[A-Z].{2,}"                                   # "1. Some Title"
    r")",
    re.IGNORECASE | re.MULTILINE,
)


def _parse_structure(text: str, title_hint: str = "") -> dict:
    """
    Return { "title": str, "chapters": [{"title": str, "body": str}, …] }
    Falls back gracefully: if no chapter markers are found the whole text
    becomes a single chapter called "Full Text".
    """
    # --- title ---
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    title = title_hint or (lines[0] if lines else "Translated Book")

    # --- chapters ---
    splits = list(_CHAPTER_RE.finditer(text))
    chapters: list[dict] = []

    if not splits:
        chapters = [{"title": "Full Text", "body": text}]
    else:
        # Text before the first chapter heading → prepend to ch1 or discard
        preamble = text[: splits[0].start()].strip()
        for idx, m in enumerate(splits):
            ch_title = m.group(0).strip()
            start    = m.end()
            end      = splits[idx + 1].start() if idx + 1 < len(splits) else len(text)
            body     = text[start:end].strip()
            if idx == 0 and preamble:
                body = preamble + "\n\n" + body
            chapters.append({"title": ch_title, "body": body})

    return {"title": title, "chapters": chapters}


# ─────────────────────────────────────────────────────────────────────────────
# 3. AI TRANSLATION  (chunked, with progress)
# ─────────────────────────────────────────────────────────────────────────────

def _detect_language(sample: str) -> str:
    """Ask the model to identify the source language of a text sample."""
    resp = _client.chat.completions.create(
        model=_MODEL,
        max_tokens=20,
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a language detection assistant. "
                    "Reply with ONLY the full English name of the language, "
                    "nothing else."
                ),
            },
            {
                "role": "user",
                "content": f"What language is this text written in?\n\n{sample[:600]}",
            },
        ],
    )
    return resp.choices[0].message.content.strip()


def _translate_chunk(
    text: str,
    target_language: str,
    source_language: str,
    context_hint: str = "",
) -> str:
    """
    Translate a single text chunk.  Returns the translated string.
    `context_hint` is a brief description of the book/chapter for style coherence.
    """
    sys_prompt = (
        f"You are a professional literary translator. "
        f"Translate the following text {'from ' + source_language + ' ' if source_language else ''}"
        f"into {target_language}. "
        "Preserve all formatting cues (blank lines, paragraph breaks, headings). "
        "Keep chapter or section headings as headings. "
        "Do NOT add commentary, notes, or translator remarks. "
        "Return ONLY the translated text."
    )
    if context_hint:
        sys_prompt += f"\n\nContext: {context_hint}"

    resp = _client.chat.completions.create(
        model=_MODEL,
        max_tokens=min(16384, max(2048, len(text) // 2)),
        temperature=0.3,
        messages=[
            {"role": "system", "content": sys_prompt},
            {"role": "user",   "content": text},
        ],
    )
    return resp.choices[0].message.content.strip()


def _translate_title(title: str, target_language: str, source_language: str) -> str:
    """Translate a book/chapter title."""
    resp = _client.chat.completions.create(
        model=_MODEL,
        max_tokens=80,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": (
                    f"Translate the following book title "
                    f"{'from ' + source_language + ' ' if source_language else ''}"
                    f"into {target_language}. "
                    "Return ONLY the translated title, nothing else."
                ),
            },
            {"role": "user", "content": title},
        ],
    )
    return resp.choices[0].message.content.strip()


def _translate_chapter(
    chapter: dict,
    target_language: str,
    source_language: str,
    book_title: str,
) -> dict:
    """
    Translate a single chapter dict: {"title": str, "body": str}.
    Chunks the body if it exceeds _CHUNK_CHARS.
    Returns {"title": str, "body": str} in the target language.
    """
    context_hint = f'Book: "{book_title}"'

    # Translate chapter title
    translated_title = _translate_title(
        chapter["title"], target_language, source_language
    )

    # Chunk & translate body using paragraph-aware splitting
    # (textwrap.wrap collapses \n\n, destroying paragraph structure)
    body = chapter["body"]
    paragraphs = body.split("\n\n")
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for para in paragraphs:
        para_len = len(para) + 2
        if current_len + para_len > _CHUNK_CHARS and current:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        current.append(para)
        current_len += para_len
    if current:
        chunks.append("\n\n".join(current))
    if not chunks:
        chunks = [body]

    translated_parts: list[str] = []
    for chunk in chunks:
        translated_parts.append(
            _translate_chunk(chunk, target_language, source_language, context_hint)
        )

    return {"title": translated_title, "body": "\n\n".join(translated_parts)}


# ─────────────────────────────────────────────────────────────────────────────
# 4. PDF OUTPUT
# ─────────────────────────────────────────────────────────────────────────────

def _build_pdf(book: dict, target_language: str, output_path: str) -> None:
    """
    Render the translated book to a PDF using ReportLab.
    `book` = { "title": str, "chapters": [{"title": str, "body": str}, …] }
    """
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=2.5 * cm,
        leftMargin=2.5 * cm,
        topMargin=2.8 * cm,
        bottomMargin=2.5 * cm,
        title=book["title"],
    )

    base_styles = getSampleStyleSheet()

    cover_title_style = ParagraphStyle(
        "CoverTitle",
        parent=base_styles["Title"],
        fontSize=28,
        leading=34,
        spaceAfter=12,
        alignment=TA_CENTER,
        textColor=(0.08, 0.10, 0.20),
        fontName="Helvetica-Bold",
    )
    cover_sub_style = ParagraphStyle(
        "CoverSub",
        parent=base_styles["Normal"],
        fontSize=12,
        leading=16,
        alignment=TA_CENTER,
        textColor=(0.40, 0.45, 0.55),
        fontName="Helvetica",
    )
    chapter_heading_style = ParagraphStyle(
        "ChapterHeading",
        parent=base_styles["Heading1"],
        fontSize=16,
        leading=20,
        spaceBefore=24,
        spaceAfter=10,
        textColor=(0.08, 0.10, 0.20),
        fontName="Helvetica-Bold",
    )
    body_style = ParagraphStyle(
        "Body",
        parent=base_styles["Normal"],
        fontSize=11,
        leading=17,
        spaceAfter=8,
        alignment=TA_JUSTIFY,
        fontName="Helvetica",
    )

    story = []

    # ── Cover page ──────────────────────────────────────────────────────────
    story.append(Spacer(1, 5 * cm))
    story.append(Paragraph(book["title"], cover_title_style))
    story.append(Spacer(1, 0.5 * cm))
    story.append(HRFlowable(width="60%", thickness=1.5, color=(0.08, 0.10, 0.20)))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph(f"Translated into {target_language}", cover_sub_style))
    story.append(Paragraph("Translated by Editorial AI", cover_sub_style))
    story.append(PageBreak())

    # ── Chapters ────────────────────────────────────────────────────────────
    for ch in book["chapters"]:
        story.append(Paragraph(ch["title"], chapter_heading_style))
        story.append(HRFlowable(width="100%", thickness=0.5, color=(0.80, 0.82, 0.86)))
        story.append(Spacer(1, 0.3 * cm))

        paragraphs = ch["body"].split("\n\n")
        for para_text in paragraphs:
            para_text = para_text.strip()
            if not para_text:
                continue
            # Escape XML special characters for ReportLab
            safe = (
                para_text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            story.append(Paragraph(safe, body_style))

        story.append(PageBreak())

    doc.build(story)


# ─────────────────────────────────────────────────────────────────────────────
# 5. DOCX OUTPUT
# ─────────────────────────────────────────────────────────────────────────────

def _build_docx(book: dict, target_language: str, output_path: str) -> None:
    """Render the translated book to a DOCX using python-docx."""
    doc = Document()

    # ── Page margins ─────────────────────────────────────────────────────────
    for section in doc.sections:
        section.top_margin    = Inches(1.1)
        section.bottom_margin = Inches(1.0)
        section.left_margin   = Inches(1.2)
        section.right_margin  = Inches(1.2)

    # ── Cover page ──────────────────────────────────────────────────────────
    title_para = doc.add_paragraph()
    title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title_para.add_run(book["title"])
    run.bold      = True
    run.font.size = Pt(26)
    run.font.color.rgb = RGBColor(0x14, 0x18, 0x2E)

    doc.add_paragraph()  # spacer

    sub_para = doc.add_paragraph()
    sub_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub_run = sub_para.add_run(f"Translated into {target_language}\nTranslated by Editorial AI")
    sub_run.font.size  = Pt(12)
    sub_run.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)

    doc.add_page_break()

    # ── Chapters ────────────────────────────────────────────────────────────
    for ch in book["chapters"]:
        heading = doc.add_heading(ch["title"], level=1)
        heading.runs[0].font.color.rgb = RGBColor(0x14, 0x18, 0x2E)

        paragraphs = ch["body"].split("\n\n")
        for para_text in paragraphs:
            para_text = para_text.strip()
            if not para_text:
                continue
            p = doc.add_paragraph(para_text)
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            for run in p.runs:
                run.font.size = Pt(11)

        doc.add_page_break()

    doc.save(output_path)


# ─────────────────────────────────────────────────────────────────────────────
# 6. PUBLIC ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def translate_book(
    file_path: str,
    filename: str,
    output_dir: str,
    target_language: str,
    source_language: str = "",
    progress_callback: Optional[Callable[[str, int, str], None]] = None,
) -> dict:
    """
    Full translation pipeline.

    Parameters
    ──────────
    file_path        : Absolute path to the uploaded file.
    filename         : Original filename (used for extension detection).
    output_dir       : Directory where PDF & DOCX outputs are written.
    target_language  : e.g. "French", "Japanese", "Telugu"
    source_language  : e.g. "English"  — leave "" to auto-detect.
    progress_callback: Optional callable(stage, pct, message).

    Returns
    ───────
    dict with keys:
        title, source_language, target_language,
        total_words, chapters, chapter_titles,
        pdf_path, docx_path
    """

    def _progress(stage: str, pct: int, msg: str) -> None:
        if progress_callback:
            progress_callback(stage, pct, msg)

    os.makedirs(output_dir, exist_ok=True)
    scratch_dir = os.path.join(output_dir, f"translate_scratch_{uuid.uuid4().hex}")
    os.makedirs(scratch_dir, exist_ok=True)

    try:
        # ── Stage 1: Extract text ────────────────────────────────────────────
        _progress("extracting", 5, "Extracting text from document…")
        raw_text, source_filename = extract_book_text(file_path, filename, scratch_dir)

        if not raw_text.strip():
            raise ValueError("The uploaded document appears to be empty or unreadable.")

        # ── Stage 2: Detect source language (if not provided) ────────────────
        _progress("extracting", 15, "Detecting source language…")
        detected_src = source_language.strip()
        if not detected_src:
            detected_src = _detect_language(raw_text[:1200])
        _progress("extracting", 20, f"Source language: {detected_src}")

        # ── Stage 3: Parse structure ─────────────────────────────────────────
        _progress("structuring", 25, "Analysing book structure…")
        title_hint = (
            os.path.splitext(source_filename)[0]
            .replace("_", " ")
            .replace("-", " ")
            .title()
        )
        structure  = _parse_structure(raw_text, title_hint)
        n_chapters = len(structure["chapters"])
        _progress("structuring", 30, f"Found {n_chapters} chapter(s) — starting translation…")

        # ── Stage 4: Translate title ─────────────────────────────────────────
        translated_title = _translate_title(
            structure["title"], target_language, detected_src
        )

        # ── Stage 5: Translate each chapter ──────────────────────────────────
        translated_chapters: list[dict] = []
        for idx, chapter in enumerate(structure["chapters"]):
            pct = 30 + int((idx / n_chapters) * 55)   # 30 → 85
            _progress(
                "translating",
                pct,
                f'Translating chapter {idx + 1}/{n_chapters}: "{chapter["title"][:60]}"…',
            )
            translated_chapters.append(
                _translate_chapter(
                    chapter,
                    target_language,
                    detected_src,
                    structure["title"],
                )
            )

        translated_book = {
            "title":    translated_title,
            "chapters": translated_chapters,
        }

        # ── Stage 6: Assemble outputs ─────────────────────────────────────────
        _progress("assembling", 87, "Building PDF…")
        job_id   = uuid.uuid4().hex
        safe_title = "".join(
            c for c in translated_title if c.isalnum() or c in (" ", "-", "_")
        ).strip() or "translated_book"

        pdf_path  = os.path.join(output_dir, f"translated_{job_id}.pdf")
        docx_path = os.path.join(output_dir, f"translated_{job_id}.docx")

        _build_pdf(translated_book, target_language, pdf_path)
        _progress("assembling", 93, "Building DOCX…")
        _build_docx(translated_book, target_language, docx_path)

        # ── Compute stats ─────────────────────────────────────────────────────
        total_words = sum(
            len(ch["body"].split()) for ch in translated_chapters
        )
        chapter_titles = [ch["title"] for ch in translated_chapters]

        _progress("done", 100, "Translation complete!")

        return {
            "title":           translated_title,
            "source_language": detected_src,
            "target_language": target_language,
            "total_words":     total_words,
            "chapters":        n_chapters,
            "chapter_titles":  chapter_titles,
            "pdf_path":        pdf_path,
            "docx_path":       docx_path,
        }

    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)