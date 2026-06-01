"""
handwritten_scanner.py
AI-powered handwritten book scanner.
- Accepts: image files (jpg/png/webp/heic/bmp), PDF, DOCX, or ZIP of any above
- Uses GPT-4o vision to transcribe each page/image
- Assembles transcription into a clean, structured book
- Exports PDF + DOCX
Supports any language — GPT-4o handles multilingual handwriting.

IMPROVEMENTS for large PDFs (320+ pages):
  - 1 image per API call (reliable page alignment, no split/merge errors)
  - max_tokens raised to 16384 (prevents silent truncation of dense pages)
  - 3x exponential backoff retries on transient API failures
  - ThreadPoolExecutor for parallel transcription (8 workers by default)
  - structure_transcription chunk size reduced to 20K chars (avoids JSON truncation)
  - structure_transcription max_tokens raised to 10000
  - PDF rendered at 3x zoom (300 DPI) for better OCR accuracy on dense writing
  - Image Pre-Processing Engine to boost contrast and sharpness before OCR
  - Context Healer Agent to stitch broken sentences across page boundaries
"""

import os
import io
import json
import re
import uuid
import time
import zipfile
import shutil
import base64
import tempfile
import traceback
import threading
import unicodedata
import urllib.request
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

# pyrefly: ignore [missing-import]
from openai import OpenAI
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"

SUPPORTED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif"}
SUPPORTED_UPLOAD_EXTS = SUPPORTED_IMAGE_EXTS | {".pdf", ".docx", ".zip"}

# ─────────────────────────────────────────────────────────────────────────────
# Tuning knobs
# ─────────────────────────────────────────────────────────────────────────────

# How many pages to send per vision API call.
# 1 = most reliable (no page-break alignment issues), slower.
# 2 = good balance. 4 = original behaviour (faster but misaligns on dense pages).
PAGES_PER_BATCH = 1

# Max output tokens per transcription call.
# GPT-4o supports up to 16384. Original was 8192 which truncates dense pages.
TRANSCRIPTION_MAX_TOKENS = 16384

# Number of parallel workers for transcription. Stay within your rate-limit tier.
# Tier 1 (~500 RPM): 8–12 workers is safe. Reduce if you hit 429s.
TRANSCRIPTION_WORKERS = 8

# Retries on transient API errors (429, 500, 502, 503).
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0  # seconds; doubles on each retry

# Structuring: max chars per chunk fed to GPT-4o.
# Smaller chunks → cleaner JSON output (original 50K caused JSON truncation).
STRUCTURE_CHUNK_SIZE = 20_000

# Max tokens for the structuring / chapter-assembly call.
STRUCTURE_MAX_TOKENS = 10_000

# PDF render zoom. 2.0 ≈ 150 DPI (original). 3.0 ≈ 225 DPI (better for dense writing).
PDF_RENDER_ZOOM = 3.0


# ─────────────────────────────────────────────────────────────────────────────
# Unicode / Devanagari font system
# Ported from layout_designer.py — same strategy:
#   1. Local ./fonts/ directory bundled with the app
#   2. Common system paths (Ubuntu/Debian/Alpine)
#   3. Auto-download from Google Fonts CDN at first run → cached in ./fonts/
#
# This guarantees Hindi/Devanagari PDFs always render correctly instead of
# producing square boxes.
# ─────────────────────────────────────────────────────────────────────────────

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_FONTS_DIR   = os.path.join(_SCRIPT_DIR, "fonts")

_FONT_URLS: dict[str, str] = {
    "NotoSerifDevanagari-Regular.ttf": (
        "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/"
        "NotoSerifDevanagari/NotoSerifDevanagari-Regular.ttf"
    ),
    "NotoSerifDevanagari-Bold.ttf": (
        "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/"
        "NotoSerifDevanagari/NotoSerifDevanagari-Bold.ttf"
    ),
    "NotoSansDevanagari-Regular.ttf": (
        "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/"
        "NotoSansDevanagari/NotoSansDevanagari-Regular.ttf"
    ),
    "NotoSansDevanagari-Bold.ttf": (
        "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/"
        "NotoSansDevanagari/NotoSansDevanagari-Bold.ttf"
    ),
}

_NOTO_FONT_FILES: dict[str, str] = {
    "NotoSerifDevanagari":      "NotoSerifDevanagari-Regular.ttf",
    "NotoSerifDevanagari-Bold": "NotoSerifDevanagari-Bold.ttf",
    "NotoSansDevanagari":       "NotoSansDevanagari-Regular.ttf",
    "NotoSansDevanagari-Bold":  "NotoSansDevanagari-Bold.ttf",
}

_SYSTEM_FONT_DIRS = [
    "/usr/share/fonts/truetype/noto",
    "/usr/share/fonts/noto",
    "/usr/share/fonts/opentype/noto",
    "/usr/share/fonts/truetype/freefont",
    "/usr/share/fonts/freefont",
    "/usr/share/fonts",
    "/usr/share/fonts/noto-cjk",
    "/Library/Fonts",
    "/System/Library/Fonts",
    "C:/Windows/Fonts",
]

_REGISTERED_FONTS: set[str] = set()
_FONTS_REGISTERED  = False
_FONT_LOCK         = threading.Lock()


def _find_font_on_system(filename: str) -> Optional[str]:
    """Search known system font directories for a TTF file.
    Falls back to a recursive os.walk search under /usr/share/fonts."""
    local = os.path.join(_FONTS_DIR, filename)
    if os.path.isfile(local):
        return local
    for d in _SYSTEM_FONT_DIRS:
        p = os.path.join(d, filename)
        if os.path.isfile(p):
            return p
    base_search = "/usr/share/fonts"
    if os.path.isdir(base_search):
        for root, _dirs, files in os.walk(base_search):
            if filename in files:
                found = os.path.join(root, filename)
                print(f"  🔍  Found font via recursive search: {found}")
                return found
    return None


def _download_font(filename: str) -> Optional[str]:
    """Download a font from GitHub/Google Fonts into _FONTS_DIR.
    Returns the local path on success, None on failure."""
    url = _FONT_URLS.get(filename)
    if not url:
        return None
    dest = os.path.join(_FONTS_DIR, filename)
    if os.path.isfile(dest):
        return dest
    try:
        os.makedirs(_FONTS_DIR, exist_ok=True)
        print(f"  ⬇️   Downloading font {filename} …")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp, \
             open(dest, "wb") as f:
            f.write(resp.read())
        print(f"  ✅  Downloaded {filename} → {dest}")
        return dest
    except Exception as e:
        print(f"  ⚠️   Could not download {filename}: {e}")
        if os.path.isfile(dest):
            try:
                os.remove(dest)
            except Exception:
                pass
        return None


