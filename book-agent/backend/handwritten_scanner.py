"""
handwritten_scanner.py
AI-powered handwritten book scanner.
- Accepts: image files (jpg/png/webp/heic/bmp), PDF, DOCX, or ZIP of any above
- Uses GPT-4o vision to transcribe each page/image
- Assembles transcription into a clean, structured book
- Exports PDF + DOCX
Supports any language — GPT-4o handles multilingual handwriting.
"""

import os
import io
import json
import uuid
import zipfile
import shutil
import base64
import tempfile
import traceback
from pathlib import Path
from typing import Optional

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
# Image → base64
# ─────────────────────────────────────────────────────────────────────────────

def _image_to_b64(path: str) -> tuple[str, str]:
    """Returns (base64_data, media_type)."""
    ext = Path(path).suffix.lower()
    mime_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".gif": "image/gif",
        # BMP/TIFF are converted to PNG via Pillow below; if Pillow is absent
        # we fall back to raw bytes and must report the correct native MIME.
        ".bmp": "image/bmp",
        ".tiff": "image/tiff", ".tif": "image/tiff",
    }
    media_type = mime_map.get(ext, "image/jpeg")

    # For bmp/tiff — convert to PNG via Pillow if available
    if ext in {".bmp", ".tiff", ".tif"}:
        try:
            # pyrefly: ignore [missing-import]
            from PIL import Image
            buf = io.BytesIO()
            Image.open(path).save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode(), "image/png"
        except ImportError as e:
            print(f"  ⚠️  Pillow import failed for image conversion. Error details: {e}\n{traceback.format_exc()}")
            pass  # fall through to raw read
        except Exception as e:
            print(f"  ⚠️  Unexpected error during image conversion. Error details: {e}\n{traceback.format_exc()}")
            pass

    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode(), media_type


# ─────────────────────────────────────────────────────────────────────────────
# PDF → images (one per page)
# ─────────────────────────────────────────────────────────────────────────────

def _pdf_to_images(pdf_path: str, out_dir: str) -> list[str]:
    """Render each PDF page to a PNG. Returns list of image paths."""
    try:
        # pyrefly: ignore [missing-import]
        import fitz  # PyMuPDF
        doc = fitz.open(pdf_path)
        paths = []
        for i, page in enumerate(doc):
            mat = fitz.Matrix(2.0, 2.0)  # 2× zoom → ~150 DPI
            pix = page.get_pixmap(matrix=mat)
            img_path = os.path.join(out_dir, f"page_{i:04d}.png")
            pix.save(img_path)
            paths.append(img_path)
        return paths
    except ImportError as e:
        print(f"  ⚠️  fitz (PyMuPDF) missing, falling back to pdf2image. Error details: {e}\n{traceback.format_exc()}")
        # fallback: pdf2image
        # pyrefly: ignore [missing-import]
        from pdf2image import convert_from_path
        images = convert_from_path(pdf_path, dpi=150)
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
# DOCX → images (render each page via LibreOffice or extract embedded images)
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

    # If no embedded images, try converting via PDF
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
            pass

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
        # Single image — copy to scratch so we own it
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

                # Also handle PDF/DOCX inside zip
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

            # Preserve insertion order (sorted(set(...)) would randomise uuid-prefixed sub-dir paths)
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
# GPT-4o Vision: transcribe a batch of images
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

def transcribe_images(image_paths: list[str], book_title: str = "") -> list[dict]:
    """
    Transcribe a list of images using GPT-4o vision.
    Returns list of {page_num, text, has_content} dicts.
    """
    results = []
    # Process in batches of 4 images per API call (token efficiency)
    batch_size = 4

    for batch_start in range(0, len(image_paths), batch_size):
        batch = image_paths[batch_start: batch_start + batch_size]

        # Track which slots within the batch encoded successfully vs failed
        successful_indices: list[int] = []
        failed_indices: list[int] = []
        api_content: list[dict] = [{"type": "text", "text": ""}]  # placeholder updated below

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

        # Update the text prompt to reflect actual image count sent
        n_sent = len(successful_indices)
        api_content[0]["text"] = (
            f"Transcribe the handwritten text from the following {n_sent} page image(s). "
            "Separate each page's content with the marker ---PAGE_BREAK--- on its own line."
        )

        # Pre-allocate result slots so ordering stays aligned with image_paths
        batch_results: list[dict] = [{}] * len(batch)
        for slot in failed_indices:
            batch_results[slot] = {
                "page_num": batch_start + slot + 1,
                "text": "[illegible - could not process image]",
                "has_content": False,
            }

        if successful_indices:
            try:
                response = client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": TRANSCRIPTION_SYSTEM},
                        {"role": "user", "content": api_content},
                    ],
                    max_tokens=8192,
                )
                raw = response.choices[0].message.content.strip()
                gpt_pages = raw.split("---PAGE_BREAK---")

                for i, slot in enumerate(successful_indices):
                    page_text = gpt_pages[i].strip() if i < len(gpt_pages) else ""
                    has_content = bool(page_text) and "[PAGE: no text]" not in page_text
                    batch_results[slot] = {
                        "page_num": batch_start + slot + 1,
                        "text": page_text if has_content else "",
                        "has_content": has_content,
                    }
                # GPT returned fewer splits than images sent — fill remaining
                for slot in successful_indices[len(gpt_pages):]:
                    batch_results[slot] = {
                        "page_num": batch_start + slot + 1,
                        "text": "[transcription incomplete for this page]",
                        "has_content": False,
                    }
            except Exception as e:
                print(f"  ⚠️  Transcription batch {batch_start}-{batch_start+batch_size} failed. Error details: {e}\n{traceback.format_exc()}")
                for slot in successful_indices:
                    batch_results[slot] = {
                        "page_num": batch_start + slot + 1,
                        "text": "[transcription failed for this page]",
                        "has_content": False,
                    }

        results.extend(r for r in batch_results if r)

    return results


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

