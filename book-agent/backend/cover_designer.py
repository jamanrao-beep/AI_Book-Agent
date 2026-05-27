"""
cover_designer.py  ·  v4.0
AI-powered book cover designer — publication-quality, fully layered covers.

Design system (9 layers per cover):
  1.  Full-bleed gradient background  (120 fine bands, smooth)
  2.  Ambient radial glow             (soft halo behind hero)
  3.  Hero illustration shape         (large_circle | diamond | arch |
                                       triangle | sunburst | shatter | cross)
  4.  Motif texture layer             (full-page, fine opacity)
  5.  Thick left accent bar           (solid, style accent colour)
  6.  Mid-page semi-transparent panel (clean text surface)
  7.  Genre badge                     (solid badge, accent stripe)
  8.  Typography block                (title → rule → subtitle → tagline)
  9.  Bottom author band              (dark, no alpha needed)
     + top highlight strip

Bug fixes vs v2/v3:
  • run.font.letter_spacing removed  (invalid python-docx attr → crash)
  • All alpha rects use saveState()/restoreState()  (ReportLab requirement)
  • Motifs span full page, not just right half
  • y_cursor computed dynamically — no overflow into bottom band
  • Genre badge rendered without broken alpha rects
"""

from __future__ import annotations

import math
import os
import json
import uuid
import random
from pathlib import Path

from openai import OpenAI       # pyrefly: ignore [missing-import]
from dotenv import load_dotenv  # pyrefly: ignore [missing-import]

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL  = "gpt-4o"


# ─────────────────────────────────────────────────────────────────────────────
# AI: Generate cover concept
# ─────────────────────────────────────────────────────────────────────────────

COVER_SYSTEM_PROMPT = """You are a world-class book cover designer at a top publishing house.
Given a book title, description and design style you produce a precise, production-ready cover brief.

Honour the design_style strictly:
  normal     → clean neutral tones, balanced, accessible
  premium    → deep dark bg (#0b0c1a–#1a1035), gold accent (#c8a200), luxury serif weight
  scifi      → near-black navy (#020818–#071428), neon cyan accent (#00d4ff), geometric hex motif
  minimalist → white or very light bg, single muted accent, ultra-sparse decoration
  fantasy    → dark jewel bg (#0d0b1f–#1a0f2e), violet/purple accent (#9f7aea), diamond+stars motif
  thriller   → near-black bg (#0a0a0a–#1a0505), red accent (#ef4444), shatter/crack motif
  romance    → blush/rose bg (#1a0812–#2d0f1a), rose-gold accent (#e8948a), curve/arch motif
  academic   → white/light-grey bg, navy or teal accent, grid/line motif, structured
  vibrant    → bold saturated bg, energetic contrast accent, scattered-dot or wave
  retro      → warm sepia bg (#1a1208–#2a1e0c), rust/amber accent (#c27b2a), stripe motif
Default → premium.

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "title":         "<book title, use \\n for intentional line breaks>",
  "subtitle":      "<compelling subtitle or empty string>",
  "tagline":       "<one punchy line capturing the essence>",
  "author_line":   "<author name or series line, or empty>",
  "palette": {
    "bg_top":          "<hex — gradient top>",
    "bg_bottom":       "<hex — gradient bottom, same family, darker>",
    "panel_bg":        "<hex — panel behind text, very dark version of bg>",
    "accent":          "<hex — accent colour: bars, rules, badge, ornament>",
    "title_color":     "<hex — title text, high contrast on panel_bg>",
    "subtitle_color":  "<hex — subtitle, slightly dimmer than title>",
    "tagline_color":   "<hex — tagline, muted>"
  },
  "style":              "<style key>",
  "motif":              "<one of: concentric_circles | diagonal_stripes | scattered_dots | grid_lines | wave_curves | hexagons | triangles | stars | arcs | shatter | none>",
  "illustration_shape": "<one of: large_circle | diamond | arch | triangle | sunburst | shatter | cross | none>",
  "genre_label":        "<BUSINESS | FICTION | THRILLER | FANTASY | SCI-FI | ROMANCE | ACADEMIC | HISTORY | SELF-HELP | POETRY — uppercase, max 12 chars>"
}"""


