"""
pdf_generator.py — Multilingual PDF output using ReportLab + Google Noto fonts.

Font strategy
─────────────
ReportLab's built-in Type1 fonts (Helvetica, Times, etc.) cover Latin/Western
European only.  For every other script we register a TrueType/OpenType font.

We use Google Noto fonts because:
  • They cover virtually every Unicode script.
  • They are free / open-source.
  • A single "NotoSans" TTF covers Latin + many scripts; dedicated supplement
    fonts cover Arabic, CJK, Devanagari, Hebrew, Thai, etc.

Font files are downloaded once at startup into a local cache directory
(~/.cache/noto_fonts) so repeated runs are instant.

ENTERPRISE UPGRADE:
- Interactive Clickable TOCs: Injects native PDF Sidebar Bookmarks and clickable
  hyperlinks within the Table of Contents.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    HRFlowable, Flowable
)
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
import datetime, os, sys, unicodedata, urllib.request, pathlib

# ── Colour palette ─────────────────────────────────────────────────────────────
DARK   = HexColor("#1E293B")
ACCENT = HexColor("#4F46E5")
GRAY   = HexColor("#64748B")

# ── Noto font registry ────────────────────────────────────────────────────────
# Maps script name → (font_alias, download_url)
# We download the Regular weight only; bold is synthesised by ReportLab.
NOTO_FONTS = {
    # Generic / Latin fallback
    "NotoSans": (
        "NotoSans",
        "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf",
    ),
    # Arabic (covers Arabic, Urdu, Persian, etc.)
    "NotoSansArabic": (
        "NotoSansArabic",
        "https://github.com/google/fonts/raw/main/ofl/notosansarabic/NotoSansArabic%5Bwdth%2Cwght%5D.ttf",
    ),
    # Hebrew
    "NotoSansHebrew": (
        "NotoSansHebrew",
        "https://github.com/google/fonts/raw/main/ofl/notosanshebrew/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf",
    ),
    # Devanagari (Hindi, Marathi, Sanskrit, Nepali)
    "NotoSansDevanagari": (
        "NotoSansDevanagari",
        "https://github.com/google/fonts/raw/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf",
    ),
    # Bengali
    "NotoSansBengali": (
        "NotoSansBengali",
        "https://github.com/google/fonts/raw/main/ofl/notosansbengali/NotoSansBengali%5Bwdth%2Cwght%5D.ttf",
    ),
    # Tamil
    "NotoSansTamil": (
        "NotoSansTamil",
        "https://github.com/google/fonts/raw/main/ofl/notosanstamil/NotoSansTamil%5Bwdth%2Cwght%5D.ttf",
    ),
    # Telugu
    "NotoSansTelugu": (
        "NotoSansTelugu",
        "https://github.com/google/fonts/raw/main/ofl/notosanstelugu/NotoSansTelugu%5Bwdth%2Cwght%5D.ttf",
    ),
    # Kannada
    "NotoSansKannada": (
        "NotoSansKannada",
        "https://github.com/google/fonts/raw/main/ofl/notosanskannada/NotoSansKannada%5Bwdth%2Cwght%5D.ttf",
    ),
    # Malayalam
    "NotoSansMalayalam": (
        "NotoSansMalayalam",
        "https://github.com/google/fonts/raw/main/ofl/notosansmalayalam/NotoSansMalayalam%5Bwdth%2Cwght%5D.ttf",
    ),
    # Thai
    "NotoSansThai": (
        "NotoSansThai",
        "https://github.com/google/fonts/raw/main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf",
    ),
    # CJK (Chinese / Japanese / Korean) — use SC (Simplified Chinese) as base;
    # it renders Traditional Chinese, Japanese, and Korean glyphs too.
    "NotoSansSC": (
        "NotoSansSC",
        "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
    ),
    # Cyrillic is included in the base NotoSans above.
}

_LOCAL_FONTS_DIR = pathlib.Path(__file__).parent / "fonts"
_LOCAL_FONTS_DIR.mkdir(parents=True, exist_ok=True)
# Use local committed fonts/ dir as primary cache (avoids GitHub downloads on Railway).
# Falls back to home cache only if local dir is somehow unavailable.
FONT_CACHE = _LOCAL_FONTS_DIR

_registered: set[str] = set()


def _ensure_font(key: str) -> str | None:
    """Download (if needed) and register a Noto font. Returns alias or None."""
    alias, url = NOTO_FONTS[key]
    if alias in _registered:
        return alias
    dest = FONT_CACHE / f"{key}.ttf"
    if not dest.exists():
        print(f"  📥 Downloading font {key} …", end=" ", flush=True)
        try:
            urllib.request.urlretrieve(url, dest)
            print("done")
        except Exception as ex:
            print(f"FAILED ({ex})")
            return None
    try:
        pdfmetrics.registerFont(TTFont(alias, str(dest)))
        _registered.add(alias)
        return alias
    except Exception as ex:
        print(f"  ⚠️  Could not register {key}: {ex}")
        return None


# Script → font key mapping
_SCRIPT_FONT_MAP = {
    "Arabic":     "NotoSansArabic",
    "Hebrew":     "NotoSansHebrew",
    "Devanagari": "NotoSansDevanagari",
    "Bengali":    "NotoSansBengali",
    "Tamil":      "NotoSansTamil",
    "Telugu":     "NotoSansTelugu",
    "Kannada":    "NotoSansKannada",
    "Malayalam":  "NotoSansMalayalam",
    "Thai":       "NotoSansThai",
    "CJK":        "NotoSansSC",
    "Hiragana":   "NotoSansSC",
    "Katakana":   "NotoSansSC",
    "Hangul":     "NotoSansSC",
}

_RTL_SCRIPTS = {"Arabic", "Hebrew"}


def detect_script(text: str) -> str:
    """Return the dominant script name for a text string."""
    ranges = {
        "Arabic":     (0x0600, 0x06FF),
        "Hebrew":     (0x0590, 0x05FF),
        "Devanagari": (0x0900, 0x097F),
        "Bengali":    (0x0980, 0x09FF),
        "Tamil":      (0x0B80, 0x0BFF),
        "Telugu":     (0x0C00, 0x0C7F),
        "Kannada":    (0x0C80, 0x0CFF),
        "Malayalam":  (0x0D00, 0x0D7F),
        "Thai":       (0x0E00, 0x0E7F),
        "Hiragana":   (0x3040, 0x309F),
        "Katakana":   (0x30A0, 0x30FF),
        "CJK":        (0x4E00, 0x9FFF),
        "Hangul":     (0xAC00, 0xD7AF),
        "Cyrillic":   (0x0400, 0x04FF),
        "Greek":      (0x0370, 0x03FF),
    }
    counts = {k: 0 for k in ranges}
    for ch in text:
        cp = ord(ch)
        for name, (lo, hi) in ranges.items():
            if lo <= cp <= hi:
                counts[name] += 1
                break
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else "Latin"


def get_font_for_text(text: str) -> str:
    """Return a registered ReportLab font alias suitable for rendering text."""
    script = detect_script(text)
    font_key = _SCRIPT_FONT_MAP.get(script, "NotoSans")
    alias = _ensure_font(font_key)
    if alias:
        return alias
    # Fallback to base NotoSans (covers Cyrillic, Greek, Latin, and more)
    return _ensure_font("NotoSans") or "Helvetica"


def is_rtl(text: str) -> bool:
    return detect_script(text) in _RTL_SCRIPTS


def _align_for(text: str):
    return TA_RIGHT if is_rtl(text) else TA_JUSTIFY


# ── Initialise base NotoSans at import time ────────────────────────────────────
_ensure_font("NotoSans")

# ── Page geometry ─────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4
MARGIN = 22 * mm

# ── Outline / Sidebar Bookmark Class ──────────────────────────────────────────
class OutlineBookmark(Flowable):
    """Injects a PDF bookmark into the native viewer sidebar and allows internal linking."""
    def __init__(self, title, level, key):
        self.title = title
        self.level = level
        self.key = key
        Flowable.__init__(self)

    def draw(self):
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.title, self.key, self.level, 0)


# ── Footer callback ────────────────────────────────────────────────────────────
def on_later_page(canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(DARK)
    canvas.rect(0, 0, w, 10 * mm, fill=1, stroke=0)
    canvas.setFillColor(white)
    fnt = get_font_for_text(doc.title)
    canvas.setFont(fnt, 8)
    canvas.drawString(MARGIN, 3.5 * mm, doc.title)
    canvas.drawRightString(w - MARGIN, 3.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def on_first_page(canvas, doc):
    pass  # cover handles itself


# ── Main generator ─────────────────────────────────────────────────────────────

def generate_pdf(book_title: str, segments, output_dir: str = "output") -> str:
    os.makedirs(output_dir, exist_ok=True)
    safe_title = "".join(
        c for c in book_title if c.isalnum() or c in (" ", "-", "_")
    ).strip()
    filepath = os.path.join(output_dir, f"{safe_title}.pdf")

    # Pre-register fonts needed by this book
    title_font = get_font_for_text(book_title)
    rtl        = is_rtl(book_title)
    align_body = TA_RIGHT if rtl else TA_JUSTIFY
    align_ctr  = TA_RIGHT if rtl else TA_CENTER  # cover still centred

    def S(name, **kw):
        return ParagraphStyle(name, **kw)

    cover_title = S("ct",  fontName=title_font, fontSize=32, textColor=white,
                    leading=42, alignment=TA_CENTER, spaceAfter=8)
    cover_sub   = S("cs",  fontName=title_font, fontSize=13, textColor=HexColor("#CBD5E1"),
                    leading=18, alignment=TA_CENTER)
    toc_item    = S("ti",  fontName=title_font, fontSize=10, textColor=DARK,
                    leading=16, leftIndent=0, spaceAfter=3, alignment=align_body)
    toc_sub     = S("tsi", fontName=title_font, fontSize=9,  textColor=GRAY,
                    leading=14, leftIndent=14, spaceAfter=2, alignment=align_body)
    ch_label    = S("cl",  fontName=title_font, fontSize=11, textColor=ACCENT,
                    leading=16, spaceBefore=0, spaceAfter=4, alignment=align_body)
    ch_title_st = S("cht", fontName=title_font, fontSize=22, textColor=DARK,
                    leading=30, spaceBefore=4, spaceAfter=6, alignment=align_body)
    sub_style   = S("ss",  fontName=title_font, fontSize=13, textColor=DARK,
                    leading=18, spaceBefore=14, spaceAfter=5,
                    fontWeight="Bold" if hasattr(ParagraphStyle, "fontWeight") else None,
                    alignment=align_body)
    body_style  = S("bs",  fontName=title_font, fontSize=10.5, textColor=HexColor("#334155"),
                    leading=17, spaceAfter=8, alignment=align_body)

    doc = SimpleDocTemplate(
        filepath,
        pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN,  bottomMargin=18 * mm,
        title=book_title,
    )
    doc.title = book_title
    story = []

    # ── Cover page ─────────────────────────────────────────────────────────────
    def cover_page(canvas, doc):
        w, h = A4
        canvas.setFillColor(DARK)
        canvas.rect(0, 0, w, h, fill=1, stroke=0)
        canvas.setFillColor(ACCENT)
        canvas.rect(0, h * 0.38, w, 4, fill=1, stroke=0)
        canvas.rect(0, h * 0.38 - 10, w, 2, fill=1, stroke=0)
        canvas.setFillColor(HexColor("#0F172A"))
        canvas.rect(0, 0, w, 20 * mm, fill=1, stroke=0)
        canvas.setFillColor(HexColor("#475569"))
        canvas.setFont(title_font, 9)
        canvas.drawCentredString(
            w / 2, 8 * mm,
            f"Generated by AI Book Agent  ·  {datetime.date.today()}"
        )

    story.append(Spacer(1, 55 * mm))
    story.append(Paragraph(book_title, cover_title))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        f"Generated on {datetime.date.today().strftime('%B %d, %Y')}", cover_sub))
    story.append(PageBreak())

    # ── Table of contents ──────────────────────────────────────────────────────
    toc_head_st = S("toch", fontName=title_font, fontSize=20, textColor=DARK,
                    leading=26, spaceAfter=8, alignment=align_body)
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Table of Contents", toc_head_st))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT, spaceAfter=8))

    chapters: dict = {}
    for seg in segments:
        key = seg.chapter_number
        if key not in chapters:
            chapters[key] = {"title": seg.chapter_title, "subs": []}
        chapters[key]["subs"].append(seg.subheading)

    for ch_num in sorted(chapters.keys()):
        ch = chapters[ch_num]
        # Use per-text font in case chapter titles differ in script
        ch_fnt = get_font_for_text(ch["title"])
        row_st = S(f"ti_{ch_num}", fontName=ch_fnt, fontSize=10, textColor=DARK,
                   leading=16, spaceAfter=3, alignment=align_body)
                   
        # --- UPGRADE: Clickable TOC Entry ---
        story.append(Paragraph(
            f'<link href="ch_{ch_num}" color="{DARK.hexval()}"><b>Chapter {ch_num}</b>  —  {ch["title"]}</link>', 
            row_st
        ))
        for sub in ch["subs"]:
            sub_fnt = get_font_for_text(sub)
            sub_st  = S(f"tsi_{sub}", fontName=sub_fnt, fontSize=9, textColor=GRAY,
                        leading=14, leftIndent=14, spaceAfter=2, alignment=align_body)
            sub_key = f"sub_{abs(hash(sub))}"
            # --- UPGRADE: Clickable Subheading Entry ---
            story.append(Paragraph(
                f'<link href="{sub_key}" color="{GRAY.hexval()}">• {sub}</link>', 
                sub_st
            ))
        story.append(Spacer(1, 4))

    story.append(PageBreak())

    # ── Chapter content ────────────────────────────────────────────────────────
    current_chapter = None

    for seg in segments:
        seg_fnt = get_font_for_text(seg.chapter_title + " " + seg.subheading)
        seg_align = TA_RIGHT if is_rtl(seg.chapter_title) else TA_JUSTIFY

        if seg.chapter_number != current_chapter:
            if current_chapter is not None:
                story.append(PageBreak())
            current_chapter = seg.chapter_number

            story.append(Spacer(1, 10 * mm))
            
            # --- UPGRADE: Inject Native Sidebar Outline Bookmark for Chapter ---
            story.append(OutlineBookmark(seg.chapter_title, 0, f"ch_{seg.chapter_number}"))
            
            story.append(Paragraph(
                f"Chapter {seg.chapter_number}",
                S(f"cl_{seg.chapter_number}", fontName=seg_fnt, fontSize=11,
                  textColor=ACCENT, leading=16, spaceAfter=4, alignment=seg_align)
            ))
            story.append(Paragraph(
                seg.chapter_title,
                S(f"cht_{seg.chapter_number}", fontName=seg_fnt, fontSize=22,
                  textColor=DARK, leading=30, spaceBefore=4, spaceAfter=6,
                  alignment=seg_align)
            ))
            story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=10))

        sub_key = f"sub_{abs(hash(seg.subheading))}"
        # --- UPGRADE: Inject Native Sidebar Outline Bookmark for Subheading ---
        story.append(OutlineBookmark(seg.subheading, 1, sub_key))

        # Subheading
        story.append(Paragraph(
            seg.subheading,
            S(f"sub_{id(seg)}", fontName=seg_fnt, fontSize=13, textColor=DARK,
              leading=18, spaceBefore=14, spaceAfter=5, alignment=seg_align)
        ))

        # Body — split on newlines, detect font per paragraph
        for para_text in seg.content.split("\n"):
            para_text = para_text.strip()
            if not para_text:
                continue
            p_fnt   = get_font_for_text(para_text)
            p_align = TA_RIGHT if is_rtl(para_text) else TA_JUSTIFY
            story.append(Paragraph(
                para_text,
                S(f"body_{id(para_text)}", fontName=p_fnt, fontSize=10.5,
                  textColor=HexColor("#334155"), leading=17, spaceAfter=8,
                  alignment=p_align)
            ))

    doc.build(story, onFirstPage=cover_page, onLaterPages=on_later_page)
    print(f"  ✅ PDF saved: {filepath}")
    return filepath