Return ONLY valid JSON:
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
    Processes the full text in chunks so nothing is ever discarded.
    """
    content_pages = [p for p in pages if p["has_content"]]
    if not content_pages:
        return {
            "title": book_title or "Untitled Manuscript",
            "language": "Unknown",
            "chapters": [{"chapter_number": 1, "title": "Content", "content": "[No readable text found in the uploaded pages]"}],
            "total_words": 0,
        }

    # Detect language from a small sample
    sample_text = "\n\n".join(p["text"] for p in content_pages[:5])
    detected_language = "Unknown"
    try:
        lang_resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": f"What language is this text written in? Reply with just the language name.\n\n{sample_text[:500]}"}],
            max_tokens=20,
        )
        detected_language = lang_resp.choices[0].message.content.strip()
    except Exception as e:
        print(f"  ⚠️  Language detection failed. Error details: {e}\n{traceback.format_exc()}")
        pass

    # Build full text — no truncation
    full_text = "\n\n".join(
        f"[Page {p['page_num']}]\n{p['text']}"
        for p in content_pages
    )

    # Process in 50K-char chunks to avoid token limits
    CHUNK_SIZE = 50_000
    text_chunks = []
    if len(full_text) <= CHUNK_SIZE:
        text_chunks = [full_text]
    else:
        # Split at page boundaries
        current_chunk = []
        current_size = 0
        for p in content_pages:
            page_block = f"[Page {p['page_num']}]\n{p['text']}"
            if current_size + len(page_block) > CHUNK_SIZE and current_chunk:
                text_chunks.append("\n\n".join(current_chunk))
                current_chunk = []
                current_size = 0
            current_chunk.append(page_block)
            current_size += len(page_block) + 2
        if current_chunk:
            text_chunks.append("\n\n".join(current_chunk))

    print(f"  📖 Structuring transcription: {len(content_pages)} pages → {len(text_chunks)} chunk(s)")

    all_chapters = []
    chapter_counter = 0

    for chunk_idx, chunk_text in enumerate(text_chunks):
        prompt = (
            f"Book title (if known): {book_title or 'Unknown — infer from content if possible'}\n"
            f"Language: {detected_language}\n"
            + (f"(This is part {chunk_idx + 1} of {len(text_chunks)} — continue chapter numbering from {chapter_counter + 1})\n" if len(text_chunks) > 1 else "")
            + f"\nRaw transcribed pages:\n{chunk_text}"
        )
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": STRUCTURE_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=8000,
            )
            raw = response.choices[0].message.content.strip()
            raw = raw.replace("```json", "").replace("```", "").strip()
            s = raw.find("{"); e = raw.rfind("}") + 1
            if s == -1 or e == 0:
                raise ValueError("No JSON in structure response")
            chunk_result = json.loads(raw[s:e])

            # Collect chapters and fix numbering
            for ch in chunk_result.get("chapters", []):
                chapter_counter += 1
                all_chapters.append({
                    "chapter_number": chapter_counter,
                    "title": ch.get("title", f"Chapter {chapter_counter}"),
                    "content": ch.get("content", ""),
                })

            # Use title/language from first chunk
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
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, HRFlowable
        from reportlab.lib.colors import HexColor, white
        import datetime

        DARK   = HexColor("#1E293B")
        ACCENT = HexColor("#7C3AED")
        GRAY   = HexColor("#64748B")
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
            canvas.setFont("Helvetica", 8)
            canvas.drawCentredString(w/2, 7*mm, f"Transcribed by AI Scanner  ·  {datetime.date.today()}")

        def on_page(canvas, doc):
            w, h = A4
            canvas.saveState()
            canvas.setFillColor(DARK)
            canvas.rect(0, 0, w, 9*mm, fill=1, stroke=0)
            canvas.setFillColor(white)
            canvas.setFont("Helvetica", 7.5)
            canvas.drawString(MARGIN, 3*mm, structure.get("title", "Manuscript"))
            canvas.drawRightString(w - MARGIN, 3*mm, f"Page {doc.page}")
            canvas.restoreState()

        S = lambda name, **kw: ParagraphStyle(name, **kw)
        cover_title = S("ct", fontName="Helvetica-Bold", fontSize=30, textColor=white, leading=38, alignment=TA_CENTER, spaceAfter=8)
        cover_sub   = S("cs", fontName="Helvetica",      fontSize=12, textColor=HexColor("#94a3b8"), leading=16, alignment=TA_CENTER)
        ch_label    = S("cl", fontName="Helvetica",      fontSize=10, textColor=ACCENT, leading=14, spaceBefore=0, spaceAfter=3)
        ch_title    = S("cht",fontName="Helvetica-Bold", fontSize=20, textColor=DARK, leading=26, spaceBefore=2, spaceAfter=5)
        body        = S("bs", fontName="Helvetica",      fontSize=10.5, textColor=HexColor("#334155"), leading=17, spaceAfter=8, alignment=TA_JUSTIFY)
        lang_badge  = S("lb", fontName="Helvetica",      fontSize=9, textColor=HexColor("#7C3AED"), leading=14, alignment=TA_CENTER)

        doc = SimpleDocTemplate(output_path, pagesize=A4,
                                leftMargin=MARGIN, rightMargin=MARGIN,
                                topMargin=MARGIN, bottomMargin=18*mm,
                                title=structure.get("title", "Manuscript"))
        doc.title = structure.get("title", "Manuscript")

        story = []
        story.append(Spacer(1, 50*mm))
        story.append(Paragraph(structure.get("title", "Manuscript"), cover_title))
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
            story.append(Paragraph(ch["title"], ch_title))
            story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=10))
            for para in ch["content"].split("\n\n"):
                para = para.strip()
                if para:
                    story.append(Paragraph(para, body))
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

        def set_color(paragraph, hex_color="7C3AED"):
            for run in paragraph.runs:
                run.font.color.rgb = RGBColor(int(hex_color[0:2],16), int(hex_color[2:4],16), int(hex_color[4:6],16))

        doc = Document()
        section = doc.sections[0]
        section.page_height = Cm(29.7)
        section.page_width  = Cm(21.0)
        section.left_margin = section.right_margin = Cm(2.5)
        section.top_margin  = Cm(2.5)
        section.bottom_margin = Cm(2.0)

        style_normal = doc.styles['Normal']
        style_normal.font.name = 'Calibri'
        style_normal.font.size = Pt(11)

        # Cover page
        for _ in range(4): doc.add_paragraph()
        t = doc.add_paragraph()
        t.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = t.add_run(structure.get("title", "Manuscript"))
        r.font.size = Pt(26); r.font.bold = True
        r.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)

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

            heading = doc.add_heading(ch["title"], level=1)
            set_color(heading, "1E293B")
            doc.add_paragraph()

            for para in ch["content"].split("\n\n"):
                para = para.strip()
                if para:
                    p = doc.add_paragraph(para)
                    p.style = doc.styles['Normal']
                    p.paragraph_format.space_after = Pt(6)
                    p.paragraph_format.line_spacing = Pt(16)
                    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

            doc.add_page_break()

        doc.save(output_path)
        return output_path
    except Exception as e:
        print(f"  ⚠️  generate_scanned_docx failed. Error details: {e}\n{traceback.format_exc()}")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Main orchestrator
# ─────────────────────────────────────────────────────────────────────────────

def scan_handwritten_book(
    file_path: str,
    filename: str,
    output_dir: str,
    book_title: str = "",
    progress_callback=None,
) -> dict:
    """
    Full pipeline:
    1. Extract/collect images from the input file
    2. Transcribe each image via GPT-4o vision
    3. Structure the transcription into chapters
    4. Generate PDF + DOCX
    Returns metadata dict with paths and stats.
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
        # No arbitrary page cap — process all pages

        if progress_callback: progress_callback("transcribing", 5, f"Found {total_pages} pages — starting transcription…")

        # Step 2: Transcribe
        transcribed = transcribe_images(images, book_title)

        content_pages = sum(1 for p in transcribed if p["has_content"])
        if progress_callback: progress_callback("structuring", 70, f"Transcribed {content_pages}/{total_pages} pages — structuring…")

        # Step 3: Structure
        structure = structure_transcription(transcribed, book_title)
        if book_title:
            structure["title"] = book_title

        if progress_callback: progress_callback("assembling", 85, "Generating PDF and DOCX…")

        # Step 4: Generate outputs
        safe_title = "".join(c for c in structure["title"] if c.isalnum() or c in (" ", "-", "_")).strip() or "manuscript"
        pdf_path  = os.path.join(output_dir, f"{safe_title}_{job_id}.pdf")
        docx_path = os.path.join(output_dir, f"{safe_title}_{job_id}.docx")

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