def generate_cover_concept(book_title: str, description: str = "", design_style: str = "") -> dict:
    prompt = f"Book title: {book_title}"
    if description:
        prompt += f"\nDescription: {description}"
    prompt += f"\nDesign style: {design_style or 'premium'}"

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": COVER_SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
        temperature=0.82,
        max_tokens=900,
    )
    raw = resp.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    s, e = raw.find("{"), raw.rfind("}") + 1
    if s == -1 or e == 0:
        raise ValueError("No JSON in cover concept response")
    concept = json.loads(raw[s:e])

    # Defaults for any fields the AI might omit
    concept.setdefault("illustration_shape", "large_circle")
    concept.setdefault("motif", "concentric_circles")
    p = concept.setdefault("palette", {})
    p.setdefault("bg_top",         "#0b0c1a")
    p.setdefault("bg_bottom",      "#1a1035")
    p.setdefault("panel_bg",       "#07060f")
    p.setdefault("accent",         "#c8a200")
    p.setdefault("title_color",    "#ffffff")
    p.setdefault("subtitle_color", "#c8b86a")
    p.setdefault("tagline_color",  "#8b8faa")
    return concept


# ─────────────────────────────────────────────────────────────────────────────
# Colour helpers
# ─────────────────────────────────────────────────────────────────────────────

