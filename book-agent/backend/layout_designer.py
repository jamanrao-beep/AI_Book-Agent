"""
layout_designer.py  ·  v2.5 (Strict Dimensions, TOC Bypass & Intro Capture)
AI-powered internal book layout designer — with full book-type awareness
and proper Unicode (Devanagari, Hindi, multi-script) support.

Pipeline:
  1. Extract raw text from PDF / DOCX / ZIP
  2. Detect chapter boundaries (supports Hindi/Devanagari अध्याय headings)
  3. Build book-type defaults (novel, academic, religious, poetry, children, business)
  4. Ask GPT-4o to produce a complete typographic layout concept (JSON),
     seeded with type-aware defaults and any user overrides
  5. Apply hard user overrides on top of the AI concept  (user always wins)
  6. Render PDF  (ReportLab + registered Unicode/Noto fonts)
  7. Render DOCX (python-docx)
  8. Return paths + metadata to the caller
"""

from __future__ import annotations

import io
import json
import math
import os
import re
import shutil
import threading
import unicodedata
import urllib.request
import uuid
import zipfile
import traceback
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
# Unicode font system
# Strategy (in priority order):
#   1. Local ./fonts/ directory bundled with the app
#   2. Common system paths (Ubuntu/Debian/Alpine)
#   3. Auto-download from Google Fonts CDN at first run → cached in ./fonts/
#
# This guarantees Hindi/Devanagari PDFs always work regardless of what is
# installed on the server.
# ─────────────────────────────────────────────────────────────────────────────

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_FONTS_DIR   = os.path.join(_SCRIPT_DIR, "fonts")   # local cache / bundled dir

# Google Fonts static CDN URLs for the two Noto fonts we need.
# These are stable direct-download links (not the CSS API endpoint).
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

# ReportLab name → filename
_NOTO_FONT_FILES: dict[str, str] = {
    "NotoSerifDevanagari":      "NotoSerifDevanagari-Regular.ttf",
    "NotoSerifDevanagari-Bold": "NotoSerifDevanagari-Bold.ttf",
    "NotoSansDevanagari":       "NotoSansDevanagari-Regular.ttf",
    "NotoSansDevanagari-Bold":  "NotoSansDevanagari-Bold.ttf",
}

_SYSTEM_FONT_DIRS = [
    "/usr/share/fonts/truetype/noto",   # Ubuntu/Debian: apt install fonts-noto-core
    "/usr/share/fonts/noto",
    "/usr/share/fonts/opentype/noto",
    "/usr/share/fonts/truetype/freefont",
    "/usr/share/fonts/freefont",
    "/usr/share/fonts",
    # Alpine / Docker slim images
    "/usr/share/fonts/noto-cjk",
    # macOS (local dev)
    "/Library/Fonts",
    "/System/Library/Fonts",
    # Windows (local dev)
    "C:/Windows/Fonts",
]

_REGISTERED_FONTS: set[str] = set()
_FONTS_REGISTERED  = False
_FONT_LOCK         = threading.Lock()


def _find_font_on_system(filename: str) -> Optional[str]:
    """Search known system font directories for a TTF file.
    Falls back to a recursive os.walk search under /usr/share/fonts."""
    # Check local ./fonts/ dir first
    local = os.path.join(_FONTS_DIR, filename)
    if os.path.isfile(local):
        return local
    for d in _SYSTEM_FONT_DIRS:
        p = os.path.join(d, filename)
        if os.path.isfile(p):
            return p
    # Last resort: recursive search under /usr/share/fonts (handles distro variations)
    base_search = "/usr/share/fonts"
    if os.path.isdir(base_search):
        for root, _dirs, files in os.walk(base_search):
            if filename in files:
                found = os.path.join(root, filename)
                print(f"  🔍  Found font via recursive search: {found}")
                return found
    return None


def _download_font(filename: str) -> Optional[str]:
    """
    Download a font file from GitHub/Google Fonts into _FONTS_DIR.
    Returns the local path on success, None on failure.
    """
    url = _FONT_URLS.get(filename)
    if not url:
        return None
    dest = os.path.join(_FONTS_DIR, filename)
    if os.path.isfile(dest):          # already downloaded in a previous run
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
        # Clean up partial file
        if os.path.isfile(dest):
            try:
                os.remove(dest)
            except Exception:
                pass
        return None


