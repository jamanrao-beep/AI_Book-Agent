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
        ".gif": "image/gif", ".bmp": "image/png",  # convert via PIL
        ".tiff": "image/png", ".tif": "image/png",
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
        except ImportError:
            pass  # fall through to raw read

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
    except ImportError:
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
    for rel in doc.part.rels.values():
        if "image" in rel.reltype:
            img_data = rel.target_part.blob
            ext = Path(rel.target_partname).suffix.lower() or ".png"
            img_path = os.path.join(out_dir, f"image_{idx:04d}{ext}")
            with open(img_path, "wb") as f:
                f.write(img_data)
            paths.append(img_path)
            idx += 1

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
        except Exception:
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

        return sorted(set(image_paths))

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
        
        # Build multi-image message
        content = [{"type": "text", "text": f"Transcribe the handwritten text from the following {len(batch)} page image(s). Separate each page's content with the marker ---PAGE_BREAK--- on its own line."}]
        
        for img_path in batch:
            try:
                b64, mime = _image_to_b64(img_path)
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime};base64,{b64}",
                        "detail": "high"
                    }
                })
            except Exception as e:
                print(f"  ⚠️  Could not encode {img_path}: {e}")
                results.append({
                    "page_num": batch_start + len(results) + 1,
                    "text": "[illegible - could not process image]",
                    "has_content": False,
                })
                continue

        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": TRANSCRIPTION_SYSTEM},
                    {"role": "user", "content": content},
                ],
                max_tokens=4096,
            )
            raw = response.choices[0].message.content.strip()
            pages = raw.split("---PAGE_BREAK---")
            
            for i, page_text in enumerate(pages):
                page_text = page_text.strip()
                has_content = bool(page_text) and "[PAGE: no text]" not in page_text
                results.append({
                    "page_num": batch_start + i + 1,
                    "text": page_text if has_content else "",
                    "has_content": has_content,
                })
        except Exception as e:
            print(f"  ⚠️  Transcription batch {batch_start}-{batch_start+batch_size} failed: {e}")
            for i in range(len(batch)):
                results.append({
                    "page_num": batch_start + i + 1,
                    "text": "[transcription failed for this page]",
                    "has_content": False,
                })

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
    """Use GPT-4o to clean and structure the raw transcription into chapters."""
    
    # Combine all transcribed pages
    full_text = "\n\n".join(
        f"[Page {p['page_num']}]\n{p['text']}"
        for p in pages if p["has_content"]
    )
    
    if not full_text.strip():
        return {
            "title": book_title or "Untitled Manuscript",
            "language": "Unknown",
            "chapters": [{"chapter_number": 1, "title": "Content", "content": "[No readable text found in the uploaded pages]"}],
            "total_words": 0,
        }

    prompt = f"""Book title (if known): {book_title or 'Unknown — infer from content if possible'}

Raw transcribed pages:
{full_text[:60000]}"""  # Limit to avoid token overflow

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": STRUCTURE_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            max_tokens=4096,
        )
        raw = response.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        s = raw.find("{")
        e = raw.rfind("}") + 1
        if s == -1 or e == 0:
            raise ValueError("No JSON in structure response")
        return json.loads(raw[s:e])
    except Exception as exc:
        print(f"  ⚠️  Structuring failed: {exc}. Using flat structure.")
        # Fallback: flat single chapter
        combined = "\n\n".join(p["text"] for p in pages if p["has_content"])
        return {
            "title": book_title or "Transcribed Manuscript",
            "language": "Unknown",
            "chapters": [{"chapter_number": 1, "title": "Full Content", "content": combined}],
            "total_words": len(combined.split()),
        }


# ─────────────────────────────────────────────────────────────────────────────
# PDF generator for scanned book
# ─────────────────────────────────────────────────────────────────────────────

def generate_scanned_pdf(structure: dict, output_path: str) -> str:
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


# ─────────────────────────────────────────────────────────────────────────────
# DOCX generator for scanned book
# ─────────────────────────────────────────────────────────────────────────────

def generate_scanned_docx(structure: dict, output_path: str) -> str:
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
        if total_pages > 400:
            images = images[:400]  # Hard cap
            total_pages = 400

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

    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)