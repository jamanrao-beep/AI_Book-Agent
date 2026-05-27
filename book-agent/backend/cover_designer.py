"""
cover_designer.py  ·  v3.0
AI-powered book cover designer — rich, fully layered covers.

Pipeline:
  1. Extract title from filename if not provided
  2. GPT-4o generates a complete cover concept (JSON)
  3. render_cover_pdf  — full-bleed A4 cover with:
       • gradient background
       • large decorative illustration shape (style-specific)
       • bold motif layer
       • accent panels / bars
       • genre badge
       • title, subtitle, tagline, author line — all properly positioned
  4. Prepend cover to original PDF or DOCX
  5. Return output path + concept metadata

Bug fixes vs v2:
  - run.font.letter_spacing removed (invalid python-docx attribute → crash)
  - Alpha blending on rects now uses saveState/setFillAlpha properly
  - Motif covers full page, not just right half
  - y_title computed dynamically so long titles never overflow bottom band
  - Genre badge rendered without broken alpha rects
  - Complete visual overhaul: style-specific illustration shapes, panels,
    texture layers, decorative rules — covers now look like real books
"""

from __future__ import annotations

import math
import os
import json
import uuid
import shutil
import random
from pathlib import Path

from openai import OpenAI           # pyrefly: ignore [missing-import]
from dotenv import load_dotenv      # pyrefly: ignore [missing-import]

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL  = "gpt-4o"


# ─────────────────────────────────────────────────────────────────────────────
# AI: Generate cover concept
# ─────────────────────────────────────────────────────────────────────────────

COVER_SYSTEM_PROMPT = """You are a world-class book cover designer and creative director.
Given a book title (and optional subtitle/description/design style), you produce a complete cover design brief.

The caller may pass a `design_style` hint. Honour it strictly:
- "normal"      → clean, readable, balanced layout; neutral tones; accessible to any audience
- "premium"     → rich dark backgrounds, gold/silver accents, elegant serif feel, luxury typography weight
- "scifi"       → deep space blacks/navy, neon cyan/purple accents, futuristic geometric motifs, high-contrast
- "minimalist"  → maximum whitespace, monochrome or single accent colour, ultra-thin rule lines, sparse motif
- "fantasy"     → deep jewel tones (emerald, burgundy, midnight blue), ornate flourish motif, mystical feel
- "thriller"    → high contrast, dark moody palette, sharp diagonal or shattered motifs, urgent title treatment
- "romance"     → warm blush/rose/gold palette, soft curves or floral motif, elegant script feel
- "academic"    → muted professional tones, grid or line motifs, structured layout, no decorative excess
- "vibrant"     → bold saturated colours, energetic scattered-dot or wave motifs, modern and loud
- "retro"       → warm sepia/mustard/rust palette, diagonal stripe or dot-grid motif, vintage character
If no style is given, default to "premium".

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "title": "<display title — may add line breaks with \\n for layout>",
  "subtitle": "<compelling subtitle or empty string>",
  "tagline": "<one punchy sentence that captures the book's essence>",
  "author_line": "<e.g. 'A comprehensive guide' or author name, or leave empty>",
  "palette": {
    "bg_top":        "<hex — gradient top, e.g. #0f172a>",
    "bg_bottom":     "<hex — gradient bottom, e.g. #1e3a5f>",
    "panel_color":   "<hex — mid-page accent panel background, e.g. #1e293b>",
    "accent":        "<hex — accent elements, rules, ornaments>",
    "title_color":   "<hex — title text, must strongly contrast bg>",
    "subtitle_color":"<hex — subtitle text>",
    "tagline_color": "<hex — tagline text>"
  },
  "style": "<one of: normal|premium|scifi|minimalist|fantasy|thriller|romance|academic|vibrant|retro>",
  "motif": "<one of: concentric_circles | diagonal_stripes | scattered_dots | grid_lines | wave_curves | hexagons | triangles | stars | arcs | none>",
  "illustration_shape": "<one of: large_circle | diamond | arch | triangle | cross_lines | sunburst | none>",
  "genre_label": "<e.g. BUSINESS | SELF-HELP | SCIENCE | FICTION | HISTORY — uppercase, max 20 chars>"
}"""


