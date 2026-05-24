"""
cover_designer.py
AI-powered book cover designer.
- Reads an uploaded PDF or DOCX
- Uses GPT-4o to generate a cover concept (title, subtitle, tagline, palette, style)
- Renders a full-bleed A4 cover page using ReportLab (PDF) or python-docx (DOCX)
- Prepends the cover to the original document and returns the new file
"""

import os
import json
import uuid
import tempfile
import shutil
import math
from pathlib import Path

# pyrefly: ignore [missing-import]
from openai import OpenAI
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"


# ─────────────────────────────────────────────────────────────────────────────
# AI: Generate cover concept
# ─────────────────────────────────────────────────────────────────────────────

COVER_SYSTEM_PROMPT = """You are a world-class book cover designer and creative director.
Given a book title (and optional subtitle/description), you produce a complete cover design brief.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "title": "<display title — may add line breaks with \\n for layout>",
  "subtitle": "<compelling subtitle or empty string>",
  "tagline": "<one punchy sentence that captures the book's essence>",
  "author_line": "<e.g. 'A comprehensive guide' or leave empty>",
  "palette": {
    "bg_top": "<hex color for gradient top>",
    "bg_bottom": "<hex color for gradient bottom>",
    "accent": "<hex color for accent elements>",
    "title_color": "<hex for title text — must contrast bg>",
    "subtitle_color": "<hex for subtitle text>",
    "tagline_color": "<hex for tagline text>"
  },
  "style": "<one of: minimal | bold | literary | technical | elegant | vibrant>",
  "motif": "<short description of a geometric/abstract motif to draw, e.g. 'concentric circles', 'diagonal stripes', 'scattered dots', 'grid lines', 'wave curves'>",
  "genre_label": "<e.g. BUSINESS | SELF-HELP | SCIENCE | FICTION | HISTORY — uppercase>"
}"""


def generate_cover_concept(book_title: str, description: str = "") -> dict:
    prompt = f"Book title: {book_title}"
    if description:
        prompt += f"\nDescription: {description}"

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": COVER_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.85,
        max_tokens=800,
    )
    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    s = raw.find("{")
    e = raw.rfind("}") + 1
    if s == -1 or e == 0:
        raise ValueError("No JSON in cover concept response")
    return json.loads(raw[s:e])


# ─────────────────────────────────────────────────────────────────────────────
# PDF cover page renderer
# ─────────────────────────────────────────────────────────────────────────────

def _hex(h: str):
    """Convert #RRGGBB to (r,g,b) floats 0–1."""
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))


