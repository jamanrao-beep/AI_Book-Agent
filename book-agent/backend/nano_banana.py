"""
nano_banana.py
Nano Banana image generation — the ONLY file that touches Google Gemini.
Used exclusively by cover_designer.py for cover illustration generation.

All text/AI work (concept, prompts, book writing, proofreading, etc.)
continues to use openai_client.py with GPT-4o, unchanged.

6-Tier image cluster:
  Tier 1 : gemini-2.5-flash-preview-05-20  (Nano Banana Pro)
  Tier 2 : gemini-2.0-flash-exp            (Nano Banana 2, sanitised prompt)
  Tier 3 : Stability AI REST API           (STABILITY_API_KEY in .env)
  Tier 4 : SVG template from templates/    (local, no API)
  Tier 5 : Pillow procedural gradient      (local, fully offline)
  Tier 6 : Pillow complex-shape mosaic     (local, zero dependencies on
                                             external state — the absolute
                                             last-resort guarantee)
"""

from __future__ import annotations

import base64
import glob
import io
import logging
import os
import random
import urllib.request
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("nano_banana")

# ── Gemini SDK (image generation only) ───────────────────────────────────────
try:
    # pyrefly: ignore [missing-import]
    from google import genai
    # pyrefly: ignore [missing-import]
    from google.genai import types as genai_types
except ImportError as _e:
    raise ImportError(
        "google-genai is not installed.\n"
        "Run: pip install google-genai>=1.0.0\n"
        "(Only needed for Nano Banana cover image generation. Note: the old\n"
        "google-generativeai package is deprecated — use google-genai instead.)"
    ) from _e

_NB_KEY = (
    os.getenv("NANO_BANANA_API_KEY")
    or os.getenv("GEMINI_API_KEY")
    or ""
)
if not _NB_KEY:
    raise EnvironmentError(
        "NANO_BANANA_API_KEY is not set in your .env file.\n"
        "Get a free key at: https://aistudio.google.com/apikey"
    )

_genai_client = genai.Client(api_key=_NB_KEY)

# ── Model names ───────────────────────────────────────────────────────────────
# IMPORTANT: these must be IMAGE-capable model IDs, not text chat models.
# gemini-2.5-flash-preview-05-20 / gemini-2.0-flash-exp do NOT support
# generateContent for images and will 404 — that was the original bug.
NANO_BANANA_PRO = "gemini-3-pro-image-preview"      # Tier 1 — Nano Banana Pro
NANO_BANANA_2   = "gemini-3.1-flash-image-preview"  # Tier 2 — Nano Banana 2


# ─────────────────────────────────────────────────────────────────────────────
# Tier 1 & 2 — Gemini image generation
# ─────────────────────────────────────────────────────────────────────────────

def generate_image(prompt: str, model_name: str) -> bytes | None:
    """
    Call a Gemini image-generation model and return raw image bytes.
    Returns None on any failure so the caller can try the next tier.
    """
    try:
        logger.info("  🍌 Nano Banana (%s) generating…", model_name)
        response = _genai_client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        for candidate in (response.candidates or []):
            content = getattr(candidate, "content", None)
            if not content:
                continue
            for part in (content.parts or []):
                inline = getattr(part, "inline_data", None)
                if inline and inline.data:
                    raw = inline.data
                    img_bytes = bytes(raw) if isinstance(raw, (bytes, bytearray)) \
                                else base64.b64decode(raw)
                    logger.info(
                        "  ✅ Nano Banana (%s) returned %d KB",
                        model_name, len(img_bytes) // 1024,
                    )
                    return img_bytes

        logger.warning("  ⚠️  %s: no image parts in response.", model_name)

    except Exception as exc:
        logger.warning("  ⚠️  Nano Banana (%s) failed: %s", model_name, exc)

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Tier 3 — Stability AI REST fallback
# ─────────────────────────────────────────────────────────────────────────────