def generate_cover_concept(book_title: str, description: str = "", design_style: str = "") -> dict:
    prompt = f"Book title: {book_title}"
    if description:
        prompt += f"\nDescription: {description}"
    prompt += f"\nDesign style: {design_style or 'premium'}"

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": COVER_SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
        temperature=0.85,
        max_tokens=900,
    )
    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    s, e = raw.find("{"), raw.rfind("}") + 1
    if s == -1 or e == 0:
        raise ValueError("No JSON in cover concept response")
    concept = json.loads(raw[s:e])

    # Ensure new fields have defaults if AI omits them
    concept.setdefault("illustration_shape", "large_circle")
    p = concept.setdefault("palette", {})
    p.setdefault("panel_color", p.get("bg_bottom", "#1e293b"))
    return concept


# ─────────────────────────────────────────────────────────────────────────────
# Colour helpers
# ─────────────────────────────────────────────────────────────────────────────

def _hex(h: str) -> tuple[float, float, float]:
    """#RRGGBB → (r, g, b) floats 0–1."""
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _blend(c1: tuple, c2: tuple, t: float) -> tuple:
    return (_lerp(c1[0], c2[0], t), _lerp(c1[1], c2[1], t), _lerp(c1[2], c2[2], t))


# ─────────────────────────────────────────────────────────────────────────────
# PDF cover page renderer  — full visual design
# ─────────────────────────────────────────────────────────────────────────────