def render_cover_pdf(concept: dict, output_path: str):
    """Render a single-page A4 PDF cover using ReportLab canvas directly."""
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import Color

    W, H = A4  # 595 x 842 pts

    c = rl_canvas.Canvas(output_path, pagesize=A4)

    palette = concept.get("palette", {})

    def col(key, fallback="#1a1a1a"):
        r, g, b = _hex(palette.get(key, fallback))
        return Color(r, g, b)

    bg_top    = col("bg_top",    "#0f172a")
    bg_bottom = col("bg_bottom", "#1e293b")
    accent    = col("accent",    "#6366f1")
    title_col = col("title_color",    "#ffffff")
    sub_col   = col("subtitle_color", "#cbd5e1")
    tag_col   = col("tagline_color",  "#94a3b8")

    # ── Gradient background (simulated with bands) ───────────────────────────
    steps = 60
    for i in range(steps):
        t = i / steps
        r = bg_top.red   + (bg_bottom.red   - bg_top.red)   * t
        g = bg_top.green + (bg_bottom.green - bg_top.green) * t
        b = bg_top.blue  + (bg_bottom.blue  - bg_top.blue)  * t
        c.setFillColorRGB(r, g, b)
        band_h = H / steps + 1
        c.rect(0, H - (i + 1) * band_h, W, band_h + 1, fill=1, stroke=0)

    # ── Motif decoration ─────────────────────────────────────────────────────
    motif = concept.get("motif", "").lower()
    ar, ag, ab = accent.red, accent.green, accent.blue

    if "circle" in motif or "concentric" in motif:
        for radius in range(30, 280, 40):
            alpha = max(0.03, 0.18 - radius * 0.0005)
            c.setStrokeColorRGB(ar, ag, ab, alpha=alpha)
            c.setLineWidth(1.2)
            c.circle(W * 0.82, H * 0.72, radius, fill=0, stroke=1)
    elif "stripe" in motif or "diagonal" in motif:
        c.setStrokeColorRGB(ar, ag, ab, alpha=0.08)
        c.setLineWidth(1.5)
        for x in range(-100, int(W) + 200, 28):
            c.line(x, 0, x + 200, H)
    elif "dot" in motif or "scatter" in motif:
        import random
        random.seed(42)
        for _ in range(90):
            x = random.uniform(W * 0.5, W)
            y = random.uniform(H * 0.4, H)
            r2 = random.uniform(1, 5)
            alpha = random.uniform(0.05, 0.22)
            c.setFillColorRGB(ar, ag, ab, alpha=alpha)
            c.circle(x, y, r2, fill=1, stroke=0)
    elif "grid" in motif:
        c.setStrokeColorRGB(ar, ag, ab, alpha=0.07)
        c.setLineWidth(0.8)
        for x in range(0, int(W), 32):
            c.line(x, 0, x, H)
        for y in range(0, int(H), 32):
            c.line(0, y, W, y)
    elif "wave" in motif or "curve" in motif:
        c.setStrokeColorRGB(ar, ag, ab, alpha=0.12)
        c.setLineWidth(1.8)
        for offset in range(0, 200, 35):
            path = c.beginPath()
            path.moveTo(0, H * 0.5 + offset)
            for x in range(0, int(W) + 10, 8):
                y = H * 0.5 + offset + math.sin(x * 0.025) * 45
                path.lineTo(x, y)
            c.drawPath(path, stroke=1, fill=0)
    else:
        # Default: subtle cross-hatch in corner
        c.setStrokeColorRGB(ar, ag, ab, alpha=0.07)
        c.setLineWidth(1)
        for i in range(0, 180, 20):
            c.line(W - 180 + i, H * 0.1, W, H * 0.1 + i * 1.5)

    # ── Accent bar (left edge) ────────────────────────────────────────────────
    c.setFillColorRGB(ar, ag, ab)
    c.rect(0, 0, 6, H, fill=1, stroke=0)

    # ── Genre label ──────────────────────────────────────────────────────────
    genre = concept.get("genre_label", "").upper()[:20]
    if genre:
        c.setFillColorRGB(ar, ag, ab, alpha=0.18)
        c.roundRect(28*mm, H - 28*mm, len(genre) * 7 + 24, 22, 4, fill=1, stroke=0)
        c.setFillColorRGB(ar, ag, ab)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(28*mm + 12, H - 28*mm + 6, genre)

    # ── Title ─────────────────────────────────────────────────────────────────
    title_lines = concept.get("title", "").split("\n")
    c.setFillColor(title_col)
    font_size = 48 if len(title_lines[0]) <= 20 else 38 if len(title_lines[0]) <= 30 else 30
    c.setFont("Helvetica-Bold", font_size)
    y_title = H * 0.58
    for line in title_lines:
        c.drawString(28*mm, y_title, line.strip())
        y_title -= (font_size + 10)

    # ── Decorative rule ──────────────────────────────────────────────────────
    c.setFillColorRGB(ar, ag, ab)
    c.rect(28*mm, y_title - 6, 52, 3, fill=1, stroke=0)
    y_title -= 22

    # ── Subtitle ─────────────────────────────────────────────────────────────
    subtitle = concept.get("subtitle", "").strip()
    if subtitle:
        c.setFillColor(sub_col)
        c.setFont("Helvetica", 16)
        # Wrap subtitle if long
        words = subtitle.split()
        lines, cur = [], []
        for w in words:
            if len(" ".join(cur + [w])) > 42:
                lines.append(" ".join(cur))
                cur = [w]
            else:
                cur.append(w)
        if cur:
            lines.append(" ".join(cur))
        for line in lines:
            c.drawString(28*mm, y_title - 8, line)
            y_title -= 26

    # ── Tagline ──────────────────────────────────────────────────────────────
    tagline = concept.get("tagline", "").strip()
    if tagline:
        c.setFillColor(tag_col)
        c.setFont("Helvetica-Oblique", 11)
        words = tagline.split()
        lines, cur = [], []
        for w in words:
            if len(" ".join(cur + [w])) > 55:
                lines.append(" ".join(cur))
                cur = [w]
            else:
                cur.append(w)
        if cur:
            lines.append(" ".join(cur))
        y_tag = y_title - 20
        for line in lines:
            c.drawString(28*mm, y_tag, line)
            y_tag -= 18

    # ── Bottom band ──────────────────────────────────────────────────────────
    c.setFillColorRGB(0, 0, 0, alpha=0.35)
    c.rect(0, 0, W, 22*mm, fill=1, stroke=0)

    author_line = concept.get("author_line", "").strip()
    if author_line:
        c.setFillColorRGB(1, 1, 1, alpha=0.6)
        c.setFont("Helvetica", 10)
        c.drawString(28*mm, 10*mm, author_line)

    c.setFillColorRGB(ar, ag, ab, alpha=0.7)
    c.setFont("Helvetica-Bold", 9)
    c.drawRightString(W - 28*mm, 10*mm, "EDITORIAL AI")

    c.showPage()
    c.save()
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# Prepend cover to existing PDF
# ─────────────────────────────────────────────────────────────────────────────