def generate_via_stability(prompt: str) -> bytes | None:
    """Tier 3: Stability AI Ultra via REST. Skipped if STABILITY_API_KEY not set."""
    api_key = os.getenv("STABILITY_API_KEY", "").strip()
    if not api_key:
        logger.info("  ℹ️  STABILITY_API_KEY not set — skipping Tier 3.")
        return None

    logger.info("  🚀 Stability AI (Tier 3)…")
    boundary = "----NanaBananaStabilityBoundary"
    body_parts = [
        f"--{boundary}",
        'Content-Disposition: form-data; name="prompt"', "", prompt[:2000],
        f"--{boundary}",
        'Content-Disposition: form-data; name="output_format"', "", "jpeg",
        f"--{boundary}",
        'Content-Disposition: form-data; name="aspect_ratio"', "", "2:3",
        f"--{boundary}--", "",
    ]
    body = "\r\n".join(body_parts).encode("utf-8")
    try:
        req = urllib.request.Request(
            "https://api.stability.ai/v2beta/stable-image/generate/ultra", data=body
        )
        req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        req.add_header("accept", "image/*")
        with urllib.request.urlopen(req, timeout=50) as resp:
            if resp.status == 200:
                img = resp.read()
                logger.info("  ✅ Stability AI returned %d KB", len(img) // 1024)
                return img
    except Exception as exc:
        logger.warning("  ⚠️  Stability AI failed: %s", exc)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Tier 4 — SVG template
# ─────────────────────────────────────────────────────────────────────────────

def generate_via_svg_template(title: str, concept: dict) -> bytes | None:
    """
    Tier 4: Score and fill an SVG template from the templates/ folder.
    Returns UTF-8 encoded SVG bytes, or None if no templates exist.
    """
    palette   = concept.get("palette", {})
    genre_raw = concept.get("genre_label", "").lower()
    style_raw = concept.get("style", "").lower()

    GENRE_ALIASES: dict[str, list[str]] = {
        "thriller":  ["thriller", "suspense", "crime", "mystery", "noir"],
        "scifi":     ["scifi", "sci-fi", "science fiction", "space", "futur"],
        "fantasy":   ["fantasy", "magic", "epic", "sword", "dragon"],
        "romance":   ["romance", "love", "romantic"],
        "horror":    ["horror", "dark", "gothic", "paranormal"],
        "academic":  ["academic", "textbook", "education", "nonfiction"],
        "business":  ["business", "finance", "self-help", "leadership"],
        "history":   ["history", "historical", "biography", "memoir"],
        "children":  ["children", "kids", "juvenile"],
        "poetry":    ["poetry", "poems", "verse"],
    }
    keywords: list[str] = []
    for canonical, aliases in GENRE_ALIASES.items():
        if any(a in genre_raw or a in style_raw for a in aliases):
            keywords.append(canonical)
    keywords += [genre_raw, style_raw]

    templates_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "templates"
    )
    svgs = glob.glob(os.path.join(templates_dir, "**", "*.svg"), recursive=True)
    if not svgs:
        logger.warning("  ⚠️  No SVG templates found in templates/")
        return None

    def _score(p: str) -> int:
        combined = (
            os.path.basename(os.path.dirname(p)).lower()
            + "_"
            + os.path.basename(p).lower()
        )
        score = sum(
            (rank + 1) * 10
            for rank, kw in enumerate(reversed(keywords))
            if kw and kw in combined
        )
        if "general" in combined or "default" in combined:
            score -= 5
        return score

    sorted_svgs = sorted(svgs, key=_score, reverse=True)
    chosen      = random.choice([s for s in sorted_svgs if _score(s) == _score(sorted_svgs[0])])
    logger.info("  📄 SVG template: %s", os.path.basename(chosen))

    try:
        with open(chosen, encoding="utf-8") as fh:
            svg = fh.read()

        author = concept.get("author_line", "")
        subs = {
            "{{TITLE}}":          title[:30],
            "{{AUTHOR}}":         author[:28],
            "{{GENRE}}":          concept.get("genre_label", "").upper()[:20],
            "{{TAGLINE}}":        concept.get("tagline",  "")[:60],
            "{{SUBTITLE}}":       concept.get("subtitle", "")[:60],
            "{{BG_PRIMARY}}":     palette.get("bg_primary",    "#0f172a"),
            "{{BG_SECONDARY}}":   palette.get("bg_secondary",  "#1e3a5f"),
            "{{ACCENT}}":         palette.get("accent",        "#f59e0b"),
            "{{ACCENT2}}":        palette.get("accent2",       "#fbbf24"),
            "{{TITLE_COLOR}}":    palette.get("title_color",   "#ffffff"),
            "{{SUBTITLE_COLOR}}": palette.get("subtitle_color","#e2e8f0"),
        }
        for k, v in subs.items():
            svg = svg.replace(k, v)
        svg = svg.replace("Your Title Here", title[:30])
        svg = svg.replace("Your Title",      title[:30])
        svg = svg.replace("Author Name",     author[:28])
        return svg.encode("utf-8")
    except Exception as exc:
        logger.warning("  ⚠️  SVG template fill failed: %s", exc)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Tier 5 — Local procedural fallback