def _ensure_unicode_fonts() -> None:
    """
    Register Noto Devanagari TTFs with ReportLab (idempotent, thread-safe).
    Resolution order: local cache → system paths → auto-download from GitHub.
    """
    global _FONTS_REGISTERED, _REGISTERED_FONTS
    if _FONTS_REGISTERED:
        return
    with _FONT_LOCK:
        if _FONTS_REGISTERED:   # double-checked inside lock
            return
        try:
            from reportlab.pdfbase import pdfmetrics      # pyrefly: ignore [missing-import]
            from reportlab.pdfbase.ttfonts import TTFont  # pyrefly: ignore [missing-import]

            for rl_name, filename in _NOTO_FONT_FILES.items():
                # 1. Try system / local cache
                path = _find_font_on_system(filename)
                # 2. Auto-download if not found
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
                raise RuntimeError(
                    "CRITICAL: No Unicode/Devanagari fonts could be registered. "
                    "Fix: Run `apt-get install -y fonts-noto-core` on your server, "
                    "or place NotoSerifDevanagari-Regular.ttf (and Bold/Sans variants) "
                    "in a ./fonts/ folder next to layout_designer.py. "
                    "Without these fonts, Hindi text renders as square boxes."
                )
        except Exception as e:
            print(f"  ⚠️   _ensure_unicode_fonts failed: {e}\n{traceback.format_exc()}")
        finally:
            _FONTS_REGISTERED = True


def _has_non_latin(text: str) -> bool:
    """True if text contains Devanagari or other Indic scripts (U+0900+)."""
    return any(ord(c) >= 0x0900 for c in text
               if not unicodedata.category(c).startswith("Z"))


def _clean_extracted_text(text: str) -> str:
    """
    Remove null bytes, private-use Unicode characters, and other garbage that
    PDF extractors emit when a font uses a custom encoding map.
    Also normalises non-breaking spaces and zero-width characters.
    Returns the cleaned string.
    """
    # Strip null bytes and C0/C1 control characters (except newline/tab)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", text)
    # Strip Unicode private-use area blocks (U+E000–U+F8FF, U+F0000–U+FFFFF)
    text = re.sub(r"[\ue000-\uf8ff]", "", text)
    # Normalise non-breaking spaces and zero-width joiners/non-joiners to regular space
    text = text.replace("\u00a0", " ").replace("\u200b", "").replace("\u200c", "").replace("\u200d", "")
    # Collapse runs of whitespace-only lines (3+ blank lines → 2)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def _text_looks_corrupt(text: str) -> bool:
    """
    Returns True when the extracted text is mostly garbage (null bytes,
    private-use codepoints, or extremely low printable-character density).
    This is the signal to discard PDF extraction and try another source.
    """
    if not text:
        return True
    sample = text[:2000]
    null_count = sample.count("\x00")
    pua_count  = sum(1 for c in sample if "\ue000" <= c <= "\uf8ff")
    printable  = sum(1 for c in sample if c.isprintable() and c not in "\x00")
    total      = max(len(sample), 1)
    # Corrupt if >5 % null/PUA bytes OR printable ratio below 60 %
    return (null_count + pua_count) / total > 0.05 or printable / total < 0.60


def _unicode_body_font(rl_name: str, has_unicode: bool) -> str:
    """
    Return the best available Unicode-capable font name for the requested style.
    Falls back through the registered set; never returns a Latin-only font name
    when Unicode content is present (unless nothing at all was registered).
    """
    if not has_unicode:
        return rl_name

    _PREF: dict[str, list[str]] = {
        "Times-Roman":       ["NotoSerifDevanagari", "NotoSansDevanagari"],
        "Times-Italic":      ["NotoSerifDevanagari", "NotoSansDevanagari"],
        "Helvetica":         ["NotoSansDevanagari",  "NotoSerifDevanagari"],
        "Helvetica-Oblique": ["NotoSansDevanagari",  "NotoSerifDevanagari"],
        "Courier":           ["NotoSansDevanagari",  "NotoSerifDevanagari"],
    }
    for candidate in _PREF.get(rl_name, ["NotoSerifDevanagari", "NotoSansDevanagari"]):
        if candidate in _REGISTERED_FONTS:
            return candidate

    print(f"  🚨  No Unicode font for '{rl_name}' — text may render as boxes.")
    return rl_name


# ─────────────────────────────────────────────────────────────────────────────
# Book-type default profiles
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
        "header_text":         "",
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
    """Extract text from PDF. Tries pypdf first, pdfplumber as fallback.
    Cleans null-bytes and private-use garbage from both extractors.
    Returns cleaned text, or raises RuntimeError if both fail."""
    text = ""
    # Primary: pypdf
    try:
        from pypdf import PdfReader  # pyrefly: ignore [missing-import]
        reader = PdfReader(path)
        pages = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages.append(t)
        text = _clean_extracted_text("\n\n".join(pages))
    except Exception as e:
        print(f"  ⚠️  pypdf extraction failed: {e}\n{traceback.format_exc()}")

    # Detect custom-encoding corruption (null bytes / private-use characters)
    if _text_looks_corrupt(text):
        print("  ⚠️  pypdf produced corrupt/null-byte text — trying pdfplumber…")
        text = ""
        try:
            import pdfplumber  # pyrefly: ignore [missing-import]
            pages = []
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        pages.append(t)
            text = _clean_extracted_text("\n\n".join(pages))
        except Exception as exc:
            print(f"  ⚠️  pdfplumber fallback failed: {exc}\n{traceback.format_exc()}")
            if not text:
                raise RuntimeError(
                    f"PDF text extraction failed — both pypdf and pdfplumber produced no usable text. "
                    f"This usually means the PDF uses a custom/private font encoding. "
                    f"Please provide a .docx version of the manuscript instead. ({exc})"
                ) from exc

    # Final corruption check after both attempts
    if _text_looks_corrupt(text):
        raise RuntimeError(
            "PDF text extraction produced only garbage (null bytes / private-use characters). "
            "The PDF likely uses a custom font encoding that cannot be decoded without the "
            "original font. Please upload a .docx version of the manuscript."
        )

    return text