def prepend_cover_to_pdf(cover_pdf: str, original_pdf: str, output_pdf: str) -> str:
    # pyrefly: ignore [missing-import]
    from pypdf import PdfWriter, PdfReader

    writer = PdfWriter()

    # Cover page
    cover_reader = PdfReader(cover_pdf)
    for page in cover_reader.pages:
        writer.add_page(page)

    # Original pages
    orig_reader = PdfReader(original_pdf)
    for page in orig_reader.pages:
        writer.add_page(page)

    with open(output_pdf, "wb") as f:
        writer.write(f)

    return output_pdf


# ─────────────────────────────────────────────────────────────────────────────
# DOCX cover page renderer + prepend
# ─────────────────────────────────────────────────────────────────────────────

def prepend_cover_to_docx(concept: dict, original_docx: str, output_docx: str) -> str:
    # pyrefly: ignore [missing-import]
    from docx import Document
    # pyrefly: ignore [missing-import]
    from docx.shared import Pt, RGBColor, Cm, Inches
    # pyrefly: ignore [missing-import]
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    # pyrefly: ignore [missing-import]
    from docx.oxml.ns import qn
    # pyrefly: ignore [missing-import]
    from docx.oxml import OxmlElement
    import copy

    palette = concept.get("palette", {})

    def rgb(key, fallback="#1a1a1a"):
        h = palette.get(key, fallback).lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    # Build cover doc
    cover_doc = Document()
    section = cover_doc.sections[0]
    section.page_height = Cm(29.7)
    section.page_width  = Cm(21.0)
    section.left_margin = section.right_margin = Cm(2.5)
    section.top_margin  = Cm(3.0)
    section.bottom_margin = Cm(2.0)

    # Fill page background via XML shading on body
    body = cover_doc.element.body
    sectPr = body.find(qn("w:sectPr"))

    # Genre label
    genre = concept.get("genre_label", "").upper()
    if genre:
        p = cover_doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = p.add_run(f"— {genre} —")
        run.font.size = Pt(9)
        run.font.bold = True
        run.font.color.rgb = rgb("accent", "#6366f1")
        run.font.letter_spacing = Pt(2)

    # Spacer
    for _ in range(4):
        cover_doc.add_paragraph()

    # Title
    title_lines = concept.get("title", "").split("\n")
    for line in title_lines:
        p = cover_doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = p.add_run(line.strip())
        run.font.size = Pt(40)
        run.font.bold = True
        run.font.color.rgb = rgb("title_color", "#ffffff")

    # Accent rule (simulated via border paragraph)
    rule_para = cover_doc.add_paragraph()
    rule_para.paragraph_format.space_before = Pt(8)
    rule_para.paragraph_format.space_after  = Pt(8)
    pPr = rule_para._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "12")
    bottom.set(qn("w:space"), "1")
    h_accent = palette.get("accent", "#6366f1").lstrip("#")
    bottom.set(qn("w:color"), h_accent)
    pBdr.append(bottom)
    pPr.append(pBdr)

    # Subtitle
    subtitle = concept.get("subtitle", "").strip()
    if subtitle:
        p = cover_doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = p.add_run(subtitle)
        run.font.size = Pt(16)
        run.font.color.rgb = rgb("subtitle_color", "#cbd5e1")
        p.paragraph_format.space_after = Pt(10)

    # Tagline
    tagline = concept.get("tagline", "").strip()
    if tagline:
        p = cover_doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = p.add_run(tagline)
        run.font.size = Pt(11)
        run.font.italic = True
        run.font.color.rgb = rgb("tagline_color", "#94a3b8")

    # Spacer to push author to bottom
    for _ in range(6):
        cover_doc.add_paragraph()

    author_line = concept.get("author_line", "").strip()
    if author_line:
        p = cover_doc.add_paragraph()
        run = p.add_run(author_line)
        run.font.size = Pt(11)
        run.font.color.rgb = rgb("subtitle_color", "#cbd5e1")

    # Page break after cover
    cover_doc.add_page_break()

    # Save cover temp
    tmp_cover = output_docx + ".cover_tmp.docx"
    cover_doc.save(tmp_cover)

    # Now merge: cover paragraphs + all original paragraphs
    orig_doc = Document(original_docx)
    out_doc  = Document(tmp_cover)

    # Remove the trailing page break we added (last empty para before end)
    # Actually we want it: so just append original body XML into out_doc
    for element in orig_doc.element.body:
        # skip the final sectPr of the original to avoid double section props
        if element.tag == qn("w:sectPr"):
            continue
        out_doc.element.body.append(copy.deepcopy(element))

    out_doc.save(output_docx)
    if os.path.exists(tmp_cover):
        os.remove(tmp_cover)

    return output_docx