def _hex(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255


def _blend(c1: tuple, c2: tuple, t: float) -> tuple:
    return (c1[0] + (c2[0] - c1[0]) * t,
            c1[1] + (c2[1] - c1[1]) * t,
            c1[2] + (c2[2] - c1[2]) * t)


def _darken(c: tuple, amount: float = 0.45) -> tuple:
    return _blend(c, (0.0, 0.0, 0.0), amount)


def _word_wrap(text: str, max_chars: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur: list[str] = []
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
# PDF cover renderer — full premium design
# ─────────────────────────────────────────────────────────────────────────────

def render_cover_pdf(concept: dict, output_path: str) -> str:
    from reportlab.pdfgen import canvas as rl_canvas  # pyrefly: ignore
    from reportlab.lib.pagesizes import A4             # pyrefly: ignore
    from reportlab.lib.units import mm                 # pyrefly: ignore

    W, H = A4   # 595.28 × 841.89 pts
    c = rl_canvas.Canvas(output_path, pagesize=A4)

    pal   = concept.get("palette", {})
    motif = concept.get("motif", "none").lower().replace(" ", "_")
    illus = concept.get("illustration_shape", "large_circle").lower().replace(" ", "_")

    bg_top    = _hex(pal.get("bg_top",         "#0b0c1a"))
    bg_bot    = _hex(pal.get("bg_bottom",       "#1a1035"))
    panel_bg  = _hex(pal.get("panel_bg",        "#07060f"))
    acc       = _hex(pal.get("accent",          "#c8a200"))
    title_c   = _hex(pal.get("title_color",     "#ffffff"))
    sub_c     = _hex(pal.get("subtitle_color",  "#c8b86a"))
    tag_c     = _hex(pal.get("tagline_color",   "#8b8faa"))

    rng = random.Random(99)

    # ── convenience wrappers ─────────────────────────────────────────────────
    def fill(rgb, alpha=1.0):
        if alpha < 1.0:
            c.saveState()
            c.setFillColorRGB(*rgb, alpha=alpha)
        else:
            c.setFillColorRGB(*rgb)

    def unfill():
        c.restoreState()

    def stroke(rgb, alpha=1.0):
        if alpha < 1.0:
            c.saveState()
            c.setStrokeColorRGB(*rgb, alpha=alpha)
        else:
            c.setStrokeColorRGB(*rgb)

    def unstroke():
        c.restoreState()

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 1 — Gradient background (120 fine horizontal bands)
    # ════════════════════════════════════════════════════════════════════════
    BANDS = 120
    for i in range(BANDS):
        t  = i / BANDS
        rc = _blend(bg_top, bg_bot, t)
        c.setFillColorRGB(*rc)
        bh = H / BANDS + 1
        c.rect(0, H - (i + 1) * bh, W, bh + 1, fill=1, stroke=0)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 2 — Ambient radial glow (soft halo, large)
    # ════════════════════════════════════════════════════════════════════════
    # Simulate with concentric ellipses fading out
    HX, HY = W * 0.72, H * 0.60   # hero centre
    for r, a in [(220, 0.06), (170, 0.09), (120, 0.12), (80, 0.10), (45, 0.08)]:
        fill(acc, a)
        c.ellipse(HX - r, HY - r * 0.85, HX + r, HY + r * 0.85, fill=1, stroke=0)
        unfill()

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 3 — Hero illustration shape (style-specific, large & dramatic)
    # ════════════════════════════════════════════════════════════════════════
    if illus == "large_circle":
        # Multi-ring glow: 5 filled circles + ring outlines + bright core
        for r, a in [(200, 0.10), (155, 0.15), (108, 0.22), (68, 0.32), (36, 0.50)]:
            fill(acc, a); c.circle(HX, HY, r, fill=1, stroke=0); unfill()
        for r, sw, a in [(68, 1.2, 0.55), (108, 0.8, 0.32), (155, 0.6, 0.18), (200, 0.4, 0.10)]:
            stroke(acc, a); c.setLineWidth(sw); c.circle(HX, HY, r, fill=0, stroke=1); unstroke()
        # Cross-hair lines
        stroke(acc, 0.22); c.setLineWidth(0.7)
        c.line(HX, HY - 210, HX, HY + 210)
        c.line(HX - 210, HY, HX + 210, HY)
        unstroke()
        # Core bright dot
        fill(acc); c.circle(HX, HY, 10, fill=1, stroke=0)

    elif illus == "diamond":
        def _diamond(ox, oy, s, a):
            fill(acc, a)
            c.saveState(); c.translate(ox, oy); c.rotate(45)
            c.rect(-s/2, -s/2, s, s, fill=1, stroke=0)
            c.restoreState(); unfill()
        def _diamond_ring(ox, oy, s, sw, a):
            stroke(acc, a); c.setLineWidth(sw)
            c.saveState(); c.translate(ox, oy); c.rotate(45)
            c.rect(-s/2, -s/2, s, s, fill=0, stroke=1)
            c.restoreState(); unstroke()
        _diamond(HX, HY, 290, 0.07)
        _diamond(HX, HY, 210, 0.13)
        _diamond(HX, HY, 140, 0.22)
        _diamond(HX, HY, 80,  0.38)
        _diamond_ring(HX, HY, 80,  1.4, 0.60)
        _diamond_ring(HX, HY, 140, 0.9, 0.35)
        _diamond_ring(HX, HY, 210, 0.6, 0.20)
        _diamond_ring(HX, HY, 290, 0.4, 0.10)
        # Radiating lines from corners
        stroke(acc, 0.18); c.setLineWidth(0.7)
        for ang in [45, 135, 225, 315]:
            rad = math.radians(ang)
            x1 = HX + math.cos(rad) * 58; y1 = HY + math.sin(rad) * 58
            x2 = HX + math.cos(rad) * 220; y2 = HY + math.sin(rad) * 220
            c.line(x1, y1, x2, y2)
        unstroke()
        fill(acc); c.circle(HX, HY, 10, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1); c.circle(HX, HY, 4.5, fill=1, stroke=0)

    elif illus == "arch":
        # Tall luminous arch: rounded rect + outer glow rings
        aw, ah = 175, 250
        for extra, a in [(80, 0.07), (50, 0.12), (20, 0.20), (0, 0.35)]:
            fill(acc, a)
            c.roundRect(HX - aw/2 - extra/2, HY - ah/2 - extra/2,
                        aw + extra, ah + extra, (aw + extra) / 2, fill=1, stroke=0)
            unfill()
        # Arch outline
        stroke(acc, 0.55); c.setLineWidth(1.5)
        c.roundRect(HX - aw/2, HY - ah/2, aw, ah, aw/2, fill=0, stroke=1)
        unstroke()
        fill(acc); c.circle(HX, HY, 10, fill=1, stroke=0)

    elif illus == "triangle":
        def _tri(ox, oy, s, a):
            fill(acc, a)
            path = c.beginPath()
            path.moveTo(ox, oy + s * 0.62)
            path.lineTo(ox - s * 0.54, oy - s * 0.38)
            path.lineTo(ox + s * 0.54, oy - s * 0.38)
            path.close(); c.drawPath(path, fill=1, stroke=0); unfill()
        _tri(HX, HY, 290, 0.08); _tri(HX, HY, 220, 0.14)
        _tri(HX, HY, 150, 0.22); _tri(HX, HY, 90,  0.36)
        # Outline
        stroke(acc, 0.55); c.setLineWidth(1.4)
        path = c.beginPath()
        s90 = 90
        path.moveTo(HX, HY + s90*0.62)
        path.lineTo(HX - s90*0.54, HY - s90*0.38)
        path.lineTo(HX + s90*0.54, HY - s90*0.38)
        path.close(); c.drawPath(path, stroke=1, fill=0); unstroke()
        fill(acc); c.circle(HX, HY, 10, fill=1, stroke=0)

    elif illus == "sunburst":
        # 24 radial spokes + concentric rings
        stroke(acc, 0.18); c.setLineWidth(2.5)
        for ang in range(0, 360, 15):
            rad = math.radians(ang)
            c.line(HX + math.cos(rad)*38, HY + math.sin(rad)*38,
                   HX + math.cos(rad)*220, HY + math.sin(rad)*220)
        unstroke()
        stroke(acc, 0.22); c.setLineWidth(1.2)
        for ang in range(0, 360, 15):
            rad = math.radians(ang)
            c.line(HX + math.cos(rad)*28, HY + math.sin(rad)*28,
                   HX + math.cos(rad)*38, HY + math.sin(rad)*38)
        unstroke()
        for r, a in [(35, 0.55), (20, 0.70), (10, 0.90)]:
            fill(acc, a); c.circle(HX, HY, r, fill=1, stroke=0); unfill()

    elif illus == "shatter":
        # Crack / shatter radiating from HX,HY — thriller-style
        shard_ends = [
            (HX - 100, HY + 80),  (HX - 70, HY - 60),
            (HX + 40,  HY + 140), (HX + 110, HY + 60),
            (HX + 90,  HY - 100), (HX - 30,  HY - 130),
            (HX - 140, HY - 20),  (HX + 150, HY - 30),
        ]
        stroke(acc, 0.28); c.setLineWidth(1.8)
        for ex, ey in shard_ends:
            c.line(HX, HY, ex, ey)
        unstroke()
        stroke(acc, 0.12); c.setLineWidth(0.9)
        for i, (ex, ey) in enumerate(shard_ends):
            mid_x = (HX + ex) / 2; mid_y = (HY + ey) / 2
            off_x = shard_ends[(i+1) % len(shard_ends)][0]
            off_y = shard_ends[(i+1) % len(shard_ends)][1]
            c.line(mid_x, mid_y, (mid_x + off_x) / 2, (mid_y + off_y) / 2)
        unstroke()
        for r, a in [(15, 0.55), (8, 0.80), (4, 1.0)]:
            fill(acc, a); c.circle(HX, HY, r, fill=1, stroke=0); unfill()

    elif illus == "cross":
        # Bold cross + concentric squares
        fill(acc, 0.22); c.rect(HX - 14, HY - 200, 28, 400, fill=1, stroke=0)
        fill(acc, 0.22); c.rect(HX - 200, HY - 14, 400, 28, fill=1, stroke=0)
        for s_sq in [50, 95, 145]:
            stroke(acc, 0.30 - s_sq * 0.001); c.setLineWidth(0.8)
            c.rect(HX - s_sq, HY - s_sq, s_sq * 2, s_sq * 2, fill=0, stroke=1)
            unstroke()
        fill(acc); c.circle(HX, HY, 14, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1); c.circle(HX, HY, 6, fill=1, stroke=0)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 4 — Full-page motif texture
    # ════════════════════════════════════════════════════════════════════════
    if motif == "concentric_circles":
        for r in range(18, int(max(W, H) * 0.95), 30):
            stroke(acc, max(0.015, 0.11 - r * 0.00018)); c.setLineWidth(0.65)
            c.circle(W * 0.5, H * 0.5, r, fill=0, stroke=1); unstroke()

    elif motif == "diagonal_stripes":
        for x in range(-int(H), int(W) + int(H), 22):
            stroke(acc, 0.065); c.setLineWidth(1.1)
            c.line(x, 0, x + H, H); unstroke()

    elif motif == "scattered_dots":
        for _ in range(200):
            px = rng.uniform(0, W); py = rng.uniform(0, H)
            pr = rng.uniform(1.2, 5.2)
            fill(acc, rng.uniform(0.035, 0.17))
            c.circle(px, py, pr, fill=1, stroke=0); unfill()

    elif motif == "grid_lines":
        for x in range(0, int(W) + 1, 26):
            stroke(acc, 0.055); c.setLineWidth(0.55); c.line(x, 0, x, H); unstroke()
        for y in range(0, int(H) + 1, 26):
            stroke(acc, 0.055); c.setLineWidth(0.55); c.line(0, y, W, y); unstroke()

    elif motif == "wave_curves":
        for offset in range(-100, 360, 28):
            stroke(acc, 0.09); c.setLineWidth(1.5)
            path = c.beginPath()
            path.moveTo(0, H * 0.45 + offset)
            for px in range(0, int(W) + 8, 5):
                py = H * 0.45 + offset + math.sin(px * 0.019) * 52
                path.lineTo(px, py)
            c.drawPath(path, stroke=1, fill=0); unstroke()

    elif motif == "hexagons":
        hr = 20
        for row in range(int(H / (hr * 1.52)) + 2):
            for col in range(int(W / (hr * 1.75)) + 2):
                hx = col * hr * 1.75 + (hr * 0.875 if row % 2 else 0)
                hy = row * hr * 1.52
                pts = [(hx + hr * math.cos(math.radians(60*i+30)),
                        hy + hr * math.sin(math.radians(60*i+30))) for i in range(6)]
                stroke(acc, 0.055); c.setLineWidth(0.65)
                path = c.beginPath(); path.moveTo(*pts[0])
                for pt in pts[1:]: path.lineTo(*pt)
                path.close(); c.drawPath(path, stroke=1, fill=0); unstroke()

    elif motif == "triangles":
        ts = 44
        for row in range(0, int(H) + ts, ts):
            for col in range(0, int(W) + ts, ts):
                stroke(acc, 0.055); c.setLineWidth(0.65)
                path = c.beginPath()
                if (row // ts + col // ts) % 2 == 0:
                    path.moveTo(col, row); path.lineTo(col+ts, row); path.lineTo(col+ts/2, row+ts)
                else:
                    path.moveTo(col+ts/2, row); path.lineTo(col, row+ts); path.lineTo(col+ts, row+ts)
                path.close(); c.drawPath(path, stroke=1, fill=0); unstroke()

    elif motif == "stars":
        for _ in range(100):
            sx = rng.uniform(0, W); sy = rng.uniform(0, H)
            fill(acc, rng.uniform(0.05, 0.28))
            c.circle(sx, sy, rng.uniform(0.8, 2.8), fill=1, stroke=0); unfill()
        for _ in range(18):
            sx = rng.uniform(0, W); sy = rng.uniform(0, H)
            stroke(acc, 0.15); c.setLineWidth(0.6)
            for a in range(0, 360, 45):
                rad = math.radians(a)
                c.line(sx + math.cos(rad)*2.5, sy + math.sin(rad)*2.5,
                       sx + math.cos(rad)*9, sy + math.sin(rad)*9)
            unstroke()

    elif motif == "arcs":
        corners = [(0, 0), (W, 0), (0, H), (W, H)]
        for ox, oy in corners:
            for r in range(40, 340, 36):
                stroke(acc, max(0.02, 0.13 - r * 0.00025)); c.setLineWidth(0.9)
                c.arc(ox - r, oy - r, ox + r, oy + r, startAng=0, extent=90)
                unstroke()

    elif motif == "shatter":
        for _ in range(35):
            x1, y1 = rng.uniform(0,W), rng.uniform(0,H)
            x2, y2 = x1+rng.uniform(-80,80), y1+rng.uniform(-80,80)
            stroke(acc, rng.uniform(0.04, 0.12)); c.setLineWidth(rng.uniform(0.4, 1.1))
            c.line(x1, y1, x2, y2); unstroke()

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 5 — Left accent bar (solid, 7 pt wide)
    # ════════════════════════════════════════════════════════════════════════
    c.setFillColorRGB(*acc)
    c.rect(0, 0, 7, H, fill=1, stroke=0)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 6 — Mid-page text panel (semi-transparent dark surface)
    # ════════════════════════════════════════════════════════════════════════
    PANEL_H = H * 0.46
    PANEL_Y = H * 0.245
    fill(panel_bg, 0.82)
    c.rect(0, PANEL_Y, W, PANEL_H, fill=1, stroke=0)
    unfill()
    # Panel accent lines (top + bottom edges, solid)
    c.setFillColorRGB(*acc)
    c.rect(0, PANEL_Y + PANEL_H, W, 2.8, fill=1, stroke=0)
    c.rect(0, PANEL_Y,           W, 2.8, fill=1, stroke=0)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 7 — Genre badge (top-left, solid no alpha needed)
    # ════════════════════════════════════════════════════════════════════════
    genre = concept.get("genre_label", "").upper()[:14].strip()
    if genre:
        BX, BY    = 18 * mm, H - 25 * mm
        badge_w   = len(genre) * 7.0 + 28
        badge_h   = 21
        dark_band = _darken(bg_bot, 0.50)
        c.setFillColorRGB(*dark_band)
        c.roundRect(BX, BY, badge_w, badge_h, 4, fill=1, stroke=0)
        # accent left stripe on badge
        c.setFillColorRGB(*acc)
        c.roundRect(BX, BY, 5, badge_h, 3, fill=1, stroke=0)
        c.setFillColorRGB(*acc)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(BX + 12, BY + 6.8, genre)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 8 — Typography block (inside panel)
    # ════════════════════════════════════════════════════════════════════════
    TEXT_L = 18 * mm + 8   # left edge, clear of accent bar

    title_lines = [ln.strip() for ln in concept.get("title", "Book Title").split("\n") if ln.strip()]
    subtitle    = concept.get("subtitle", "").strip()
    tagline     = concept.get("tagline",  "").strip()

    max_len   = max(len(ln) for ln in title_lines)
    title_fs  = 52 if max_len <= 12 else 44 if max_len <= 18 else 36 if max_len <= 24 else 28

    # Determine total text block height so we can centre it in the panel
    sub_lines = _word_wrap(subtitle, 46) if subtitle else []
    tag_lines = _word_wrap(tagline,  62) if tagline  else []

    block_h = (
        len(title_lines) * (title_fs + 6)
        + 14                             # rule
        + len(sub_lines) * 22
        + len(tag_lines) * 16
        + 10                             # padding
    )
    # Start near top of panel, leave a small top pad
    y = PANEL_Y + PANEL_H - 16

    # Title lines
    c.setFillColorRGB(*title_c)
    c.setFont("Helvetica-Bold", title_fs)
    for line in title_lines:
        y -= (title_fs + 6)
        c.drawString(TEXT_L, y, line)
    y -= 8

    # Thick gold rule (full usable width)
    RULE_W = W - TEXT_L - 18 * mm
    c.setFillColorRGB(*acc)
    c.rect(TEXT_L, y, RULE_W, 3.5, fill=1, stroke=0)
    y -= 14

    # Thin secondary rule (60% width, slightly offset)
    c.setFillColorRGB(*acc)
    fill(acc, 0.40)
    c.rect(TEXT_L, y + 6, RULE_W * 0.55, 1.2, fill=1, stroke=0)
    unfill()
    y -= 4

    # Subtitle
    if sub_lines:
        c.setFillColorRGB(*sub_c)
        c.setFont("Helvetica", 14.5)
        for ln in sub_lines:
            y -= 22
            c.drawString(TEXT_L, y, ln)
        y -= 8

    # Tagline (italic, slightly muted)
    if tag_lines:
        c.setFillColorRGB(*tag_c)
        c.setFont("Helvetica-Oblique", 10.5)
        for ln in tag_lines:
            y -= 16
            c.drawString(TEXT_L, y, ln)

    # ════════════════════════════════════════════════════════════════════════
    # LAYER 9 — Bottom author band (pure dark solid, no alpha)
    # ════════════════════════════════════════════════════════════════════════
    BAND_H    = 21 * mm
    bot_color = _darken(bg_bot, 0.58)
    c.setFillColorRGB(*bot_color)
    c.rect(0, 0, W, BAND_H, fill=1, stroke=0)
    # Accent top-line on band
    c.setFillColorRGB(*acc)
    c.rect(0, BAND_H, W, 2.5, fill=1, stroke=0)
    # Author name (left)
    author_line = concept.get("author_line", "").strip()
    if author_line:
        c.setFillColorRGB(*sub_c)
        c.setFont("Helvetica", 10)
        c.drawString(18 * mm, BAND_H * 0.40, author_line)
    # Brand (right)
    c.setFillColorRGB(*acc)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawRightString(W - 18 * mm, BAND_H * 0.40, "EDITORIAL AI")

    # Top edge highlight strip
    fill(acc, 0.38)
    c.rect(0, H - 4.5, W, 4.5, fill=1, stroke=0)
    unfill()

    c.showPage()
    c.save()
    return output_path


# ─────────────────────────────────────────────────────────────────────────────
# Prepend cover to existing PDF
# ─────────────────────────────────────────────────────────────────────────────

def prepend_cover_to_pdf(cover_pdf: str, original_pdf: str, output_pdf: str) -> str:
    from pypdf import PdfWriter, PdfReader  # pyrefly: ignore
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
    from docx import Document                       # pyrefly: ignore
    from docx.shared import Pt, RGBColor, Cm        # pyrefly: ignore
    from docx.enum.text import WD_ALIGN_PARAGRAPH   # pyrefly: ignore
    from docx.oxml.ns import qn                     # pyrefly: ignore
    from docx.oxml import OxmlElement               # pyrefly: ignore
    import copy

    pal = concept.get("palette", {})

    def _rgb(key: str, fallback: str = "#ffffff") -> RGBColor:
        h = pal.get(key, fallback).lstrip("#")
        if len(h) == 3: h = "".join(x*2 for x in h)
        return RGBColor(int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))

    cover = Document()
    sec   = cover.sections[0]
    sec.page_height   = Cm(29.7); sec.page_width    = Cm(21.0)
    sec.left_margin   = Cm(2.5);  sec.right_margin  = Cm(2.5)
    sec.top_margin    = Cm(3.0);  sec.bottom_margin = Cm(2.0)

    def para(text, size, bold=False, italic=False,
             color_key="title_color", fallback="#ffffff",
             align=WD_ALIGN_PARAGRAPH.LEFT, sb=0, sa=0):
        p   = cover.add_paragraph(); p.alignment = align
        pf  = p.paragraph_format
        pf.space_before = Pt(sb); pf.space_after = Pt(sa)
        run = p.add_run(text)
        run.font.size   = Pt(size); run.font.bold = bold; run.font.italic = italic
        run.font.color.rgb = _rgb(color_key, fallback)

    def rule(color_key="accent", fallback="#c8a200", thick=16):
        h   = pal.get(color_key, fallback).lstrip("#")
        if len(h) == 3: h = "".join(x*2 for x in h)
        p   = cover.add_paragraph()
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bt   = OxmlElement("w:bottom")
        bt.set(qn("w:val"),   "single")
        bt.set(qn("w:sz"),    str(thick))
        bt.set(qn("w:space"), "1")
        bt.set(qn("w:color"), h)
        pBdr.append(bt); pPr.append(pBdr)
        p.paragraph_format.space_before = Pt(4); p.paragraph_format.space_after = Pt(6)

    genre = concept.get("genre_label", "").upper().strip()
    if genre:
        para(f"— {genre} —", 9, bold=True, color_key="accent", fallback="#c8a200", sa=2)

    for _ in range(3): cover.add_paragraph()

    title_lines = [ln.strip() for ln in concept.get("title","").split("\n") if ln.strip()]
    for line in title_lines:
        para(line, 36, bold=True, color_key="title_color", fallback="#ffffff", sa=4)

    rule(thick=18)

    subtitle = concept.get("subtitle", "").strip()
    if subtitle:
        para(subtitle, 15, color_key="subtitle_color", fallback="#c8b86a", sb=4, sa=8)

    tagline = concept.get("tagline", "").strip()
    if tagline:
        para(tagline, 11, italic=True, color_key="tagline_color", fallback="#8b8faa", sa=6)

    for _ in range(4): cover.add_paragraph()
    rule(thick=12)

    author_line = concept.get("author_line", "").strip()
    if author_line:
        para(author_line, 11, color_key="subtitle_color", fallback="#c8b86a", sb=6)

    cover.add_page_break()

    tmp = output_docx + ".covertmp.docx"
    cover.save(tmp)

    orig    = Document(original_docx)
    out_doc = Document(tmp)
    for el in orig.element.body:
        if el.tag == qn("w:sectPr"): continue
        out_doc.element.body.append(copy.deepcopy(el))
    out_doc.save(output_docx)

    if os.path.exists(tmp): os.remove(tmp)
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
      1. Derive title from filename if not provided
      2. GPT-4o generates cover concept JSON
      3. Render premium PDF cover and prepend to original file
         (or build DOCX cover page and merge for .docx inputs)
    Returns dict: output_path, concept, ext, job_id
    """
    os.makedirs(output_dir, exist_ok=True)
    ext = os.path.splitext(filename)[1].lower()
    if not book_title:
        book_title = Path(filename).stem.replace("_"," ").replace("-"," ").title()

    concept  = generate_cover_concept(book_title, description, design_style)
    job_id   = uuid.uuid4().hex
    out_path = os.path.join(output_dir, f"cover_{job_id}{ext}")

    if ext == ".pdf":
        cover_pdf = os.path.join(output_dir, f"coverpage_{job_id}.pdf")
        render_cover_pdf(concept, cover_pdf)
        prepend_cover_to_pdf(cover_pdf, file_path, out_path)
        if os.path.exists(cover_pdf): os.remove(cover_pdf)
    elif ext == ".docx":
        prepend_cover_to_docx(concept, file_path, out_path)
    else:
        raise ValueError(f"Unsupported file type: {ext}. Upload a .pdf or .docx")

    return {"output_path": out_path, "concept": concept, "ext": ext, "job_id": job_id}