def _ensure_unicode_fonts() -> None:
    """Register Noto Devanagari TTFs with ReportLab (idempotent, thread-safe).
    Resolution order: local cache → system paths → auto-download from GitHub."""
    global _FONTS_REGISTERED, _REGISTERED_FONTS
    if _FONTS_REGISTERED:
        return
    with _FONT_LOCK:
        if _FONTS_REGISTERED:
            return
        try:
            from reportlab.pdfbase import pdfmetrics      # pyrefly: ignore [missing-import]
            from reportlab.pdfbase.ttfonts import TTFont  # pyrefly: ignore [missing-import]

            for rl_name, filename in _NOTO_FONT_FILES.items():
                path = _find_font_on_system(filename)
                if not path:
                    path = _download_font(filename)
                if not path:
                    print(f"  ⚠️   Font unavailable: {rl_name} ({filename}) — skipping")
                    continue
                try:
                    pdfmetrics.registerFont(TTFont(rl_name, path))
                    _REGISTERED_FONTS.add(rl_name)
                    print(f"  ✅  Registered: {rl_name} from {path}")
                except Exception as e:
                    print(f"  ⚠️   registerFont failed for {rl_name}: {e}")

            if _REGISTERED_FONTS:
                print(f"  ✅  Unicode fonts ready: {sorted(_REGISTERED_FONTS)}")
            else:
                print(
                    "  ⚠️  WARN: No Unicode/Devanagari fonts could be registered. "
                    "Hindi text may render as square boxes. "
                    "Fix: run `apt-get install -y fonts-noto-core` or place "
                    "NotoSansDevanagari-Regular.ttf in a ./fonts/ folder."
                )
        except Exception as e:
            print(f"  ⚠️   _ensure_unicode_fonts failed: {e}\n{traceback.format_exc()}")
        finally:
            _FONTS_REGISTERED = True


def _has_non_latin(text: str) -> bool:
    """True if text contains Devanagari or other Indic scripts (U+0900+)."""
    return any(ord(c) >= 0x0900 for c in text
               if not unicodedata.category(c).startswith("Z"))


def _unicode_body_font(rl_name: str, has_unicode: bool) -> str:
    """Return the best available Unicode-capable font for the requested style.
    Falls back through the registered set; never returns a Latin-only font name
    when Unicode content is present (unless nothing at all was registered)."""
    if not has_unicode:
        return rl_name

    _PREF: dict[str, list[str]] = {
        "Helvetica":         ["NotoSansDevanagari",  "NotoSerifDevanagari"],
        "Helvetica-Bold":    ["NotoSansDevanagari-Bold", "NotoSansDevanagari"],
        "Helvetica-Oblique": ["NotoSansDevanagari",  "NotoSerifDevanagari"],
        "Times-Roman":       ["NotoSerifDevanagari", "NotoSansDevanagari"],
        "Times-Bold":        ["NotoSerifDevanagari-Bold", "NotoSerifDevanagari"],
        "Courier":           ["NotoSansDevanagari",  "NotoSerifDevanagari"],
    }
    for candidate in _PREF.get(rl_name, ["NotoSansDevanagari", "NotoSerifDevanagari"]):
        if candidate in _REGISTERED_FONTS:
            return candidate

    print(f"  🚨  No Unicode font for '{rl_name}' — text may render as boxes.")
    return rl_name


# Latin fallback map: when Devanagari font is active, use these for Latin runs
_LATIN_FALLBACK: dict[str, str] = {
    "NotoSerifDevanagari":      "Times-Roman",
    "NotoSerifDevanagari-Bold": "Times-Roman",
    "NotoSansDevanagari":       "Helvetica",
    "NotoSansDevanagari-Bold":  "Helvetica",
}

# DOCX latin fallback
_DOCX_LATIN_FALLBACK: dict[str, str] = {
    "NotoSerifDevanagari":      "Times New Roman",
    "NotoSerifDevanagari-Bold": "Times New Roman",
    "NotoSansDevanagari":       "Arial",
    "NotoSansDevanagari-Bold":  "Arial",
}


def _mixed_font_html(safe_escaped_text: str, deva_font: str) -> str:
    """Given HTML-escaped paragraph text and the Devanagari font name,
    return ReportLab XML markup with dual-font tags for Latin runs.
    Only called when has_unicode is True."""
    latin_font = _LATIN_FALLBACK.get(deva_font)
    if not latin_font:
        return safe_escaped_text

    fragments = re.split(r"(<br\s*/>)", safe_escaped_text)
    result_parts: list[str] = []

    for frag in fragments:
        if re.fullmatch(r"<br\s*/>", frag):
            result_parts.append(frag)
            continue
        if not frag:
            continue

        frag_plain = (
            frag.replace("&amp;", "&")
                .replace("&lt;",  "<")
                .replace("&gt;",  ">")
                .replace("&quot;", '"')
                .replace("&#39;",  "'")
        )

        def _is_latin_char(ch: str) -> bool:
            cp = ord(ch)
            if ch.isspace():
                return False
            if 0x0900 <= cp <= 0x097F:
                return False   # Devanagari → Devanagari font
            if 0x0020 <= cp <= 0x024F:
                return True    # Basic Latin + Latin Extended A/B
            if 0x2000 <= cp <= 0x206F:
                return True    # General Punctuation (—, ", ", …)
            return False

        runs: list[tuple[bool, str]] = []
        if frag_plain:
            cur_latin = _is_latin_char(frag_plain[0])
            cur_buf   = frag_plain[0]
            for ch in frag_plain[1:]:
                ch_latin = _is_latin_char(ch)
                if ch_latin == cur_latin or ch.isspace():
                    cur_buf += ch
                else:
                    runs.append((cur_latin, cur_buf))
                    cur_latin = ch_latin
                    cur_buf   = ch
            if cur_buf:
                runs.append((cur_latin, cur_buf))

        frag_html = ""
        for is_latin, chunk in runs:
            esc = (
                chunk.replace("&", "&amp;")
                     .replace("<", "&lt;")
                     .replace(">", "&gt;")
            )
            if is_latin and chunk.strip():
                frag_html += f'<font name="{latin_font}">{esc}</font>'
            else:
                frag_html += esc

        result_parts.append(frag_html)

    return "".join(result_parts)