# ─────────────────────────────────────────────────────────────────────────────

def generate_procedural(concept: dict, width: int = 1024, height: int = 1792) -> bytes | None:
    """
    Tier 5: Pure-Pillow procedural gradient + accent rings.
    Works completely offline with zero external API calls.
    """
    try:
        from PIL import Image, ImageDraw, ImageFilter  # pyrefly: ignore

        palette = concept.get("palette", {})

        def _h(h: str) -> tuple[int, int, int]:
            h = h.lstrip("#")
            if len(h) == 3:
                h = "".join(c * 2 for c in h)
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

        bg1 = _h(palette.get("bg_primary",  "#0f172a"))
        bg2 = _h(palette.get("bg_secondary", "#1e3a5f"))
        acc = _h(palette.get("accent",       "#f59e0b"))

        img  = Image.new("RGBA", (width, height))
        draw = ImageDraw.Draw(img)

        for y in range(height):
            t = y / height
            r = int(bg1[0] * (1 - t) + bg2[0] * t)
            g = int(bg1[1] * (1 - t) + bg2[1] * t)
            b = int(bg1[2] * (1 - t) + bg2[2] * t)
            draw.line([(0, y), (width, y)], fill=(r, g, b, 255))

        for _ in range(8):
            cx    = random.randint(width  // 4, 3 * width  // 4)
            cy    = random.randint(height // 5, 4 * height // 5)
            r     = random.randint(50, 220)
            alpha = random.randint(15, 55)
            ov    = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            ImageDraw.Draw(ov).ellipse(
                [cx - r, cy - r, cx + r, cy + r],
                outline=(*acc, alpha), width=2,
            )
            img = Image.alpha_composite(img, ov)

        img = img.convert("RGB").filter(ImageFilter.GaussianBlur(radius=1))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        logger.info("  ✅ Procedural fallback generated.")
        return buf.getvalue()

    except Exception as exc:
        logger.error("  ⚠️  Procedural fallback failed: %s", exc)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Tier 6 — Local complex-shape mosaic (absolute last resort)
# ─────────────────────────────────────────────────────────────────────────────

def generate_complex_shapes(concept: dict, width: int = 1024, height: int = 1792) -> bytes | None:
    """
    Tier 6: Pure-Pillow geometric mosaic — the absolute final guarantee.

    Unlike Tier 5 (soft gradient + faint rings, meant to look like a
    generated illustration), Tier 6 is intentionally built from layered
    polygons, triangles, and a diagonal line lattice so it never depends on
    anything outside this process: no network, no fonts, no external
    assets. If even this fails, a flat-color rectangle is returned inline,
    so this function effectively cannot return None.
    """
    palette = concept.get("palette", {})
    title   = concept.get("title", "Cover")

    def _h(h: str) -> tuple[int, int, int]:
        h = (h or "#0f172a").lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        try:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
        except Exception:
            return (15, 23, 42)

    bg1  = _h(palette.get("bg_primary",   "#0f172a"))
    bg2  = _h(palette.get("bg_secondary", "#1e3a5f"))
    acc  = _h(palette.get("accent",       "#f59e0b"))
    acc2 = _h(palette.get("accent2",      "#fbbf24"))

    try:
        import math
        from PIL import Image, ImageDraw, ImageFilter  # pyrefly: ignore

        rng = random.Random(hash(title) & 0xFFFFFFFF)

        img  = Image.new("RGB", (width, height), bg1)
        draw = ImageDraw.Draw(img)

        # 1. Banded diagonal-feel gradient base
        bands  = 48
        band_h = max(1, height // bands)
        for i in range(bands):
            t = i / bands
            r = int(bg1[0] * (1 - t) + bg2[0] * t)
            g = int(bg1[1] * (1 - t) + bg2[1] * t)
            b = int(bg1[2] * (1 - t) + bg2[2] * t)
            draw.rectangle([0, i * band_h, width, (i + 1) * band_h + 1], fill=(r, g, b))

        # 2. Layered translucent polygons (triangles / quads / pentagons)
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        odraw   = ImageDraw.Draw(overlay)
        palette_colors = [acc, acc2, bg2]
        for _ in range(22):
            cx, cy = rng.randint(0, width), rng.randint(0, height)
            spread = rng.randint(80, 320)
            sides  = rng.choice([3, 3, 4, 4, 5])
            angle0 = rng.uniform(0, 360)
            pts = []
            for s in range(sides):
                ang = math.radians(angle0 + s * (360 / sides) + rng.uniform(-10, 10))
                rad = spread * rng.uniform(0.6, 1.0)
                pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
            color = rng.choice(palette_colors)
            alpha = rng.randint(18, 50)
            odraw.polygon(pts, fill=(*color, alpha))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

        # 3. Fine diagonal accent-line lattice for a "designed" feel
        draw = ImageDraw.Draw(img)
        step = max(120, width // 6)
        for x in range(-height, width + height, step):
            draw.line([(x, height), (x + height, 0)], fill=acc, width=1)

        img = img.filter(ImageFilter.GaussianBlur(radius=0.6))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        logger.info("  ✅ Tier 6 complex-shape mosaic generated (%d KB).", len(buf.getvalue()) // 1024)
        return buf.getvalue()

    except Exception as exc:
        logger.error("  ⚠️  Tier 6 complex-shape mosaic failed: %s — falling back to flat color.", exc)
        try:
            from PIL import Image  # pyrefly: ignore
            img = Image.new("RGB", (width, height), bg1)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return buf.getvalue()
        except Exception:
            return None


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point — run the full 6-tier cluster
# ─────────────────────────────────────────────────────────────────────────────

def run_image_cluster(
    prompt  : str,
    title   : str,
    concept : dict,
) -> bytes | None:
    """
    Run all 6 Nano Banana tiers in order and return the first success.
    Called by cover_designer.py only — no other module should import this.

    Returns None only in the theoretically-impossible case that even the
    flat-color Tier 6 fallback raises (e.g. PIL not installed at all).
    """
    # Tier 1 — Nano Banana Pro
    result = generate_image(prompt, NANO_BANANA_PRO)
    if result:
        logger.info("  🍌 Tier 1 (Nano Banana Pro) succeeded.")
        return result

    # Sanitize for Tier 2
    logger.warning("  ⚠️  Tier 1 failed — sanitising prompt…")
    safe = _sanitize_prompt(prompt)

    # Tier 2 — Nano Banana 2
    result = generate_image(safe, NANO_BANANA_2)
    if result:
        logger.info("  🍌 Tier 2 (Nano Banana 2) succeeded.")
        return result

    # Tier 3 — Stability AI
    result = generate_via_stability(safe)
    if result:
        logger.info("  ✅ Tier 3 (Stability AI) succeeded.")
        return result

    # Tier 4 — SVG template
    result = generate_via_svg_template(title, concept)
    if result:
        logger.info("  ✅ Tier 4 (SVG template) succeeded.")
        return result

    # Tier 5 — Procedural gradient
    logger.warning("  🚨 Tiers 1-4 exhausted — Tier 5 procedural gradient.")
    result = generate_procedural(concept)
    if result:
        logger.info("  ✅ Tier 5 (procedural gradient) succeeded.")
        return result

    # Tier 6 — Complex-shape mosaic (final guarantee)
    logger.warning("  🚨 Tier 5 failed — Tier 6 complex-shape mosaic (final guarantee).")
    result = generate_complex_shapes(concept)
    if result:
        logger.info("  ✅ Tier 6 (complex-shape mosaic) succeeded.")
        return result

    logger.error("  ❌ All 6 Nano Banana tiers failed.")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Prompt sanitizer (internal helper)
# ─────────────────────────────────────────────────────────────────────────────

def _sanitize_prompt(prompt: str) -> str:
    """Rewrite prompt through GPT-4o safety filter before Tier 2 attempt."""
    try:
        from openai_client import _call  # uses the shared OpenAI client
        return _call(
            f"Rewrite this image prompt to remove any violence, real people, "
            f"copyrighted characters, or adult content while keeping the artistic vibe. "
            f"Output ONLY the rewritten prompt:\n\n{prompt}",
            max_tokens=400,
        )
    except Exception as exc:
        logger.warning("  ⚠️  Prompt sanitizer failed (%s) — using original", exc)
        return prompt