def _extract_from_docx(path: str) -> str:
    try:
        from docx import Document  # pyrefly: ignore [missing-import]
        doc = Document(path)
        raw = "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
        return _clean_extracted_text(raw)
    except Exception as exc:
        print(f"  ⚠️  DOCX extraction failed: {exc}\n{traceback.format_exc()}")
        raise RuntimeError(f"DOCX extraction failed: {exc}\n{traceback.format_exc()}") from exc


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
            for member in members:
                ext = os.path.splitext(member)[1].lower()
                tmp = os.path.join(scratch, f"{uuid.uuid4().hex}{ext}")
                with zf.open(member) as src, open(tmp, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                texts.append(_extract_from_pdf(tmp) if ext == ".pdf" else _extract_from_docx(tmp))
    except Exception as e:
        print(f"  ⚠️  ZIP extraction failed: {e}\n{traceback.format_exc()}")
        raise
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
    if ext in (".txt", ".md", ".text"):
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    if ext == ".rtf":
        try:
            from striprtf.striprtf import rtf_to_text  # pyrefly: ignore [missing-import]
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                return rtf_to_text(f.read())
        except ImportError as e:
            print(f"  ⚠️  striprtf not installed: {e}\n{traceback.format_exc()}")
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        except Exception as e:
            print(f"  ⚠️  Error extracting RTF: {e}\n{traceback.format_exc()}")
            raise
    raise ValueError(f"Unsupported file type: {ext}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Chapter detection
# BUG FIX: added Hindi/Devanagari chapter patterns (अध्याय, भाग, etc.)
# ─────────────────────────────────────────────────────────────────────────────

_CHAPTER_RE = re.compile(
    r"^(?:"
    # English: "Chapter 1", "Part II", "1. Title", "ALL CAPS TITLE"
    r"chapter\s+(?:\d+|[ivxlcdm]+)[^\n]*"
    r"|part\s+(?:\d+|[ivxlcdm]+)[^\n]*"
    r"|\d{1,3}[.\)]\s+[A-Z][^\n]{3,60}"
    r"|[A-Z][A-Z\s]{4,50}$"
    # Hindi/Devanagari: "अध्याय 1", "भाग 2", standalone Devanagari headings
    r"|अध्याय\s*[\d\u0966-\u096F]+"       # अध्याय + digits (ASCII or Devanagari)
    r"|भाग\s*[\d\u0966-\u096F]+"           # भाग (part)
    r"|प्रकरण\s*[\d\u0966-\u096F]+"        # प्रकरण (section/chapter)
    r"|खंड\s*[\d\u0966-\u096F]+"           # खंड (section)
    r"|सर्ग\s*[\d\u0966-\u096F]+"          # सर्ग (canto)
    r")",
    re.IGNORECASE | re.MULTILINE | re.UNICODE,
)

MAX_CHAPTERS = 10_000
MIN_CHAPTER_CHARS = 50


def parse_chapters(raw_text: str) -> list[dict]:
    try:
        lines = raw_text.split("\n")
        splits: list[int] = []
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped and _CHAPTER_RE.match(stripped) and len(stripped) < 200:
                splits.append(i)

        # --- FIX 2: TOC Filter (Bypass Table of Contents) ---
        bad_splits = set()
        for i in range(1, len(splits)):
            # If "chapters" are detected less than 12 lines apart, it's likely a TOC
            if splits[i] - splits[i-1] < 12:
                bad_splits.add(i)
                bad_splits.add(i-1)

        valid_splits = [s for i, s in enumerate(splits) if i not in bad_splits]
        splits = valid_splits
        # --------------------------------------------------

        if len(splits) < 2:
            # No chapter headings detected — split by word count.
            words = raw_text.split()
            total_words = len(words)
            target_sections = min(60, max(1, total_words // 500))
            chunk_size = max(500, math.ceil(total_words / target_sections))
            chapters = []
            for idx in range(0, total_words, chunk_size):
                chunk = " ".join(words[idx: idx + chunk_size])
                if len(chunk) >= MIN_CHAPTER_CHARS:
                    chapters.append({"title": f"Section {len(chapters) + 1}", "body": chunk})
            return chapters

        chapters: list[dict] = []

        # --- FIX 3: CAPTURE TOC & INTRO ---
        # Grabs all text BEFORE the first matched "Chapter 1"
        if splits and splits[0] > 0:
            intro_text = "\n".join(lines[0:splits[0]]).strip()
            if len(intro_text) > 15:
                chapters.append({
                    "title": "Front Matter & Introduction",
                    "body": intro_text
                })
        # ------------------------------------

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
    except Exception as e:
        print(f"  ⚠️  Error in parse_chapters: {e}\n{traceback.format_exc()}")
        raise


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
    sample = (
        sample_text[:6_000]
        if len(sample_text) <= 6_000
        else sample_text[:5_000] + "\n…\n" + sample_text[-1_000:]
    )
    system_prompt = _build_system_prompt(
        BOOK_TYPE_PROFILES.get(book_type.lower().strip()) if book_type else None
    )

    user_msg = (
        f"Book title: {book_title}\n"
        f"Page size: {page_width_mm:.0f} × {page_height_mm:.0f} mm\n"
    )
    if book_type:
        user_msg += f"Book type: {book_type}\n"
    # BUG FIX: renamed local variable from `pd` to `_pd` to avoid shadowing
    _pd = profile_defaults or {}
    if _pd:
        subset = {k: v for k, v in _pd.items() if not k.startswith("_")}
        user_msg += f"Suggested defaults for this book type: {json.dumps(subset)}\n"
    if design_instructions:
        user_msg += f"Design instructions: {design_instructions}\n"
    user_msg += f"\nSample text (first 3,000 chars):\n{sample}"

    try:
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
            raise ValueError(f"Layout AI returned invalid JSON: {exc}. Raw snippet: {raw[s:s+200]}\n{traceback.format_exc()}") from exc
    except Exception as e:
        print(f"  ⚠️  Error in generate_layout_concept API Call: {e}\n{traceback.format_exc()}")
        raise

    # ── Normalise & clamp ─────────────────────────────────────────────────────
    concept.setdefault("style_name",            "Custom Layout")
    concept.setdefault("page_bg",               _pd.get("page_bg", "#ffffff"))
    concept.setdefault("text_color",            _pd.get("text_color", "#1a1a1a"))
    concept.setdefault("chapter_title_color",   _pd.get("chapter_title_color", "#111111"))
    concept.setdefault("accent_color",          _pd.get("accent_color", "#555555"))
    concept.setdefault("body_font",             _pd.get("body_font", "Times-Roman"))
    concept.setdefault("chapter_font",          _pd.get("chapter_font", "Times-Roman"))
    concept.setdefault("chapter_prefix",        _pd.get("chapter_prefix", "Chapter"))
    concept.setdefault("show_drop_cap",         _pd.get("show_drop_cap", True))
    concept.setdefault("ornament",              _pd.get("ornament", "—◆—"))
    concept.setdefault("header_text",           book_title)
    concept.setdefault("show_page_numbers",     _pd.get("show_page_numbers", True))

    concept["body_font_size"]        = max(7,  min(20,  float(concept.get("body_font_size",  _pd.get("body_font_size",  11)))))
    concept["line_spacing"]          = max(1.0, min(3.0, float(concept.get("line_spacing",   _pd.get("line_spacing",   1.5)))))
    concept["first_para_indent_mm"]  = max(0,  min(20,  float(concept.get("first_para_indent_mm", _pd.get("first_para_indent_mm", 5)))))
    concept["chapter_font_size"]     = max(10, min(72,  float(concept.get("chapter_font_size", _pd.get("chapter_font_size", 22)))))
    for key, default in [
        ("margin_top_mm",    _pd.get("margin_top_mm",    20)),
        ("margin_bottom_mm", _pd.get("margin_bottom_mm", 20)),
        ("margin_left_mm",   _pd.get("margin_left_mm",   22)),
        ("margin_right_mm",  _pd.get("margin_right_mm",  22)),
    ]:
        concept[key] = max(5, min(100, float(concept.get(key, default))))

    _ALLOWED_FONTS = {"Helvetica", "Times-Roman", "Courier", "Helvetica-Oblique", "Times-Italic"}
    if concept["body_font"] not in _ALLOWED_FONTS:
        concept["body_font"] = _pd.get("body_font", "Times-Roman")
    if concept["chapter_font"] not in _ALLOWED_FONTS:
        concept["chapter_font"] = _pd.get("chapter_font", "Times-Roman")

    return concept


# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — PDF typesetting with ReportLab
# BUG FIX: Unicode font substitution + safe Unicode drop-cap
# ─────────────────────────────────────────────────────────────────────────────

def render_layout_pdf(
    chapters: list[dict],
    concept: dict,
    output_path: str,
    page_width_mm: float,
    page_height_mm: float,
    book_title: str,
) -> str:
    _ensure_unicode_fonts()

    try:
        from reportlab.lib.units import mm                                       # pyrefly: ignore [missing-import]
        from reportlab.lib.colors import Color                                   # pyrefly: ignore [missing-import]
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak  # pyrefly: ignore [missing-import]
        from reportlab.lib.styles import ParagraphStyle                          # pyrefly: ignore [missing-import]
        from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY          # pyrefly: ignore [missing-import]
    except ImportError as e:
        print(f"  ⚠️  ReportLab import failed: {e}\n{traceback.format_exc()}")
        raise

    try:
        # ── Detect if the document contains non-Latin (e.g. Devanagari) text ─────
        all_text = book_title + " ".join(
            c.get("title", "") + " " + c.get("body", "") for c in chapters
        )
        has_unicode = _has_non_latin(all_text)

        # ── Resolve actual font names (Unicode-capable if needed) ─────────────────
        raw_body_font    = concept["body_font"]
        raw_chapter_font = concept["chapter_font"]
        body_font    = _unicode_body_font(raw_body_font, has_unicode)
        chapter_font = _unicode_body_font(raw_chapter_font, has_unicode)

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

        body_size      = concept["body_font_size"]
        leading        = body_size * concept["line_spacing"]
        indent_pt      = concept["first_para_indent_mm"] * mm
        chapter_size   = concept["chapter_font_size"]
        # BUG FIX: only show drop cap for Latin scripts — Devanagari drop caps
        # require a Unicode-aware font that also supports large-size Devanagari,
        # and ReportLab's inline <font> tag does not re-shape multi-byte glyphs
        # correctly. Safe to disable for non-Latin.
        show_drop      = concept["show_drop_cap"] and not has_unicode
        # BUG FIX: strip ornaments that may not render in the chosen font family
        ornament       = concept.get("ornament", "")
        if has_unicode and ornament:
            # Keep only safe ASCII ornaments; strip complex Unicode symbols
            safe_ornament = "".join(c for c in ornament if ord(c) < 0x0300 or c in "—–•·")
            ornament = safe_ornament or ""
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
            # Paragraph breathing room: half a line-height between paragraphs,
            # and a small spaceBefore so paragraph boundaries are always visible.
            spaceAfter=leading * 0.45,
            spaceBefore=leading * 0.15,
            # wordWrap: Devanagari uses LTR word-based wrapping (NOT CJK — CJK breaks
            # Devanagari conjunct ligatures). Use default LTR for all Indic scripts.
            wordWrap="LTR",
        )
        orn_style = ParagraphStyle(
            "Ornament",
            fontName=body_font, fontSize=body_size + 2,
            leading=(body_size + 2) * 1.5,
            textColor=Color(ac_r, ac_g, ac_b),
            alignment=TA_CENTER, spaceBefore=10, spaceAfter=10,
        )

        # ── Dual-font run builder for mixed Devanagari + Latin text ─────────────
        # When a paragraph contains both Hindi (Devanagari, U+0900–U+097F) and
        # English/Latin characters (or digits/punctuation), we need to tag the
        # Latin portions with a Latin-capable font so they render correctly.
        # Noto Devanagari fonts do include Latin glyphs, but their metrics and
        # hinting are optimised for Devanagari; using a proper Latin font (e.g.
        # Times-Roman) for the Latin runs gives much crisper output.
        #
        # Strategy: split the escaped text into runs of "Devanagari" vs "Latin",
        # wrap each Latin run in a <font name="..."> tag.
        #
        # We only apply this when has_unicode is True (the document has Devanagari)
        # AND a proper Latin fallback font is available.

        _LATIN_FALLBACK: dict[str, str] = {
            "NotoSerifDevanagari":      "Times-Roman",
            "NotoSerifDevanagari-Bold": "Times-Roman",
            "NotoSansDevanagari":       "Helvetica",
            "NotoSansDevanagari-Bold":  "Helvetica",
        }

        def _mixed_font_html(safe_escaped_text: str, deva_font: str) -> str:
            """
            Given HTML-escaped paragraph text and the Devanagari font name,
            return ReportLab XML markup with dual-font tags for Latin runs.

            Only called when has_unicode is True.  If no Latin fallback is
            registered, returns the text unchanged.
            """
            latin_font = _LATIN_FALLBACK.get(deva_font)
            if not latin_font:
                return safe_escaped_text

            # We work on the *unescaped* text to correctly classify codepoints,
            # then re-escape each segment individually.
            # NOTE: safe_escaped_text may contain <br/> tags — preserve them.
            # Split on <br/> first, process each fragment, then rejoin.
            fragments = re.split(r"(<br\s*/>)", safe_escaped_text)
            result_parts: list[str] = []

            for frag in fragments:
                if re.fullmatch(r"<br\s*/>", frag):
                    result_parts.append(frag)
                    continue
                if not frag:
                    continue

                # Un-escape HTML entities in this fragment so we can inspect codepoints
                frag_plain = (
                    frag.replace("&amp;", "&")
                        .replace("&lt;",  "<")
                        .replace("&gt;",  ">")
                        .replace("&quot;", '"')
                        .replace("&#39;",  "'")
                )

                def _is_latin_char(ch: str) -> bool:
                    """
                    Returns True for characters that benefit from a Latin font:
                    Basic Latin, Latin-1 Supplement, common punctuation,
                    digits, and ASCII symbols.  Devanagari and whitespace → False.
                    """
                    cp = ord(ch)
                    if ch.isspace():
                        return False   # spaces get the surrounding font context
                    if 0x0900 <= cp <= 0x097F:
                        return False   # Devanagari block → Devanagari font
                    if 0x0020 <= cp <= 0x024F:
                        return True    # Basic Latin + Latin Extended A/B
                    if 0x2000 <= cp <= 0x206F:
                        return True    # General Punctuation (—, ", ", …)
                    if 0x0030 <= cp <= 0x0039:
                        return True    # ASCII digits (redundant but explicit)
                    return False

                # Build runs: (is_latin, text_chunk)
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

                # Build the HTML for this fragment
                frag_html = ""
                for is_latin, chunk in runs:
                    # Re-escape the chunk
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

        # ── Story (flowable elements list) ────────────────────────────────────
        # This MUST be initialised here — after all styles and helpers are
        # defined, before any story.append() calls.
        story: list = []

        title_style = ParagraphStyle(
            "TitlePage",
            fontName=chapter_font,
            fontSize=min(36, chapter_size * 1.6),
            leading=min(36, chapter_size * 1.6) * 1.2,
            textColor=Color(ch_r, ch_g, ch_b),
            alignment=TA_CENTER, spaceAfter=20,
            # Devanagari/Indic scripts use LTR word-based wrapping just like Latin.
            # "CJK" mode breaks individual codepoints (wrong for Devanagari conjuncts).
            wordWrap="LTR",
        )
        story.append(Spacer(1, PH * 0.28))
        # BUG FIX: escape HTML entities in the title too
        safe_title = book_title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        story.append(Paragraph(safe_title, title_style))
        if ornament:
            story.append(Spacer(1, 14))
            safe_orn = ornament.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            story.append(Paragraph(safe_orn, orn_style))
        story.append(PageBreak())

        # ── Chapters ──────────────────────────────────────────────────────────────
        # BUG 4 FIX: use a dedicated counter so "Front Matter" chapters injected
        # by parse_chapters don't shift all real chapter numbers up by 1.
        real_chapter_num = 0
        for chapter in chapters:
            
            # FIX: Prevent Double Chapter Headings & Exclude Intro
            ch_title_lower = chapter["title"].lower()
            already_has_chapter = ch_title_lower.startswith("chapter") or ch_title_lower.startswith("part")
            is_intro = "introduction" in ch_title_lower or "front matter" in ch_title_lower

            if not is_intro:
                real_chapter_num += 1

            if chapter_prefix and not already_has_chapter and not is_intro:
                safe_prefix = chapter_prefix.replace("&", "&amp;")
                story.append(Paragraph(f"{safe_prefix.upper()} {real_chapter_num}".strip(), prefix_style))
                
            safe_ch_title = chapter["title"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            story.append(Paragraph(safe_ch_title, ch_style))
            story.append(Spacer(1, 4))
            
            if ornament:
                safe_orn = ornament.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                story.append(Paragraph(safe_orn, orn_style))
                story.append(Spacer(1, 6))

            raw_body = chapter.get("body", "").strip()
            paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_body) if p.strip()]
            if not paragraphs:
                paragraphs = ["[No content]"]

            for p_idx, para_text in enumerate(paragraphs):
                # FIX: Smart Line Break & Bullet Handling
                lines = para_text.split('\n')
                cleaned_lines = []
                for line in lines:
                    line = line.strip()
                    if not line: continue
                    # If it's a bullet point, force a hard break
                    if line.startswith(('•', '-', '*')) or re.match(r'^\d+\.', line):
                        cleaned_lines.append('<br/>' + line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
                    else:
                        # Otherwise, join physical PDF lines with a space
                        safe_line = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                        if cleaned_lines and not cleaned_lines[-1].startswith('<br/>'):
                            cleaned_lines[-1] += " " + safe_line
                        else:
                            cleaned_lines.append(safe_line)
                
                safe = "".join(cleaned_lines)

                # Apply dual-font markup for mixed Hindi + Latin text
                if has_unicode:
                    safe = _mixed_font_html(safe, body_font)

                # Drop cap logic
                # BUG 6 FIX: build rest_orig by slicing `safe` after the
                # escaped first character, not by re-escaping first_char and
                # using its *escaped* length (which is wrong for &, <, >).
                if p_idx == 0 and show_drop and not is_intro and len(para_text) > 1:
                    first_char = para_text[0]   # original codepoint
                    # Only do drop cap if first char is a basic Latin letter
                    if first_char.isalpha() and ord(first_char) < 0x0250:
                        first_esc = first_char.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                        # `safe` starts with first_esc — slice past it correctly
                        rest_orig = safe[len(first_esc):]
                        drop_html = (
                            f'<font name="{chapter_font}" size="{int(body_size * 2.8)}">'
                            f"{first_esc}</font>{rest_orig}"
                        )
                        story.append(Paragraph(drop_html, body_style))
                    else:
                        story.append(Paragraph(safe, body_style))
                else:
                    story.append(Paragraph(safe, body_style))

            story.append(PageBreak())

        doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
        return output_path
    except Exception as e:
        print(f"  ⚠️  render_layout_pdf failed completely: {e}\n{traceback.format_exc()}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Step 5 — DOCX typesetting
# BUG FIX: correct italic flag for Times-Italic / Helvetica-Oblique
# ─────────────────────────────────────────────────────────────────────────────

def render_layout_docx(
    chapters: list[dict],
    concept: dict,
    output_path: str,
    page_width_mm: float,
    page_height_mm: float,
    book_title: str,
) -> str:
    try:
        from docx import Document                                   # pyrefly: ignore [missing-import]
        from docx.shared import Pt, Cm, RGBColor                   # pyrefly: ignore [missing-import]
        from docx.enum.text import WD_ALIGN_PARAGRAPH              # pyrefly: ignore [missing-import]
        from docx.oxml.ns import qn                                # pyrefly: ignore [missing-import]
        from docx.oxml import OxmlElement                          # pyrefly: ignore [missing-import]

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

        # Detect whether this book has mixed Hindi + Latin content
        all_text_docx = book_title + " ".join(
            c.get("title", "") + " " + c.get("body", "") for c in chapters
        )
        has_unicode_docx = _has_non_latin(all_text_docx)

        # Map ReportLab font names → (Word font name, is_italic)
        _FONT_MAP = {
            "Times-Roman":       ("Times New Roman", False),
            "Times-Italic":      ("Times New Roman", True),
            "Helvetica":         ("Arial",            False),
            "Helvetica-Oblique": ("Arial",            True),
            "Courier":           ("Courier New",      False),
        }
        # Latin fallback fonts for body / chapter when document has Devanagari
        _DOCX_LATIN_FALLBACK: dict[str, str] = {
            "NotoSerifDevanagari":      "Times New Roman",
            "NotoSerifDevanagari-Bold": "Times New Roman",
            "NotoSansDevanagari":       "Arial",
            "NotoSansDevanagari-Bold":  "Arial",
        }

        def docx_font(rl_name: str) -> tuple[str, bool]:
            """Return (word_font_name, is_italic)."""
            return _FONT_MAP.get(rl_name, ("Times New Roman", False))

        body_fn, body_italic = docx_font(concept["body_font"])
        ch_fn,   ch_italic   = docx_font(concept["chapter_font"])

        def rgb(hex_str: str) -> RGBColor:
            return _hex_to_docx_rgb(hex_str)

        def _set_run_font(run, font_name: str, size_pt: float, bold: bool,
                          italic: bool, color_hex: str) -> None:
            """Apply font attributes to a single run."""
            run.font.name   = font_name
            run.font.size   = Pt(size_pt)
            run.font.bold   = bold
            run.font.italic = italic
            run.font.color.rgb = rgb(color_hex)
            # Also set the East-Asian / Complex-script font element so Word
            # uses the Devanagari font for Devanagari codepoints, rather than
            # falling through to the theme Latin font.
            from docx.oxml.ns import qn as _qn  # pyrefly: ignore [missing-import]
            rPr = run._r.get_or_add_rPr()
            for tag in ("w:rFonts",):
                existing = rPr.find(_qn(tag))
                if existing is None:
                    from docx.oxml import OxmlElement as _OxmlElement  # pyrefly: ignore [missing-import]
                    existing = _OxmlElement(tag)
                    rPr.insert(0, existing)
                existing.set(_qn("w:ascii"),       font_name)
                existing.set(_qn("w:hAnsi"),       font_name)
                existing.set(_qn("w:cs"),          font_name)   # complex-script
                existing.set(_qn("w:eastAsia"),    font_name)

        def add_para(text: str, font_name: str, size: float, bold: bool = False,
                     italic: bool = False, color: str = "#1a1a1a",
                     align=WD_ALIGN_PARAGRAPH.LEFT,
                     space_before: float = 0, space_after: float = 0,
                     line_space: float = 1.5) -> None:
            """
            Add a paragraph with proper dual-font support for mixed Hindi + English.

            When the document contains Devanagari text (has_unicode_docx is True),
            the paragraph is split into runs so that Latin characters (digits,
            English words, punctuation) use the appropriate Latin-script font
            instead of the Devanagari font — giving correct glyph metrics for both
            scripts within the same paragraph.
            """
            p  = doc.add_paragraph()
            p.alignment = align
            pf = p.paragraph_format
            pf.space_before = Pt(space_before)
            pf.space_after  = Pt(space_after)
            pf.line_spacing = Pt(size * line_space)

            if not has_unicode_docx or not text.strip():
                # Simple single-run path (no Devanagari in this document)
                run = p.add_run(text)
                _set_run_font(run, font_name, size, bold, italic, color)
                return

            # Dual-run path: split text into Devanagari and Latin segments
            latin_fallback = _DOCX_LATIN_FALLBACK.get(font_name, font_name)

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

            # Build character-level runs: (is_latin, chunk)
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
                chosen_font = latin_fallback if (is_latin and chunk.strip()) else font_name
                run = p.add_run(chunk)
                _set_run_font(run, chosen_font, size, bold, italic, color)

        def add_rule(color_hex: str) -> None:
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
        add_para(book_title, ch_fn, min(36, ch_size * 1.5), bold=True,
                 italic=ch_italic,
                 color=concept["chapter_title_color"], align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
        if ornament:
            add_para(ornament, body_fn, body_size + 2, color=concept["accent_color"],
                     align=WD_ALIGN_PARAGRAPH.CENTER, space_before=6, space_after=6)
        doc.add_page_break()

        # Chapters
        # BUG 5 FIX: dedicated counter so Front Matter doesn't shift numbering
        real_chapter_num = 0
        for chapter in chapters:
            
            # --- FIX: Prevent Double Headings in DOCX ---
            ch_title_lower = chapter["title"].lower()
            already_has_chapter = ch_title_lower.startswith("chapter") or ch_title_lower.startswith("part")
            is_intro = "introduction" in ch_title_lower or "front matter" in ch_title_lower

            if not is_intro:
                real_chapter_num += 1

            if prefix and not already_has_chapter and not is_intro:
                add_para(f"{prefix.upper()} {real_chapter_num}".strip(), body_fn, body_size * 0.82,
                         color=concept["accent_color"], space_before=6, space_after=2)
                         
            add_para(chapter["title"], ch_fn, ch_size, bold=True,
                     italic=ch_italic,
                     color=concept["chapter_title_color"], space_after=8)
            add_rule(concept["accent_color"])
            if ornament:
                add_para(ornament, body_fn, body_size + 1, color=concept["accent_color"],
                         align=WD_ALIGN_PARAGRAPH.CENTER, space_before=4, space_after=8)

            raw_body = chapter.get("body", "").strip()
            paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_body) if p.strip()]
            if not paragraphs:
                paragraphs = ["[No content]"]
            
            for para_text in paragraphs:
                # --- FIX: Smart Line Break & Bullet Handling in DOCX ---
                lines = para_text.split('\n')
                cleaned_lines = []
                for line in lines:
                    line = line.strip()
                    if not line: continue
                    # If it's a bullet point, force a hard break
                    if line.startswith(('•', '-', '*')) or re.match(r'^\d+\.', line):
                        cleaned_lines.append(line)
                    else:
                        # Otherwise, join physical PDF lines with a space
                        if cleaned_lines:
                            cleaned_lines[-1] += " " + line
                        else:
                            cleaned_lines.append(line)
                            
                for sub_line in cleaned_lines:
                    align = WD_ALIGN_PARAGRAPH.LEFT if sub_line.startswith(('•', '-', '*')) else WD_ALIGN_PARAGRAPH.JUSTIFY
                    add_para(sub_line, body_fn, body_size, italic=body_italic,
                             color=concept["text_color"],
                             align=align,
                             # Proper paragraph breathing room: ~45% of line height
                             space_after=round(body_size * ls * 0.45, 1),
                             space_before=round(body_size * ls * 0.10, 1),
                             line_space=ls)
                # -------------------------------------------------------

            doc.add_page_break()

        doc.save(output_path)
        return output_path
    except Exception as e:
        print(f"  ⚠️  render_layout_docx failed: {e}\n{traceback.format_exc()}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Main orchestrator
# ─────────────────────────────────────────────────────────────────────────────

def design_layout(
    file_path: str,
    filename: str,
    output_dir: str,
    page_width_mm: float = 210.0,   # BUG 7 FIX: default A4 to match FastAPI endpoint
    page_height_mm: float = 297.0,  # BUG 7 FIX: default A4 to match FastAPI endpoint
    book_title: str = "",
    design_instructions: str = "",
    book_type: Optional[str] = None,
    visual_template: Optional[str] = None,
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
      2. Detect chapters (supports Hindi/Devanagari)
      3. Look up book-type profile (smart genre defaults)
      4. Build override hints (user values + profile)
      5. Ask GPT-4o for a layout concept (seeded with profile)
      6. Apply hard user overrides (user always wins)
      7. Render PDF (ReportLab + Unicode fonts)
      8. Render DOCX (python-docx)
    """

    def progress(stage: str, pct: int, message: str) -> None:
        if progress_callback:
            progress_callback(stage, pct, message)

    try:
        os.makedirs(output_dir, exist_ok=True)
        ext = os.path.splitext(filename)[1].lower()

        # --- CRITICAL FIX 1: REMOVED THE PDF NATIVE SIZE INHERITANCE ---
        # The backend now completely ignores the original PDF's dimensions.
        # It strictly uses the page_width_mm and page_height_mm sent by the frontend
        # (or defaults to 127.0 x 203.2 mm / 5x8 if none are sent).

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
    except Exception as e:
        print(f"  🚨 CRITICAL ERROR in design_layout: {e}\n{traceback.format_exc()}")
        if progress_callback:
            progress_callback("error", -1, f"Failed: {e}")
        raise