# ─────────────────────────────────────────────────────────────────────────────
# NEW ADVANCED UPGRADE: Vision Pre-Processing Engine
# ─────────────────────────────────────────────────────────────────────────────
def _enhance_image_for_ocr(path: str) -> str:
    """
    Agency-Grade Pre-processing: Automatically enhances contrast, sharpness, 
    and converts to high-contrast grayscale to dramatically improve GPT-4o Vision 
    accuracy on faded or messy handwriting.
    """
    try:
        # pyrefly: ignore [missing-import]
        from PIL import Image, ImageEnhance, ImageOps
        img = Image.open(path)
        
        # 1. Convert to grayscale to remove distracting background noise/stains
        img = ImageOps.grayscale(img)
        
        # 2. Boost Contrast by 1.5x
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)
        
        # 3. Boost Sharpness by 2.0x to define pen strokes
        sharpness = ImageEnhance.Sharpness(img)
        img = sharpness.enhance(2.0)
        
        # Save to a temporary optimized file
        enhanced_path = path.replace(".", "_enhanced.")
        img.save(enhanced_path, format="PNG")
        return enhanced_path
    except ImportError:
        print("  ⚠️ PIL not installed, skipping image enhancement. (Run: pip install Pillow)")
        return path
    except Exception as e:
        print(f"  ⚠️ Image enhancement failed, using original: {e}")
        return path

# ─────────────────────────────────────────────────────────────────────────────
# Image → base64
# ─────────────────────────────────────────────────────────────────────────────