def render_cover_pdf(concept: dict, output_path: str) -> str:
    from reportlab.pdfgen import canvas as rl_canvas   # pyrefly: ignore [missing-import]
    from reportlab.lib.pagesizes import A4              # pyrefly: ignore [missing-import]
    from reportlab.lib.units import mm                  # pyrefly: ignore [missing-import]
    from reportlab.lib.colors import Color              # pyrefly: ignore [missing-import]

    W, H = A4  # 595 × 842 pts

    c = rl_canvas.Canvas(output_path, pagesize=A4)

    palette  = concept.get("palette", {})
    motif    = concept.get("motif", "none").lower()
    illus    = concept.get("illustration_shape", "large_circle").lower()
    style    = concept.get("style", "premium").lower()

    # Resolve colours
    bg_top      = _hex(palette.get("bg_top",         "#0f172a"))
    bg_bot      = _hex(palette.get("bg_bottom",      "#1e3a5f"))
    panel_col   = _hex(palette.get("panel_color",    "#1e293b"))
    acc         = _hex(palette.get("accent",         "#f59e0b"))
    title_col   = _hex(palette.get("title_color",    "#ffffff"))
    sub_col     = _hex(palette.get("subtitle_color", "#e2e8f0"))
    tag_col     = _hex(palette.get("tagline_color",  "#94a3b8"))

    # ── Helper: set fill with alpha via saveState ────────────────────────────
    def fill_alpha(rgb: tuple, alpha: float = 1.0):
        c.saveState()
        c.setFillColorRGB(*rgb, alpha=alpha)

    def restore():
        c.restoreState()

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 1: Full-bleed gradient background (fine bands)
    # ════════════════════════════════════════════════════════════════════════
    BANDS = 120
    for i in range(BANDS):
        t  = i / BANDS
        rc = _blend(bg_top, bg_bot, t)
        c.setFillColorRGB(*rc)
        bh = H / BANDS + 1
        c.rect(0, H - (i + 1) * bh, W, bh + 1, fill=1, stroke=0)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 2: Large illustration / hero shape (style-aware)
    # ════════════════════════════════════════════════════════════════════════
    cx, cy = W * 0.72, H * 0.62   # anchor for shape

    if illus == "large_circle":
        # Three concentric filled circles, largest first (darkest), glow effect
        for radius, alpha in [(195, 0.18), (145, 0.22), (95, 0.30), (52, 0.40)]:
            c.saveState()
            c.setFillColorRGB(*acc, alpha=alpha)
            c.circle(cx, cy, radius, fill=1, stroke=0)
            c.restoreState()
        # Bright core
        c.saveState()
        c.setFillColorRGB(*acc, alpha=0.55)
        c.circle(cx, cy, 28, fill=1, stroke=0)
        c.restoreState()

    elif illus == "diamond":
        # Bold rotated square (diamond)
        def diamond(ox, oy, size, alpha):
            c.saveState()
            c.setFillColorRGB(*acc, alpha=alpha)
            c.translate(ox, oy)
            c.rotate(45)
            c.rect(-size / 2, -size / 2, size, size, fill=1, stroke=0)
            c.restoreState()
        diamond(cx, cy, 260, 0.14)
        diamond(cx, cy, 180, 0.20)
        diamond(cx, cy, 110, 0.28)
        diamond(cx, cy, 55,  0.45)

    elif illus == "arch":
        # Tall arch — two vertical rects + semicircle top
        aw, ah = 160, 220
        c.saveState()
        c.setFillColorRGB(*acc, alpha=0.22)
        c.roundRect(cx - aw / 2, cy - ah / 2, aw, ah, aw / 2, fill=1, stroke=0)
        c.restoreState()
        c.saveState()
        c.setFillColorRGB(*acc, alpha=0.12)
        c.roundRect(cx - aw / 2 - 30, cy - ah / 2 - 20, aw + 60, ah + 40, (aw + 60) / 2, fill=1, stroke=0)
        c.restoreState()

    elif illus == "triangle":
        def triangle_shape(ox, oy, size, alpha):
            c.saveState()
            c.setFillColorRGB(*acc, alpha=alpha)
            path = c.beginPath()
            path.moveTo(ox, oy + size * 0.6)
            path.lineTo(ox - size * 0.52, oy - size * 0.4)
            path.lineTo(ox + size * 0.52, oy - size * 0.4)
            path.close()
            c.drawPath(path, fill=1, stroke=0)
            c.restoreState()
        triangle_shape(cx, cy, 310, 0.12)
        triangle_shape(cx, cy, 210, 0.18)
        triangle_shape(cx, cy, 130, 0.26)
        triangle_shape(cx, cy, 70,  0.40)

    elif illus == "sunburst":
        # Radial lines from centre
        for angle in range(0, 360, 15):
            rad = math.radians(angle)
            x1  = cx + math.cos(rad) * 35
            y1  = cy + math.sin(rad) * 35
            x2  = cx + math.cos(rad) * 210
            y2  = cy + math.sin(rad) * 210
            c.saveState()
            c.setStrokeColorRGB(*acc, alpha=0.18)
            c.setLineWidth(3.5)
            c.line(x1, y1, x2, y2)
            c.restoreState()
        # Central glow
        c.saveState()
        c.setFillColorRGB(*acc, alpha=0.40)
        c.circle(cx, cy, 38, fill=1, stroke=0)
        c.restoreState()

    elif illus == "cross_lines":
        # Two thick crossing bars
        c.saveState()
        c.setFillColorRGB(*acc, alpha=0.18)
        c.rect(cx - 10, cy - 200, 20, 400, fill=1, stroke=0)
        c.rect(cx - 200, cy - 10, 400, 20, fill=1, stroke=0)
        c.restoreState()
        c.saveState()
        c.setFillColorRGB(*acc, alpha=0.30)
        c.circle(cx, cy, 30, fill=1, stroke=0)
        c.restoreState()

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 3: Motif texture (full page, both halves)
    # ════════════════════════════════════════════════════════════════════════
    rng = random.Random(42)

    if motif == "concentric_circles":
        for radius in range(20, int(W * 0.9), 32):
            c.saveState()
            c.setStrokeColorRGB(*acc, alpha=max(0.02, 0.10 - radius * 0.0002))
            c.setLineWidth(0.8)
            c.circle(W * 0.5, H * 0.5, radius, fill=0, stroke=1)
            c.restoreState()

    elif motif == "diagonal_stripes":
        for x in range(-int(H), int(W) + int(H), 24):
            c.saveState()
            c.setStrokeColorRGB(*acc, alpha=0.07)
            c.setLineWidth(1.2)
            c.line(x, 0, x + H, H)
            c.restoreState()

    elif motif == "scattered_dots":
        for _ in range(160):
            px    = rng.uniform(0, W)
            py    = rng.uniform(0, H)
            pr    = rng.uniform(1.5, 5.5)
            alpha = rng.uniform(0.04, 0.18)
            c.saveState()
            c.setFillColorRGB(*acc, alpha=alpha)
            c.circle(px, py, pr, fill=1, stroke=0)
            c.restoreState()

    elif motif == "grid_lines":
        for x in range(0, int(W), 28):
            c.saveState()
            c.setStrokeColorRGB(*acc, alpha=0.06)
            c.setLineWidth(0.6)
            c.line(x, 0, x, H)
            c.restoreState()
        for y in range(0, int(H), 28):
            c.saveState()
            c.setStrokeColorRGB(*acc, alpha=0.06)
            c.setLineWidth(0.6)
            c.line(0, y, W, y)
            c.restoreState()

    elif motif == "wave_curves":
        for offset in range(-80, 300, 30):
            c.saveState()
            c.setStrokeColorRGB(*acc, alpha=0.10)
            c.setLineWidth(1.6)
            path = c.beginPath()
            path.moveTo(0, H * 0.45 + offset)
            for px in range(0, int(W) + 10, 6):
                py = H * 0.45 + offset + math.sin(px * 0.020) * 50
                path.lineTo(px, py)
            c.drawPath(path, stroke=1, fill=0)
            c.restoreState()

    elif motif == "hexagons":
        hex_r = 22
        cols  = int(W / (hex_r * 1.8)) + 2
        rows  = int(H / (hex_r * 1.55)) + 2
        for row in range(rows):
            for col in range(cols):
                hx = col * hex_r * 1.75 + (hex_r * 0.9 if row % 2 else 0)
                hy = row * hex_r * 1.52
                pts = [
                    (hx + hex_r * math.cos(math.radians(60 * i + 30)),
                     hy + hex_r * math.sin(math.radians(60 * i + 30)))
                    for i in range(6)
                ]
                c.saveState()
                c.setStrokeColorRGB(*acc, alpha=0.06)
                c.setLineWidth(0.7)
                path = c.beginPath()
                path.moveTo(*pts[0])
                for pt in pts[1:]:
                    path.lineTo(*pt)
                path.close()
                c.drawPath(path, stroke=1, fill=0)
                c.restoreState()

    elif motif == "triangles":
        tri_s = 48
        for row in range(0, int(H) + tri_s, tri_s):
            for col in range(0, int(W) + tri_s, tri_s):
                c.saveState()
                c.setStrokeColorRGB(*acc, alpha=0.06)
                c.setLineWidth(0.7)
                path = c.beginPath()
                if (row // tri_s + col // tri_s) % 2 == 0:
                    path.moveTo(col, row)
                    path.lineTo(col + tri_s, row)
                    path.lineTo(col + tri_s / 2, row + tri_s)
                else:
                    path.moveTo(col + tri_s / 2, row)
                    path.lineTo(col, row + tri_s)
                    path.lineTo(col + tri_s, row + tri_s)
                path.close()
                c.drawPath(path, stroke=1, fill=0)
                c.restoreState()

    elif motif == "stars":
        for _ in range(80):
            sx    = rng.uniform(0, W)
            sy    = rng.uniform(0, H)
            sr    = rng.uniform(1, 3)
            alpha = rng.uniform(0.06, 0.30)
            c.saveState()
            c.setFillColorRGB(*acc, alpha=alpha)
            c.circle(sx, sy, sr, fill=1, stroke=0)
            c.restoreState()
        # a few larger star shapes
        for _ in range(12):
            sx = rng.uniform(0, W)
            sy = rng.uniform(0, H)
            c.saveState()
            c.setStrokeColorRGB(*acc, alpha=0.14)
            c.setLineWidth(0.6)
            for a in range(0, 360, 45):
                rad = math.radians(a)
                c.line(sx + math.cos(rad) * 3, sy + math.sin(rad) * 3,
                       sx + math.cos(rad) * 10, sy + math.sin(rad) * 10)
            c.restoreState()

    elif motif == "arcs":
        for i, (ox, oy, start_r) in enumerate([(0, 0, 40), (W, 0, 40), (0, H, 40), (W, H, 40)]):
            for r in range(start_r, 320, 38):
                c.saveState()
                c.setStrokeColorRGB(*acc, alpha=max(0.03, 0.14 - r * 0.0003))
                c.setLineWidth(1.0)
                c.arc(ox - r, oy - r, ox + r, oy + r, startAng=0, extent=90)
                c.restoreState()

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 4: Thick left accent bar
    # ════════════════════════════════════════════════════════════════════════
    c.setFillColorRGB(*acc)
    c.rect(0, 0, 7, H, fill=1, stroke=0)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 5: Mid-page panel (gives text a clean reading surface)
    # ════════════════════════════════════════════════════════════════════════
    panel_h = H * 0.48
    panel_y = H * 0.24
    c.saveState()
    c.setFillColorRGB(*panel_col, alpha=0.72)
    c.rect(0, panel_y, W, panel_h, fill=1, stroke=0)
    c.restoreState()

    # Panel top/bottom accent lines
    c.saveState()
    c.setStrokeColorRGB(*acc)
    c.setLineWidth(2.5)
    c.line(0, panel_y + panel_h, W, panel_y + panel_h)
    c.line(0, panel_y,           W, panel_y)
    c.restoreState()

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 6: Genre badge (top-left, above panel)
    # ════════════════════════════════════════════════════════════════════════
    genre = concept.get("genre_label", "").upper()[:20].strip()
    if genre:
        badge_x = 20 * mm
        badge_y = H - 26 * mm
        badge_w = len(genre) * 7.2 + 28
        badge_h = 22

        # Badge background (two rects for solid + accent feel without alpha issues)
        c.setFillColorRGB(*_blend(bg_bot, (0,0,0), 0.3))
        c.roundRect(badge_x, badge_y, badge_w, badge_h, 4, fill=1, stroke=0)
        # Accent left stripe on badge
        c.setFillColorRGB(*acc)
        c.roundRect(badge_x, badge_y, 5, badge_h, 2, fill=1, stroke=0)
        # Badge text
        c.setFillColorRGB(*acc)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(badge_x + 11, badge_y + 6.5, genre)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 7: Title block — positioned inside panel
    # ════════════════════════════════════════════════════════════════════════
    title_lines = [ln.strip() for ln in concept.get("title", "Book Title").split("\n") if ln.strip()]
    max_line    = max(len(ln) for ln in title_lines)
    font_size   = 52 if max_line <= 14 else 44 if max_line <= 20 else 36 if max_line <= 28 else 28

    TEXT_LEFT = 20 * mm + 10  # indent past accent bar

    # Start title near panel top, working downward
    y_cursor = panel_y + panel_h - 18  # just inside top of panel
    c.setFillColorRGB(*title_col)
    c.setFont("Helvetica-Bold", font_size)
    for line in title_lines:
        y_cursor -= (font_size + 6)
        c.drawString(TEXT_LEFT, y_cursor, line)
    y_cursor -= 10

    # Decorative accent rule below title (full panel width)
    c.setFillColorRGB(*acc)
    c.rect(TEXT_LEFT, y_cursor, W - TEXT_LEFT - 20 * mm, 3.5, fill=1, stroke=0)
    y_cursor -= 14

    # ── Subtitle ─────────────────────────────────────────────────────────────
    subtitle = concept.get("subtitle", "").strip()
    if subtitle:
        c.setFillColorRGB(*sub_col)
        c.setFont("Helvetica", 16)
        for word_line in _wrap(subtitle, max_chars=46):
            y_cursor -= 22
            c.drawString(TEXT_LEFT, y_cursor, word_line)
        y_cursor -= 8

    # ── Tagline (italic) ──────────────────────────────────────────────────────
    tagline = concept.get("tagline", "").strip()
    if tagline:
        c.setFillColorRGB(*tag_col)
        c.setFont("Helvetica-Oblique", 11)
        for word_line in _wrap(tagline, max_chars=62):
            y_cursor -= 16
            c.drawString(TEXT_LEFT, y_cursor, word_line)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 8: Bottom band — dark solid, no alpha needed
    # ════════════════════════════════════════════════════════════════════════
    BAND_H = 22 * mm
    # Compute bottom colour as darker version of bg_bot
    bot_band = _blend(bg_bot, (0, 0, 0), 0.55)
    c.setFillColorRGB(*bot_band)
    c.rect(0, 0, W, BAND_H, fill=1, stroke=0)

    # Thin accent top-line on band
    c.setFillColorRGB(*acc)
    c.rect(0, BAND_H, W, 2.5, fill=1, stroke=0)

    # Author line (left)
    author_line = concept.get("author_line", "").strip()
    if author_line:
        c.setFillColorRGB(*sub_col)
        c.setFont("Helvetica", 10)
        c.drawString(20 * mm, BAND_H * 0.40, author_line)

    # Brand / watermark (right)
    c.setFillColorRGB(*acc)
    c.setFont("Helvetica-Bold", 9)
    c.drawRightString(W - 20 * mm, BAND_H * 0.40, "EDITORIAL AI")

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 9: Top decorative highlight bar
    # ════════════════════════════════════════════════════════════════════════
    c.saveState()
    c.setFillColorRGB(*acc, alpha=0.30)
    c.rect(0, H - 6, W, 6, fill=1, stroke=0)
    c.restoreState()

    c.showPage()
    c.save()
    return output_path


def _wrap(text: str, max_chars: int = 50) -> list[str]:
    """Simple word-wrap into lines of at most max_chars characters."""
    words = text.split()
    lines, cur = [], []
    for w in words:
        if len(" ".join(cur + [w])) > max_chars:
            if cur:
                lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines or [""]


# ─────────────────────────────────────────────────────────────────────────────
# Prepend cover to existing PDF
# ─────────────────────────────────────────────────────────────────────────────

def prepend_cover_to_pdf(cover_pdf: str, original_pdf: str, output_pdf: str) -> str:
    from pypdf import PdfWriter, PdfReader   # pyrefly: ignore [missing-import]
    writer = PdfWriter()
    for page in PdfReader(cover_pdf).pages:
        writer.add_page(page)
    for page in PdfReader(original_pdf).pages:
        writer.add_page(page)
    with open(output_pdf, "wb") as f:
        writer.write(f)
    return output_pdf


# ─────────────────────────────────────────────────────────────────────────────
# DOCX cover page renderer + prepend
# ─────────────────────────────────────────────────────────────────────────────

def prepend_cover_to_docx(concept: dict, original_docx: str, output_docx: str) -> str:
    from docx import Document                           # pyrefly: ignore [missing-import]
    from docx.shared import Pt, RGBColor, Cm           # pyrefly: ignore [missing-import]
    from docx.enum.text import WD_ALIGN_PARAGRAPH      # pyrefly: ignore [missing-import]
    from docx.oxml.ns import qn                        # pyrefly: ignore [missing-import]
    from docx.oxml import OxmlElement                  # pyrefly: ignore [missing-import]
    import copy

    palette  = concept.get("palette", {})

    def rgb(key: str, fallback: str = "#1a1a1a") -> RGBColor:
        h = palette.get(key, fallback).lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    cover_doc = Document()
    section   = cover_doc.sections[0]
    section.page_height   = Cm(29.7)
    section.page_width    = Cm(21.0)
    section.left_margin   = Cm(2.5)
    section.right_margin  = Cm(2.5)
    section.top_margin    = Cm(3.0)
    section.bottom_margin = Cm(2.0)

    def add_para(text: str, size: float, bold: bool = False, italic: bool = False,
                 color_key: str = "title_color", fallback: str = "#ffffff",
                 align=WD_ALIGN_PARAGRAPH.LEFT,
                 space_before: float = 0, space_after: float = 0) -> None:
        p   = cover_doc.add_paragraph()
        p.alignment = align
        pf  = p.paragraph_format
        pf.space_before = Pt(space_before)
        pf.space_after  = Pt(space_after)
        run = p.add_run(text)
        run.font.size   = Pt(size)
        run.font.bold   = bold
        run.font.italic = italic
        run.font.color.rgb = rgb(color_key, fallback)

    def add_rule(color_key: str = "accent", fallback: str = "#f59e0b") -> None:
        h   = palette.get(color_key, fallback).lstrip("#")
        if len(h) == 3:
            h = "".join(x * 2 for x in h)
        p   = cover_doc.add_paragraph()
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bt   = OxmlElement("w:bottom")
        bt.set(qn("w:val"),   "single")
        bt.set(qn("w:sz"),    "16")
        bt.set(qn("w:space"), "1")
        bt.set(qn("w:color"), h)
        pBdr.append(bt)
        pPr.append(pBdr)
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after  = Pt(4)

    # Genre label
    genre = concept.get("genre_label", "").upper().strip()
    if genre:
        add_para(f"— {genre} —", size=9, bold=True,
                 color_key="accent", fallback="#f59e0b",
                 space_after=2)

    # Spacer
    for _ in range(3):
        cover_doc.add_paragraph()

    # Title lines
    title_lines = [ln.strip() for ln in concept.get("title", "").split("\n") if ln.strip()]
    for line in title_lines:
        add_para(line, size=38, bold=True,
                 color_key="title_color", fallback="#ffffff", space_after=4)

    add_rule()

    # Subtitle
    subtitle = concept.get("subtitle", "").strip()
    if subtitle:
        add_para(subtitle, size=16,
                 color_key="subtitle_color", fallback="#e2e8f0",
                 space_before=4, space_after=8)

    # Tagline
    tagline = concept.get("tagline", "").strip()
    if tagline:
        add_para(tagline, size=11, italic=True,
                 color_key="tagline_color", fallback="#94a3b8",
                 space_after=6)

    # Push author to bottom
    for _ in range(5):
        cover_doc.add_paragraph()

    add_rule()

    author_line = concept.get("author_line", "").strip()
    if author_line:
        add_para(author_line, size=11,
                 color_key="subtitle_color", fallback="#e2e8f0",
                 space_before=6)

    cover_doc.add_page_break()

    tmp_cover = output_docx + ".cover_tmp.docx"
    cover_doc.save(tmp_cover)

    # Merge cover + original
    orig_doc = Document(original_docx)
    out_doc  = Document(tmp_cover)
    for element in orig_doc.element.body:
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
    book_title: str   = "",
    description: str  = "",
    design_style: str = "",
) -> dict:
    """
    Full pipeline:
      1. Extract title from filename if not provided
      2. Generate AI cover concept (GPT-4o)
      3. Render cover page and prepend to original file
    Returns dict with output_path, concept, ext, job_id.
    """
    os.makedirs(output_dir, exist_ok=True)
    ext = os.path.splitext(filename)[1].lower()

    if not book_title:
        book_title = Path(filename).stem.replace("_", " ").replace("-", " ").title()

    concept  = generate_cover_concept(book_title, description, design_style)
    job_id   = uuid.uuid4().hex
    out_path = os.path.join(output_dir, f"cover_{job_id}{ext}")

    if ext == ".pdf":
        cover_pdf = os.path.join(output_dir, f"coverpage_{job_id}.pdf")
        render_cover_pdf(concept, cover_pdf)
        prepend_cover_to_pdf(cover_pdf, file_path, out_path)
        if os.path.exists(cover_pdf):
            os.remove(cover_pdf)

    elif ext == ".docx":
        prepend_cover_to_docx(concept, file_path, out_path)

    else:
        raise ValueError(f"Unsupported file type: {ext}. Upload a .pdf or .docx")

    return {
        "output_path": out_path,
        "concept":     concept,
        "ext":         ext,
        "job_id":      job_id,
    }