# ─────────────────────────────────────────────────────────────────────────────
# Main orchestrator
# ─────────────────────────────────────────────────────────────────────────────

def design_cover(
    file_path: str,
    filename: str,
    output_dir: str,
    book_title: str = "",
    description: str = "",
) -> dict:
    """
    Full pipeline:
    1. Extract title from filename if not provided
    2. Generate AI cover concept
    3. Render cover and prepend to original file
    Returns dict with output_path, concept, ext
    """
    os.makedirs(output_dir, exist_ok=True)
    ext = os.path.splitext(filename)[1].lower()

    if not book_title:
        book_title = Path(filename).stem.replace("_", " ").replace("-", " ").title()

    # Step 1: AI concept
    concept = generate_cover_concept(book_title, description)

    job_id = uuid.uuid4().hex
    out_filename = f"cover_{job_id}{ext}"
    output_path  = os.path.join(output_dir, out_filename)

    if ext == ".pdf":
        # Render cover PDF
        cover_pdf = os.path.join(output_dir, f"coverpage_{job_id}.pdf")
        render_cover_pdf(concept, cover_pdf)
        # Merge
        prepend_cover_to_pdf(cover_pdf, file_path, output_path)
        if os.path.exists(cover_pdf):
            os.remove(cover_pdf)

    elif ext == ".docx":
        prepend_cover_to_docx(concept, file_path, output_path)

    else:
        raise ValueError(f"Unsupported file type for cover design: {ext}. Upload a .pdf or .docx")

    return {
        "output_path": output_path,
        "concept": concept,
        "ext": ext,
        "job_id": job_id,
    }