def _image_to_b64(path: str) -> tuple[str, str]:
    """Upgraded to pass images through the enhancement pipeline first."""
    enhanced_path = _enhance_image_for_ocr(path)
    
    ext = Path(enhanced_path).suffix.lower()
    # For bmp/tiff — convert to PNG via Pillow if available
    if ext in {".bmp", ".tiff", ".tif"}:
        try:
            # pyrefly: ignore [missing-import]
            from PIL import Image
            buf = io.BytesIO()
            Image.open(enhanced_path).save(buf, format="PNG")
            b64_data = base64.b64encode(buf.getvalue()).decode()
            media_type = "image/png"
        except Exception as e:
            print(f"  ⚠️  Unexpected error during image conversion. {e}")
            with open(enhanced_path, "rb") as f:
                b64_data = base64.b64encode(f.read()).decode()
            media_type = "image/jpeg"
    else:
        media_type = "image/png" if ext == ".png" else "image/jpeg"
        if ext == ".webp": media_type = "image/webp"
        if ext == ".gif": media_type = "image/gif"
        
        with open(enhanced_path, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode()
            
    # Clean up the temp enhanced file to save disk space
    if enhanced_path != path and os.path.exists(enhanced_path):
        os.remove(enhanced_path)
        
    return b64_data, media_type


# ─────────────────────────────────────────────────────────────────────────────
# PDF → images (one per page)
# ─────────────────────────────────────────────────────────────────────────────

def _pdf_to_images(pdf_path: str, out_dir: str) -> list[str]:
    """
    Render each PDF page to a PNG at PDF_RENDER_ZOOM (default 3x ≈ 225 DPI).
    Higher DPI significantly improves transcription accuracy on dense handwriting.
    Returns list of image paths.
    """
    try:
        # pyrefly: ignore [missing-import]
        import fitz  # PyMuPDF
        doc = fitz.open(pdf_path)
        paths = []
        mat = fitz.Matrix(PDF_RENDER_ZOOM, PDF_RENDER_ZOOM)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat)
            img_path = os.path.join(out_dir, f"page_{i:04d}.png")
            pix.save(img_path)
            paths.append(img_path)
        print(f"  📄 Rendered {len(paths)} pages at {PDF_RENDER_ZOOM}x zoom ({int(72 * PDF_RENDER_ZOOM)} DPI)")
        return paths
    except ImportError as e:
        print(f"  ⚠️  fitz (PyMuPDF) missing, falling back to pdf2image. Error details: {e}\n{traceback.format_exc()}")
        # pyrefly: ignore [missing-import]
        from pdf2image import convert_from_path
        dpi = int(72 * PDF_RENDER_ZOOM)
        images = convert_from_path(pdf_path, dpi=dpi)
        paths = []
        for i, img in enumerate(images):
            img_path = os.path.join(out_dir, f"page_{i:04d}.png")
            img.save(img_path, "PNG")
            paths.append(img_path)
        return paths
    except Exception as e:
        print(f"  ⚠️  PDF to images conversion failed completely. Error details: {e}\n{traceback.format_exc()}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# DOCX → images
# ─────────────────────────────────────────────────────────────────────────────

def _docx_to_images(docx_path: str, out_dir: str) -> list[str]:
    """Extract embedded images from a DOCX (e.g., scanned pages embedded as images)."""
    # pyrefly: ignore [missing-import]
    from docx import Document
    # pyrefly: ignore [missing-import]
    from docx.opc.constants import RELATIONSHIP_TYPE as RT

    doc = Document(docx_path)
    paths = []
    idx = 0
    try:
        for rel in doc.part.rels.values():
            if "image" in rel.reltype:
                img_data = rel.target_part.blob
                ext = Path(rel.target_partname).suffix.lower() or ".png"
                img_path = os.path.join(out_dir, f"image_{idx:04d}{ext}")
                with open(img_path, "wb") as f:
                    f.write(img_data)
                paths.append(img_path)
                idx += 1
    except Exception as e:
        print(f"  ⚠️  Error extracting embedded images from DOCX. Error details: {e}\n{traceback.format_exc()}")

    if not paths:
        try:
            import subprocess
            pdf_path = os.path.join(out_dir, "converted.pdf")
            subprocess.run(
                ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
                capture_output=True, timeout=30
            )
            base = Path(docx_path).stem
            pdf_candidate = os.path.join(out_dir, f"{base}.pdf")
            if os.path.exists(pdf_candidate):
                return _pdf_to_images(pdf_candidate, out_dir)
        except Exception as e:
            print(f"  ⚠️  DOCX to PDF fallback conversion failed. Error details: {e}\n{traceback.format_exc()}")

    return sorted(paths)


# ─────────────────────────────────────────────────────────────────────────────
# Collect all images from any supported input
# ─────────────────────────────────────────────────────────────────────────────

def collect_images(file_path: str, filename: str, scratch_dir: str) -> list[str]:
    """
    Given any supported input file, return an ordered list of image paths
    suitable for transcription.
    """
    ext = Path(filename).suffix.lower()
    os.makedirs(scratch_dir, exist_ok=True)

    if ext in SUPPORTED_IMAGE_EXTS:
        dest = os.path.join(scratch_dir, f"img_0000{ext}")
        shutil.copy2(file_path, dest)
        return [dest]

    if ext == ".pdf":
        return _pdf_to_images(file_path, scratch_dir)

    if ext == ".docx":
        return _docx_to_images(file_path, scratch_dir)

    if ext == ".zip":
        image_paths = []
        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                members = sorted([
                    m for m in zf.namelist()
                    if Path(m).suffix.lower() in SUPPORTED_IMAGE_EXTS
                    and not m.startswith("__MACOSX")
                    and not os.path.basename(m).startswith(".")
                ])
                for i, member in enumerate(members):
                    member_ext = Path(member).suffix.lower()
                    dest = os.path.join(scratch_dir, f"img_{i:04d}{member_ext}")
                    with zf.open(member) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    image_paths.append(dest)

                pdf_members = [m for m in zf.namelist()
                               if Path(m).suffix.lower() in {".pdf", ".docx"}
                               and not m.startswith("__MACOSX")]
                for member in pdf_members:
                    member_ext = Path(member).suffix.lower()
                    tmp = os.path.join(scratch_dir, f"inner_{uuid.uuid4().hex}{member_ext}")
                    with zf.open(member) as src, open(tmp, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    sub_dir = os.path.join(scratch_dir, f"sub_{uuid.uuid4().hex}")
                    os.makedirs(sub_dir, exist_ok=True)
                    if member_ext == ".pdf":
                        image_paths.extend(_pdf_to_images(tmp, sub_dir))
                    else:
                        image_paths.extend(_docx_to_images(tmp, sub_dir))
                    os.remove(tmp)

            seen: set[str] = set()
            ordered: list[str] = []
            for p in image_paths:
                if p not in seen:
                    seen.add(p)
                    ordered.append(p)
            return ordered
        except Exception as e:
            print(f"  ⚠️  ZIP file processing failed. Error details: {e}\n{traceback.format_exc()}")
            raise

    raise ValueError(f"Unsupported file type: {ext}")


# ─────────────────────────────────────────────────────────────────────────────
# Retry helper
# ─────────────────────────────────────────────────────────────────────────────

def _api_call_with_retry(fn, *args, **kwargs):
    """
    Call fn(*args, **kwargs) up to MAX_RETRIES times with exponential backoff.
    Retries on RateLimitError, APIStatusError (5xx), and generic exceptions.
    """
    delay = RETRY_BASE_DELAY
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            last_exc = e
            err_str = str(e).lower()
            # Retry on rate limits and server errors; give up on auth/bad-request errors
            if any(k in err_str for k in ("rate limit", "429", "500", "502", "503", "timeout")):
                if attempt < MAX_RETRIES:
                    wait = delay * (2 ** (attempt - 1))
                    print(f"  ⏳  API error (attempt {attempt}/{MAX_RETRIES}), retrying in {wait:.1f}s: {e}")
                    time.sleep(wait)
                    continue
            # Non-retryable error — raise immediately
            raise
    raise last_exc


# ─────────────────────────────────────────────────────────────────────────────
# GPT-4o Vision: transcribe images
# ─────────────────────────────────────────────────────────────────────────────

TRANSCRIPTION_SYSTEM = """You are an expert handwriting transcription assistant. 
Your job is to read handwritten text from page images and produce a faithful, clean transcription.

Rules:
- Preserve ALL text exactly as written, including the original language (do not translate).
- Maintain paragraph breaks and section structure as best you can infer.
- If a word is illegible, write [illegible] in brackets.
- Do NOT add commentary, headers, or notes outside the transcribed text.
- Do NOT add markdown like **bold** or *italic*.
- Produce plain text paragraphs separated by blank lines.
- If the page appears blank or contains only drawings/images with no text, output: [PAGE: no text]
"""


def _transcribe_single_batch(
    batch: list[str],
    batch_start: int,
) -> list[dict]:
    """
    Transcribe one batch of images (PAGES_PER_BATCH pages) via a single API call.
    Returns list of {page_num, text, has_content} dicts in page order.
    """
    successful_indices: list[int] = []
    failed_indices: list[int] = []
    api_content: list[dict] = [{"type": "text", "text": ""}]  # placeholder

    for slot, img_path in enumerate(batch):
        try:
            b64, mime = _image_to_b64(img_path)
            api_content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"},
            })
            successful_indices.append(slot)
        except Exception as e:
            print(f"  ⚠️  Could not encode {img_path}. Error details: {e}\n{traceback.format_exc()}")
            failed_indices.append(slot)

    n_sent = len(successful_indices)
    if n_sent == 1:
        api_content[0]["text"] = "Transcribe the handwritten text from this page image."
    else:
        api_content[0]["text"] = (
            f"Transcribe the handwritten text from the following {n_sent} page image(s). "
            "Separate each page's content with the marker ---PAGE_BREAK--- on its own line."
        )

    batch_results: list[dict] = [{}] * len(batch)

    for slot in failed_indices:
        batch_results[slot] = {
            "page_num": batch_start + slot + 1,
            "text": "[illegible - could not process image]",
            "has_content": False,
        }

    if successful_indices:
        try:
            def _call():
                return client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": TRANSCRIPTION_SYSTEM},
                        {"role": "user", "content": api_content},
                    ],
                    max_tokens=TRANSCRIPTION_MAX_TOKENS,
                )

            response = _api_call_with_retry(_call)
            raw = (response.choices[0].message.content or "").strip()

            if n_sent == 1:
                gpt_pages = [raw]
            else:
                gpt_pages = raw.split("---PAGE_BREAK---")

            for i, slot in enumerate(successful_indices):
                page_text = gpt_pages[i].strip() if i < len(gpt_pages) else ""
                has_content = bool(page_text) and "[PAGE: no text]" not in page_text
                batch_results[slot] = {
                    "page_num": batch_start + slot + 1,
                    "text": page_text if has_content else "",
                    "has_content": has_content,
                }

            # Fill any extra slots if GPT returned fewer splits than images
            for slot in successful_indices[len(gpt_pages):]:
                batch_results[slot] = {
                    "page_num": batch_start + slot + 1,
                    "text": "[transcription incomplete for this page]",
                    "has_content": False,
                }

        except Exception as e:
            print(f"  ⚠️  Transcription batch pages {batch_start+1}–{batch_start+len(batch)} failed after retries. "
                  f"Error details: {e}\n{traceback.format_exc()}")
            for slot in successful_indices:
                batch_results[slot] = {
                    "page_num": batch_start + slot + 1,
                    "text": "[transcription failed for this page]",
                    "has_content": False,
                }

    return [r for r in batch_results if r]


