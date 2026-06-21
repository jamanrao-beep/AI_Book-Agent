"""
nano_banana.py
Nano Banana image generation — the ONLY file that touches Google Gemini.
Used exclusively by cover_designer.py for cover illustration generation.

All text/AI work (concept, prompts, book writing, proofreading, etc.)
continues to use openai_client.py with GPT-4o, unchanged.

5-Tier image cluster:
  Tier 1 : gemini-2.5-flash-preview-05-20  (Nano Banana Pro)
  Tier 2 : gemini-2.0-flash-exp            (Nano Banana 2)
  Tier 3 : Stability AI REST API           (STABILITY_API_KEY in .env)
  Tier 4 : SVG template from templates/    (local, no API)
  Tier 5 : Pillow procedural generator     (local, fully offline)
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
    import google.generativeai as genai
except ImportError as _e:
    raise ImportError(
        "google-generativeai is not installed.\n"
        "Run: pip install google-generativeai>=0.8.0\n"
        "(Only needed for Nano Banana cover image generation.)"
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

genai.configure(api_key=_NB_KEY)

# ── Model names ───────────────────────────────────────────────────────────────
NANO_BANANA_PRO = "gemini-2.5-flash-preview-05-20"   # Tier 1
NANO_BANANA_2   = "gemini-2.0-flash-exp"             # Tier 2


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
        model   = genai.GenerativeModel(model_name)
        gen_cfg = genai.types.GenerationConfig(
            response_modalities=["TEXT", "IMAGE"],
        )
        response = model.generate_content(prompt, generation_config=gen_cfg)

        for candidate in response.candidates:
            for part in candidate.content.parts:
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
# Public entry point — run the full 5-tier cluster
# ─────────────────────────────────────────────────────────────────────────────

def run_image_cluster(
    prompt  : str,
    title   : str,
    concept : dict,
) -> bytes | None:
    """
    Run all 5 Nano Banana tiers in order and return the first success.
    Called by cover_designer.py only — no other module should import this.

    Returns None only if every tier fails (extremely unlikely).
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

    # Tier 5 — Procedural
    logger.warning("  🚨 All external tiers exhausted — Tier 5 procedural.")
    result = generate_procedural(concept)
    if result:
        logger.info("  ✅ Tier 5 (procedural) succeeded.")
        return result

    logger.error("  ❌ All 5 Nano Banana tiers failed.")
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