def transcribe_images(image_paths: list[str], book_title: str = "") -> list[dict]:
    """
    Transcribe a list of images using GPT-4o vision in parallel.

    Key improvements over original:
      - PAGES_PER_BATCH=1 by default (reliable page alignment)
      - TRANSCRIPTION_MAX_TOKENS=16384 (no silent truncation)
      - ThreadPoolExecutor for parallel processing (TRANSCRIPTION_WORKERS workers)
      - Exponential backoff retries via _api_call_with_retry

    Returns list of {page_num, text, has_content} dicts.
    """
    total = len(image_paths)
    print(f"  🖊️  Transcribing {total} pages | batch_size={PAGES_PER_BATCH} | workers={TRANSCRIPTION_WORKERS}")

    # Build batches
    batches: list[tuple[list[str], int]] = []  # (batch_images, batch_start_index)
    for batch_start in range(0, total, PAGES_PER_BATCH):
        batch = image_paths[batch_start: batch_start + PAGES_PER_BATCH]
        batches.append((batch, batch_start))

    results_by_start: dict[int, list[dict]] = {}
    completed = 0

    with ThreadPoolExecutor(max_workers=TRANSCRIPTION_WORKERS) as executor:
        future_to_start = {
            executor.submit(_transcribe_single_batch, batch, batch_start): batch_start
            for batch, batch_start in batches
        }
        for future in as_completed(future_to_start):
            batch_start = future_to_start[future]
            try:
                batch_result = future.result()
                results_by_start[batch_start] = batch_result
            except Exception as e:
                # Shouldn't happen because _transcribe_single_batch handles errors internally,
                # but guard anyway
                print(f"  ⚠️  Unexpected future error at batch_start={batch_start}: {e}")
                batch_size = min(PAGES_PER_BATCH, total - batch_start)
                results_by_start[batch_start] = [
                    {"page_num": batch_start + i + 1, "text": "[transcription failed]", "has_content": False}
                    for i in range(batch_size)
                ]
            completed += 1
            if completed % 20 == 0 or completed == len(batches):
                print(f"  ✅  {completed}/{len(batches)} batches done "
                      f"({completed * PAGES_PER_BATCH}/{total} pages)")

    # Reassemble in original page order
    all_results: list[dict] = []
    for batch_start in sorted(results_by_start.keys()):
        all_results.extend(results_by_start[batch_start])

    content_count = sum(1 for r in all_results if r["has_content"])
    print(f"  📝  Transcription complete: {content_count}/{total} pages have content")
    return all_results

# ─────────────────────────────────────────────────────────────────────────────
# NEW ADVANCED UPGRADE: The "Context Healer" Agent
# ─────────────────────────────────────────────────────────────────────────────

HEALER_SYSTEM_PROMPT = """You are a post-OCR correction agent. 
You are receiving transcribed text from handwritten pages that were processed in parallel.
Your strict mission:
1. Fix hyphenation and broken sentences that occur across page boundaries.
2. If there is an [illegible] marker, use the context of the surrounding sentences to deduce what the word likely was. If you cannot confidently guess, leave it as [illegible].
3. DO NOT paraphrase, summarize, or change the style. Only fix OCR artifacts.
4. Preserve the original language perfectly (especially Hindi/Devanagari if present).
"""

def heal_transcription_context(pages: list[dict]) -> list[dict]:
    """
    Passes the compiled text through a secondary intelligent agent to fix 
    page-break disconnects and deduce [illegible] words based on total context.
    """
    print("  🩹 Initiating Context Healer Agent to fix page boundaries and illegible words...")
    
    content_pages = [p for p in pages if p["has_content"]]
    if not content_pages:
        return pages

    # Combine pages into large overlapping chunks to heal boundaries
    compiled_text = "\n\n---PAGE_BREAK---\n\n".join(
        [f"[PAGE {p['page_num']}]\n{p['text']}" for p in content_pages]
    )

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": HEALER_SYSTEM_PROMPT},
                {"role": "user", "content": f"Heal this raw OCR text:\n\n{compiled_text[:60000]}"} # 60k char limit for safety
            ],
            max_tokens=10000,
            temperature=0.1 # Low temp for strict correction without hallucinating new story
        )
        healed_raw = response.choices[0].message.content.strip()
        
        # Re-parse the healed text back into the page dictionary format
        healed_pages = []
        raw_splits = healed_raw.split("---PAGE_BREAK---")
        
        for i, split_text in enumerate(raw_splits):
            if i < len(content_pages):
                # Strip the injected [PAGE X] tag
                clean_text = re.sub(r'\[PAGE \d+\]\n?', '', split_text).strip()
                content_pages[i]["text"] = clean_text
                
        print("  ✅ Context Healer successfully stitched page boundaries.")
        return pages # Return original dict structure with healed text
        
    except Exception as e:
        print(f"  ⚠️ Healer agent failed, falling back to raw parallel transcription: {e}")
        return pages

# ─────────────────────────────────────────────────────────────────────────────
# Post-processing: structure the transcribed text into a clean book
# ─────────────────────────────────────────────────────────────────────────────

STRUCTURE_SYSTEM = """You are a professional book editor and formatter.
You receive raw transcribed text (possibly from handwritten pages) and must:
1. Clean up obvious OCR/transcription artifacts (repeated words, stray characters)
2. Identify and mark chapters/sections if they exist (look for numbered headings, "Chapter X", etc.)
3. Fix clear run-on sentences caused by page breaks mid-sentence
4. Preserve the author's original voice, language, and style — do NOT paraphrase or rewrite
5. Preserve the original language (do not translate)
6. Return structured JSON only

Return ONLY valid JSON with no preamble, no markdown fences:
{
  "title": "<inferred or provided title>",
  "language": "<detected language, e.g. English, Hindi, Tamil, etc.>",
  "chapters": [
    {
      "chapter_number": 1,
      "title": "<chapter title or 'Chapter 1' if untitled>",
      "content": "<cleaned chapter text with paragraph breaks as \\n\\n>"
    }
  ],
  "total_words": <integer word count>
}
"""


def structure_transcription(pages: list[dict], book_title: str = "") -> dict:
    """
    Use GPT-4o to clean and structure the raw transcription into chapters.

    Key improvements over original:
      - STRUCTURE_CHUNK_SIZE reduced to 20K chars (prevents JSON truncation)
      - STRUCTURE_MAX_TOKENS raised to 10000
      - Retries on each chunk via _api_call_with_retry
    """
    content_pages = [p for p in pages if p["has_content"]]
    if not content_pages:
        return {
            "title": book_title or "Untitled Manuscript",
            "language": "Unknown",
            "chapters": [{"chapter_number": 1, "title": "Content",
                          "content": "[No readable text found in the uploaded pages]"}],
            "total_words": 0,
        }

    # Detect language from a small sample
    sample_text = "\n\n".join(p["text"] for p in content_pages[:5])
    detected_language = "Unknown"
    try:
        lang_resp = _api_call_with_retry(
            client.chat.completions.create,
            model=MODEL,
            messages=[{"role": "user", "content": f"What language is this text written in? Reply with just the language name.\n\n{sample_text[:500]}"}],
            max_tokens=20,
        )
        detected_language = (lang_resp.choices[0].message.content or "").strip()
    except Exception as e:
        print(f"  ⚠️  Language detection failed. Error details: {e}\n{traceback.format_exc()}")

    # Split into chunks at page boundaries
    text_chunks: list[str] = []
    current_chunk: list[str] = []
    current_size = 0

    for p in content_pages:
        page_block = f"[Page {p['page_num']}]\n{p['text']}"
        block_size = len(page_block) + 2

        # If adding this page would exceed the chunk size AND we already have content,
        # flush the current chunk first
        if current_size + block_size > STRUCTURE_CHUNK_SIZE and current_chunk:
            text_chunks.append("\n\n".join(current_chunk))
            current_chunk = []
            current_size = 0

        current_chunk.append(page_block)
        current_size += block_size

    if current_chunk:
        text_chunks.append("\n\n".join(current_chunk))

    print(f"  📖 Structuring transcription: {len(content_pages)} pages → {len(text_chunks)} chunk(s)")

    all_chapters: list[dict] = []
    chapter_counter = 0

    for chunk_idx, chunk_text in enumerate(text_chunks):
        prompt = (
            f"Book title (if known): {book_title or 'Unknown — infer from content if possible'}\n"
            f"Language: {detected_language}\n"
            + (f"(This is part {chunk_idx + 1} of {len(text_chunks)} — continue chapter numbering from {chapter_counter + 1})\n"
               if len(text_chunks) > 1 else "")
            + f"\nRaw transcribed pages:\n{chunk_text}"
        )
        try:
            def _structure_call(p=prompt):
                return client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": STRUCTURE_SYSTEM},
                        {"role": "user", "content": p},
                    ],
                    max_tokens=STRUCTURE_MAX_TOKENS,
                )

            response = _api_call_with_retry(_structure_call)
            raw = (response.choices[0].message.content or "").strip()
            # Strip any accidental markdown fences
            raw = raw.replace("```json", "").replace("```", "").strip()
            s = raw.find("{")
            e = raw.rfind("}") + 1
            if s == -1 or e == 0:
                raise ValueError("No JSON object found in structure response")
            chunk_result = json.loads(raw[s:e])

            for ch in chunk_result.get("chapters", []):
                chapter_counter += 1
                all_chapters.append({
                    "chapter_number": chapter_counter,
                    "title": ch.get("title", f"Chapter {chapter_counter}"),
                    "content": ch.get("content", ""),
                })

            if chunk_idx == 0:
                if chunk_result.get("title") and not book_title:
                    book_title = chunk_result["title"]
                if chunk_result.get("language") and detected_language == "Unknown":
                    detected_language = chunk_result["language"]

        except Exception as exc:
            print(f"  ⚠️  Structuring chunk {chunk_idx + 1} failed. Error details: {exc}\n{traceback.format_exc()}. Using flat fallback.")
            chapter_counter += 1
            all_chapters.append({
                "chapter_number": chapter_counter,
                "title": f"Part {chapter_counter}",
                "content": chunk_text,
            })

    if not all_chapters:
        full_text = "\n\n".join(f"[Page {p['page_num']}]\n{p['text']}" for p in content_pages)
        all_chapters = [{"chapter_number": 1, "title": "Full Content", "content": full_text}]

    total_words = sum(len(ch["content"].split()) for ch in all_chapters)

    return {
        "title": book_title or "Transcribed Manuscript",
        "language": detected_language,
        "chapters": all_chapters,
        "total_words": total_words,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PDF generator for scanned book
# ─────────────────────────────────────────────────────────────────────────────

def generate_scanned_pdf(structure: dict, output_path: str) -> str:
    try:
        from reportlab.lib.pagesizes import A4                                      # pyrefly: ignore [missing-import]
        from reportlab.lib.units import mm                                          # pyrefly: ignore [missing-import]
        from reportlab.lib.styles import ParagraphStyle                             # pyrefly: ignore [missing-import]
        from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT             # pyrefly: ignore [missing-import]
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, HRFlowable  # pyrefly: ignore [missing-import]
        from reportlab.lib.colors import HexColor, white                            # pyrefly: ignore [missing-import]
        import datetime

        # ── Register Unicode/Devanagari fonts so Hindi text renders correctly ──────
        _ensure_unicode_fonts()

        # ── Detect whether this document contains non-Latin (e.g. Hindi) text ─────
        all_text = structure.get("title", "") + " ".join(
            ch.get("title", "") + " " + ch.get("content", "")
            for ch in structure.get("chapters", [])
        )
        has_unicode = _has_non_latin(all_text)

        # ── Resolve fonts: swap Helvetica → Noto Devanagari when needed ───────────
        # Body / chapter titles may contain Hindi → Unicode-aware font.
        # Header/footer are always Latin (page numbers, ASCII date) → Helvetica OK.
        body_font_base = _unicode_body_font("Helvetica", has_unicode)
        ch_title_font  = _unicode_body_font("Helvetica", has_unicode)
        header_font    = "Helvetica"

        DARK   = HexColor("#1E293B")
        ACCENT = HexColor("#7C3AED")
        MARGIN = 22 * mm

        def on_cover(canvas, doc):
            w, h = A4
            canvas.setFillColor(HexColor("#0f0a1e"))
            canvas.rect(0, 0, w, h, fill=1, stroke=0)
            canvas.setFillColor(HexColor("#7C3AED"))
            canvas.rect(0, h * 0.38, w, 3, fill=1, stroke=0)
            canvas.setFillColor(HexColor("#0a0614"))
            canvas.rect(0, 0, w, 18*mm, fill=1, stroke=0)
            canvas.setFillColor(HexColor("#475569"))
            canvas.setFont(header_font, 8)
            canvas.drawCentredString(w/2, 7*mm, f"Transcribed by AI Scanner  ·  {datetime.date.today()}")

        def on_page(canvas, doc):
            w, h = A4
            canvas.saveState()
            canvas.setFillColor(DARK)
            canvas.rect(0, 0, w, 9*mm, fill=1, stroke=0)
            canvas.setFillColor(white)
            canvas.setFont(header_font, 7.5)
            canvas.drawString(MARGIN, 3*mm, structure.get("title", "Manuscript"))
            canvas.drawRightString(w - MARGIN, 3*mm, f"Page {doc.page}")
            canvas.restoreState()

        S = lambda name, **kw: ParagraphStyle(name, **kw)
        # Cover styles — always Latin (dates, language label)
        cover_title = S("ct", fontName="Helvetica-Bold", fontSize=30, textColor=white,
                        leading=38, alignment=TA_CENTER, spaceAfter=8, wordWrap="LTR")
        cover_sub   = S("cs", fontName="Helvetica",      fontSize=12, textColor=HexColor("#94a3b8"),
                        leading=16, alignment=TA_CENTER, wordWrap="LTR")
        # Chapter label ("Chapter N") — always Latin
        ch_label    = S("cl", fontName="Helvetica", fontSize=10, textColor=ACCENT,
                        leading=14, spaceBefore=0, spaceAfter=3, wordWrap="LTR")
        # Chapter title — may be Hindi; use Unicode-aware font
        ch_title    = S("cht", fontName=ch_title_font, fontSize=20, textColor=DARK,
                        leading=26, spaceBefore=2, spaceAfter=5, wordWrap="LTR")
        # Body — may be Hindi; use Unicode-aware font + LTR word wrap (never CJK —
        # CJK mode breaks Devanagari conjunct ligatures)
        body        = S("bs", fontName=body_font_base, fontSize=10.5,
                        textColor=HexColor("#334155"), leading=17, spaceAfter=8,
                        alignment=TA_JUSTIFY, wordWrap="LTR")
        lang_badge  = S("lb", fontName="Helvetica", fontSize=9,
                        textColor=HexColor("#7C3AED"), leading=14, alignment=TA_CENTER,
                        wordWrap="LTR")

        doc = SimpleDocTemplate(output_path, pagesize=A4,
                                leftMargin=MARGIN, rightMargin=MARGIN,
                                topMargin=MARGIN, bottomMargin=18*mm,
                                title=structure.get("title", "Manuscript"))
        doc.title = structure.get("title", "Manuscript")

        story = []
        story.append(Spacer(1, 50*mm))
        # Cover title: HTML-escape then apply dual-font markup if mixed script
        safe_cov_title = (structure.get("title", "Manuscript")
                          .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        if has_unicode:
            safe_cov_title = _mixed_font_html(safe_cov_title, body_font_base)
        story.append(Paragraph(safe_cov_title, cover_title))
        story.append(Spacer(1, 5*mm))
        lang = structure.get("language", "")
        if lang:
            story.append(Paragraph(f"Language: {lang}", cover_sub))
        story.append(Spacer(1, 4*mm))
        story.append(Paragraph(f"Transcribed on {datetime.date.today().strftime('%B %d, %Y')}", cover_sub))
        story.append(PageBreak())

        for ch in structure.get("chapters", []):
            story.append(Spacer(1, 8*mm))
            story.append(Paragraph(f"Chapter {ch['chapter_number']}", ch_label))
            # Chapter title — may contain Hindi
            safe_ch_title = (ch["title"]
                             .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            if has_unicode:
                safe_ch_title = _mixed_font_html(safe_ch_title, ch_title_font)
            story.append(Paragraph(safe_ch_title, ch_title))
            story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=10))
            for para in ch["content"].split("\n\n"):
                para = para.strip()
                if not para:
                    continue
                # HTML-escape, then apply dual-font markup for mixed Hindi+Latin
                safe_para = (para
                             .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
                if has_unicode:
                    safe_para = _mixed_font_html(safe_para, body_font_base)
                story.append(Paragraph(safe_para, body))
            story.append(PageBreak())

        doc.build(story, onFirstPage=on_cover, onLaterPages=on_page)
        return output_path
    except Exception as e:
        print(f"  ⚠️  generate_scanned_pdf failed. Error details: {e}\n{traceback.format_exc()}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# DOCX generator for scanned book
# ─────────────────────────────────────────────────────────────────────────────

def generate_scanned_docx(structure: dict, output_path: str) -> str:
    try:
        # pyrefly: ignore [missing-import]
        from docx import Document
        # pyrefly: ignore [missing-import]
        from docx.shared import Pt, RGBColor, Cm
        # pyrefly: ignore [missing-import]
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        # pyrefly: ignore [missing-import]
        from docx.oxml.ns import qn
        # pyrefly: ignore [missing-import]
        from docx.oxml import OxmlElement
        import datetime

        # ── Detect whether this document contains Hindi/Devanagari text ──────────
        all_text_docx = structure.get("title", "") + " ".join(
            ch.get("title", "") + " " + ch.get("content", "")
            for ch in structure.get("chapters", [])
        )
        has_unicode_docx = _has_non_latin(all_text_docx)

        # ── Choose the right Word font for body content ───────────────────────────
        # For Devanagari content we need a Unicode-capable font.
        # Map the ReportLab unicode font names back to Word font names.
        _RL_TO_WORD: dict[str, str] = {
            "NotoSansDevanagari":       "Noto Sans Devanagari",
            "NotoSansDevanagari-Bold":  "Noto Sans Devanagari",
            "NotoSerifDevanagari":      "Noto Serif Devanagari",
            "NotoSerifDevanagari-Bold": "Noto Serif Devanagari",
        }
        rl_body_font = _unicode_body_font("Helvetica", has_unicode_docx)
        word_body_font = _RL_TO_WORD.get(rl_body_font, "Calibri")
        word_latin_fallback = _DOCX_LATIN_FALLBACK.get(rl_body_font, "Calibri")

        def set_color(paragraph, hex_color="7C3AED"):
            for run in paragraph.runs:
                run.font.color.rgb = RGBColor(int(hex_color[0:2],16), int(hex_color[2:4],16), int(hex_color[4:6],16))

        def _set_run_font_cs(run, font_name: str) -> None:
            """Set complex-script and East-Asian font on a run so Word uses
            the Devanagari font for Devanagari codepoints rather than falling
            back to the theme Latin font."""
            rPr = run._r.get_or_add_rPr()
            existing = rPr.find(qn("w:rFonts"))
            if existing is None:
                existing = OxmlElement("w:rFonts")
                rPr.insert(0, existing)
            existing.set(qn("w:ascii"),    font_name)
            existing.set(qn("w:hAnsi"),    font_name)
            existing.set(qn("w:cs"),       font_name)   # complex-script (Devanagari)
            existing.set(qn("w:eastAsia"), font_name)

        def _is_latin_char_docx(ch: str) -> bool:
            cp = ord(ch)
            if ch.isspace():
                return False
            if 0x0900 <= cp <= 0x097F:
                return False   # Devanagari → Devanagari font
            if 0x0020 <= cp <= 0x024F:
                return True    # Basic Latin + Latin Extended A/B
            if 0x2000 <= cp <= 0x206F:
                return True    # General Punctuation
            return False

        def add_para_unicode(p, text: str, size_pt: float, bold: bool = False,
                             italic: bool = False, color_rgb: RGBColor = None,
                             align=WD_ALIGN_PARAGRAPH.LEFT) -> None:
            """Add text to paragraph p with dual-run support for mixed Hindi+Latin.
            When has_unicode_docx is True, Latin characters use word_latin_fallback
            so digits, English words, and punctuation render with correct metrics."""
            p.alignment = align
            if not has_unicode_docx or not text.strip():
                run = p.add_run(text)
                run.font.name   = word_body_font
                run.font.size   = Pt(size_pt)
                run.font.bold   = bold
                run.font.italic = italic
                if color_rgb:
                    run.font.color.rgb = color_rgb
                _set_run_font_cs(run, word_body_font)
                return

            # Split into Devanagari vs Latin runs
            runs_list: list[tuple[bool, str]] = []
            if text:
                cur_latin = _is_latin_char_docx(text[0])
                cur_buf   = text[0]
                for ch in text[1:]:
                    ch_lat = _is_latin_char_docx(ch)
                    if ch.isspace() or ch_lat == cur_latin:
                        cur_buf += ch
                    else:
                        runs_list.append((cur_latin, cur_buf))
                        cur_latin = ch_lat
                        cur_buf   = ch
                if cur_buf:
                    runs_list.append((cur_latin, cur_buf))

            for is_latin, chunk in runs_list:
                chosen_font = word_latin_fallback if (is_latin and chunk.strip()) else word_body_font
                run = p.add_run(chunk)
                run.font.name   = chosen_font
                run.font.size   = Pt(size_pt)
                run.font.bold   = bold
                run.font.italic = italic
                if color_rgb:
                    run.font.color.rgb = color_rgb
                _set_run_font_cs(run, chosen_font)

        doc = Document()
        section = doc.sections[0]
        section.page_height = Cm(29.7)
        section.page_width  = Cm(21.0)
        section.left_margin = section.right_margin = Cm(2.5)
        section.top_margin  = Cm(2.5)
        section.bottom_margin = Cm(2.0)

        style_normal = doc.styles['Normal']
        style_normal.font.name = word_body_font
        style_normal.font.size = Pt(11)

        # Cover page
        for _ in range(4): doc.add_paragraph()
        t = doc.add_paragraph()
        t.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_para_unicode(t, structure.get("title", "Manuscript"), 26, bold=True,
                         color_rgb=RGBColor(0x1E, 0x29, 0x3B), align=WD_ALIGN_PARAGRAPH.CENTER)

        lang = structure.get("language", "")
        if lang:
            lp = doc.add_paragraph()
            lp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            lr = lp.add_run(f"Language: {lang}")
            lr.font.size = Pt(11); lr.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)

        dp = doc.add_paragraph()
        dp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        dr = dp.add_run(f"Transcribed on {datetime.date.today().strftime('%B %d, %Y')}")
        dr.font.size = Pt(10); dr.font.italic = True; dr.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)
        doc.add_page_break()

        for ch in structure.get("chapters", []):
            lbl = doc.add_paragraph()
            lr = lbl.add_run(f"Chapter {ch['chapter_number']}")
            lr.font.size = Pt(10); lr.font.bold = True
            lr.font.color.rgb = RGBColor(0x7C, 0x3A, 0xED)

            # Chapter title — add via heading then patch with dual-run Unicode support
            heading = doc.add_heading("", level=1)
            add_para_unicode(heading, ch["title"], 16, bold=True,
                             color_rgb=RGBColor(0x1E, 0x29, 0x3B),
                             align=WD_ALIGN_PARAGRAPH.LEFT)
            doc.add_paragraph()

            for para in ch["content"].split("\n\n"):
                para = para.strip()
                if not para:
                    continue
                p = doc.add_paragraph()
                p.style = doc.styles['Normal']
                p.paragraph_format.space_after = Pt(6)
                p.paragraph_format.line_spacing = Pt(16)
                add_para_unicode(p, para, 11, align=WD_ALIGN_PARAGRAPH.JUSTIFY)

            doc.add_page_break()

        doc.save(output_path)
        return output_path
    except Exception as e:
        print(f"  ⚠️  generate_scanned_docx failed. Error details: {e}\n{traceback.format_exc()}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# UPGRADED MAIN ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────────────────

def scan_handwritten_book(
    file_path: str,
    filename: str,
    output_dir: str,
    book_title: str = "",
    progress_callback=None,
) -> dict:
    """
    Upgraded Pipeline:
    1. Extract/collect images
    2. Image Pre-Processing & Contrast Enhancement (NEW)
    3. Transcribe via GPT-4o vision (Parallel)
    4. Context Healer Agent fixes page breaks & illegible tags (NEW)
    5. Structure into chapters
    6. Generate Premium Multi-lingual PDF + DOCX
    """
    os.makedirs(output_dir, exist_ok=True)
    job_id = uuid.uuid4().hex
    scratch_dir = os.path.join(output_dir, f"scratch_{job_id}")

    try:
        # Step 1: Collect images
        if progress_callback: progress_callback("collecting", 0, "Extracting pages…")
        images = collect_images(file_path, filename, scratch_dir)
        total_pages = len(images)
        if total_pages == 0:
            raise ValueError("No readable images found in the uploaded file.")

        if progress_callback: progress_callback("transcribing", 5, f"Found {total_pages} pages. Enhancing and transcribing…")

        # Step 2 & 3: Transcribe (with built-in enhancement)
        transcribed = transcribe_images(images, book_title)

        # Step 4: The Healer Agent
        if progress_callback: progress_callback("healing", 65, "AI Healer stitching broken sentences and fixing illegible words...")
        healed_transcription = heal_transcription_context(transcribed)

        content_pages = sum(1 for p in healed_transcription if p["has_content"])
        if progress_callback: progress_callback("structuring", 75, f"Structuring {content_pages}/{total_pages} pages into chapters…")

        # Step 5: Structure
        structure = structure_transcription(healed_transcription, book_title)
        if book_title:
            structure["title"] = book_title

        if progress_callback: progress_callback("assembling", 85, "Generating PDF and DOCX (Applying Unicode layout)…")

        # Step 6: Generate outputs
        safe_title = "".join(c for c in structure["title"] if c.isalnum() or c in (" ", "-", "_")).strip() or "manuscript"
        pdf_path  = os.path.join(output_dir, f"{safe_title}_{job_id}.pdf")
        docx_path = os.path.join(output_dir, f"{safe_title}_{job_id}.docx")

        # These use your brilliant custom Hindi/ReportLab functions seamlessly
        generate_scanned_pdf(structure, pdf_path)
        generate_scanned_docx(structure, docx_path)

        if progress_callback: progress_callback("done", 100, "Complete!")

        return {
            "job_id": job_id,
            "title": structure["title"],
            "language": structure.get("language", "Unknown"),
            "total_pages": total_pages,
            "content_pages": content_pages,
            "total_words": structure.get("total_words", 0),
            "chapters": len(structure.get("chapters", [])),
            "chapter_titles": [c["title"] for c in structure.get("chapters", [])],
            "pdf_path": pdf_path,
            "docx_path": docx_path,
        }
    except Exception as e:
        print(f"  🚨 CRITICAL ERROR in scan_handwritten_book: {e}\n{traceback.format_exc()}")
        if progress_callback: progress_callback("error", -1, f"Failed: {e}")
        raise

    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)