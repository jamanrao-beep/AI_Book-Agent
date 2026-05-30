# pyrefly: ignore [missing-import]
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form
# pyrefly: ignore [missing-import]
from fastapi.responses import FileResponse
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional
import os, sys, uuid, zipfile, shutil, threading, logging, traceback, json

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("editorial_ai")
from handwritten_scanner import scan_handwritten_book, SUPPORTED_IMAGE_EXTS, SUPPORTED_UPLOAD_EXTS
from book_editor import (
    extract_book_text, parse_book_structure,
    process_editor_turn, THEMES,
)
from translator import translate_book
from layout_designer import design_layout

sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal
from models import Base, Book, BookSegment
from agent import run_book_agent
from proofreader import (
    extract_text,
    proofread_text,
    apply_selective_corrections,
    save_corrected_docx,
    save_corrected_txt,
    save_corrected_pdf,
)
from cover_designer import design_cover

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Editorial AI — Book Writing + Proofreading + Cover Design",
    description="Generate full books, proofread documents, and design covers using OpenAI GPT-4o",
    version="4.1.0",
)

# ─────────────────────────────────────────────────────────────────────────────
# CORS — must be added FIRST, before any other middleware or routes.
# Using explicit origin list instead of "*" so Railway's proxy correctly
# echoes the origin back on both preflight (OPTIONS) and actual requests.
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_ORIGINS = [
    "https://ai-book-agent-23.vercel.app",  # production frontend
    "http://localhost:3000",                 # local dev
    "http://localhost:3001",                 # alternate local dev port
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  # cache preflight for 1 hour
)


# ─────────────────────────────────────────────────────────────────────────────
# Explicit OPTIONS catch-all — Railway's proxy can swallow preflight requests
# before they reach FastAPI's CORS middleware. This handler ensures every
# OPTIONS preflight gets a 200 response with the correct headers attached
# by the CORSMiddleware above.
# ─────────────────────────────────────────────────────────────────────────────

# pyrefly: ignore [missing-import]
from fastapi.requests import Request
# pyrefly: ignore [missing-import]
from fastapi.responses import JSONResponse


@app.options("/{rest_of_path:path}")
async def preflight_handler(rest_of_path: str, request: Request):
    origin = request.headers.get("origin", "")
    if origin in ALLOWED_ORIGINS:
        return JSONResponse(
            content={},
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "3600",
            },
        )
    return JSONResponse(content={}, status_code=200)

# ─────────────────────────────────────────────────────────────────────────────
# Global exception handler — turns unhandled crashes into readable JSON 500s
# instead of silently closing the TCP connection (which looks like "Network Error")
# ─────────────────────────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled exception on %s %s: %s\n%s",
        request.method, request.url.path, exc, traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
    )


# ─────────────────────────────────────────────────────────────────────────────
# In-memory job stores (use Redis/DB in production)
# ─────────────────────────────────────────────────────────────────────────────

_proofread_jobs: dict[str, dict] = {}
_cover_jobs:     dict[str, dict] = {}
_scan_jobs: dict[str, dict] = {}
_editor_sessions: dict[str, dict] = {}
_translate_jobs: dict[str, dict] = {}
_layout_jobs: dict[str, dict] = {}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

MAX_FILE_SIZE = 150 * 1024 * 1024  # 150 MB
STREAM_CHUNK  = 1 * 1024 * 1024    # 1 MB read chunks


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _stream_upload_to_disk(file: UploadFile, dest_path: str) -> int:
    """
    Stream an UploadFile to disk in 1 MB chunks without loading the entire
    file into RAM.  Returns the total number of bytes written.
    Raises HTTPException(413) if the file exceeds MAX_FILE_SIZE.
    """
    total = 0
    with open(dest_path, "wb") as f_out:
        while True:
            chunk = await file.read(STREAM_CHUNK)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_FILE_SIZE:
                f_out.close()
                os.remove(dest_path)
                raise HTTPException(413, "File too large. Maximum size is 150 MB.")
            f_out.write(chunk)
    return total


# ─────────────────────────────────────────────────────────────────────────────
# Root
# ─────────────────────────────────────────────────────────────────────────────

class BookRequest(BaseModel):
    title: str
    num_pages: int
    words_per_page: int = 250
    user_id: Optional[str] = "default"
    writing_style: Optional[str] = ""


@app.get("/")
def root():
    return {"status": "running", "message": "Editorial AI Backend v4.1 🚀"}


# ─────────────────────────────────────────────────────────────────────────────
# Book Writing
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/generate-book")
async def generate_book(req: BookRequest, bg: BackgroundTasks):
    if req.num_pages < 1 or req.num_pages > 10_000:
        raise HTTPException(400, "num_pages must be between 1 and 10 000")
    if req.words_per_page < 100 or req.words_per_page > 1000:
        raise HTTPException(400, "words_per_page must be between 100 and 1000")

    db = SessionLocal()
    book = Book(
        title=req.title,
        num_pages=req.num_pages,
        words_per_page=req.words_per_page,
        user_id=req.user_id,
        writing_style=req.writing_style or "",
        status="pending",
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    book_id = book.id
    db.close()

    bg.add_task(run_book_agent, book_id)

    return {
        "book_id": book_id,
        "status": "started",
        "message": f"Book '{req.title}' generation started!",
        "check_status": f"/book/{book_id}/status",
    }


@app.get("/book/{book_id}/status")
def get_status(book_id: int):
    db = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    db.close()
    if not book:
        raise HTTPException(404, "Book not found")
    return {
        "book_id": book.id,
        "title": book.title,
        "status": book.status,
        "pdf_url": book.pdf_url,
        "docx_url": book.docx_url,
        "created_at": str(book.created_at),
    }


@app.get("/book/{book_id}/progress")
def get_progress(book_id: int):
    db = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    done = db.query(BookSegment).filter(
        BookSegment.book_id == book_id,
        BookSegment.is_complete == True,
    ).count()
    db.close()
    if not book:
        raise HTTPException(404, "Book not found")
    return {"book_id": book_id, "status": book.status, "completed_segments": done}


@app.get("/book/{book_id}/download/pdf")
def download_pdf(book_id: int):
    db = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    db.close()
    if not book or not book.pdf_url:
        raise HTTPException(404, "PDF not ready yet")
    if not os.path.exists(book.pdf_url):
        raise HTTPException(404, "PDF file not found on disk")
    return FileResponse(book.pdf_url, media_type="application/pdf", filename=f"{book.title}.pdf")


@app.get("/book/{book_id}/download/docx")
def download_docx(book_id: int):
    db = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    db.close()
    if not book or not book.docx_url:
        raise HTTPException(404, "DOCX not ready yet")
    if not os.path.exists(book.docx_url):
        raise HTTPException(404, "DOCX file not found on disk")
    return FileResponse(
        book.docx_url,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{book.title}.docx",
    )


@app.get("/books")
def list_books():
    db = SessionLocal()
    books = db.query(Book).order_by(Book.created_at.desc()).all()
    db.close()
    return [
        {
            "book_id": b.id,
            "title": b.title,
            "status": b.status,
            "pages": b.num_pages,
            "created_at": str(b.created_at),
        }
        for b in books
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Proofreading
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_PROOFREAD_EXTENSIONS = {".txt", ".docx", ".pdf", ".md", ".rtf", ".zip"}


def _run_proofread_job(job_id: str, tmp_path: str, filename: str, ext: str) -> None:
    """
    Background thread: extract text, proofread, save output.
    Updates _proofread_jobs[job_id] with stage/result/error.
    The tmp upload file is deleted here after extraction.
    """
    try:
        _proofread_jobs[job_id]["stage"] = "extracting"
        original_text = extract_text(tmp_path, filename)
        if not original_text.strip():
            _proofread_jobs[job_id].update({"stage": "error", "error": "Document appears to be empty or is an image-based PDF with no text layer."})
            return

        _proofread_jobs[job_id]["stage"] = "proofreading"
        result = proofread_text(original_text)

        out_ext = ext if ext in {".docx", ".pdf"} else ".txt"
        corrected_filename = f"corrected_{job_id}{out_ext}"
        corrected_path = os.path.join(OUTPUT_DIR, corrected_filename)
        title = os.path.splitext(filename)[0]

        if ext == ".docx":
            save_corrected_docx(result["corrected_text"], corrected_path, original_title=title)
        elif ext == ".pdf":
            save_corrected_pdf(result["corrected_text"], corrected_path, original_title=title)
        else:
            save_corrected_txt(result["corrected_text"], corrected_path)

        _proofread_jobs[job_id].update({
            "stage": "done",
            "original_filename": filename,
            "original_text": original_text,
            "original_title": title,
            "corrected_path": corrected_path,
            "ext": out_ext,
            "original_ext": ext,
            "result": {
                "job_id": job_id,
                "original_filename": filename,
                "corrected_text": result["corrected_text"],
                "grammar_fixes": result["grammar_fixes"],
                "punctuation_fixes": result["punctuation_fixes"],
                "style_suggestions": result["style_suggestions"],
                "corrections_summary": result["corrections_summary"],
                "grammar_details": result.get("grammar_details", []),
                "punctuation_details": result.get("punctuation_details", []),
                "style_details": result.get("style_details", []),
                "download_url": f"/proofread/{job_id}/download",
            },
        })

    except Exception as exc:
        logger.error("Background proofread failed for '%s': %s\n%s", filename, exc, traceback.format_exc())
        _proofread_jobs[job_id].update({"stage": "error", "error": str(exc)})
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@app.post("/proofread/upload")
async def proofread_upload(file: UploadFile = File(...)):
    """
    Upload-only endpoint for large files.
    Streams the file to disk, returns job_id immediately.
    Processing runs in background. Poll /proofread/{job_id}/status.
    """
    filename = file.filename or "document.txt"
    ext = os.path.splitext(filename)[1].lower()
    logger.info("Proofread/upload: filename=%s size=%s", filename, file.size or "unknown")

    if ext not in ALLOWED_PROOFREAD_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Upload .txt, .docx, .pdf, .md, .rtf, or .zip")

    job_id = uuid.uuid4().hex
    tmp_path = os.path.join(OUTPUT_DIR, f"upload_{job_id}{ext}")

    try:
        byte_count = await _stream_upload_to_disk(file, tmp_path)
        logger.info("Upload complete: %d bytes -> %s", byte_count, tmp_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Upload failed: {exc}") from exc

    _proofread_jobs[job_id] = {"stage": "queued", "original_filename": filename}

    threading.Thread(
        target=_run_proofread_job,
        args=(job_id, tmp_path, filename, ext),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "started"}


@app.get("/proofread/{job_id}/status")
def proofread_status(job_id: str):
    """Poll for background proofread progress. stage: queued|extracting|proofreading|done|error"""
    job = _proofread_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Proofread job not found.")
    stage = job.get("stage", "unknown")
    resp: dict = {"job_id": job_id, "stage": stage}
    if stage == "done":
        resp["result"] = job["result"]
    elif stage == "error":
        resp["error"] = job.get("error", "Unknown error")
    return resp



@app.post("/proofread")
async def proofread_document(file: UploadFile = File(...)):
    filename = file.filename or "document.txt"
    ext = os.path.splitext(filename)[1].lower()
    logger.info("Proofread request: filename=%s size_hint=%s", filename, file.size)

    if ext not in ALLOWED_PROOFREAD_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Upload .txt, .docx, .pdf, .md, .rtf, or .zip")

    tmp_path = os.path.join(OUTPUT_DIR, f"upload_{uuid.uuid4().hex}{ext}")
    try:
        # ── Stream to disk in chunks — avoids loading the whole file into RAM ──
        byte_count = await _stream_upload_to_disk(file, tmp_path)
        logger.info("Upload streamed to disk: %s bytes → %s", byte_count, tmp_path)

        original_text = extract_text(tmp_path, filename)
        if not original_text.strip():
            raise HTTPException(400, "Document appears to be empty.")
        logger.info("Extracted %d characters of text", len(original_text))

        result = proofread_text(original_text)
        logger.info(
            "Proofreading complete: grammar=%d punct=%d style=%d",
            result["grammar_fixes"], result["punctuation_fixes"], result["style_suggestions"],
        )

        job_id = uuid.uuid4().hex
        corrected_filename = f"corrected_{job_id}{ext}"
        corrected_path = os.path.join(OUTPUT_DIR, corrected_filename)

        if ext == ".docx":
            title = os.path.splitext(filename)[0]
            save_corrected_docx(result["corrected_text"], corrected_path, original_title=title)
        else:
            save_corrected_txt(result["corrected_text"], corrected_path)

        _proofread_jobs[job_id] = {
            "original_filename": filename,
            "original_text": original_text,
            "original_title": os.path.splitext(filename)[0],
            "corrected_path": corrected_path,
            "ext": ext,
        }

        return {
            "job_id": job_id,
            "original_filename": filename,
            "corrected_text": result["corrected_text"],
            "grammar_fixes": result["grammar_fixes"],
            "punctuation_fixes": result["punctuation_fixes"],
            "style_suggestions": result["style_suggestions"],
            "corrections_summary": result["corrections_summary"],
            "grammar_details": result.get("grammar_details", []),
            "punctuation_details": result.get("punctuation_details", []),
            "style_details": result.get("style_details", []),
            "download_url": f"/proofread/{job_id}/download",
        }

    except HTTPException:
        raise  # re-raise clean HTTP errors as-is

    except Exception as exc:
        # Log the full traceback so we can see exactly what crashed
        logger.error("Proofread failed for '%s': %s\n%s", filename, exc, traceback.format_exc())
        raise HTTPException(500, f"Proofreading failed: {exc}") from exc

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.get("/proofread/{job_id}/download")
def download_proofread(job_id: str):
    job = _proofread_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Proofreading job not found. It may have expired — re-upload to proofread again.")

    path = job["corrected_path"]
    if not os.path.exists(path):
        raise HTTPException(404, "Corrected file not found on disk.")

    ext = job["ext"]
    original_name = os.path.splitext(job["original_filename"])[0]
    download_name = f"corrected_{original_name}{ext}"

    if ext == ".docx":
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        media_type = "text/plain"

    return FileResponse(path, media_type=media_type, filename=download_name)


# ─────────────────────────────────────────────────────────────────────────────
# Proofreading — selective PDF generation
# ─────────────────────────────────────────────────────────────────────────────

class SelectivePDFRequest(BaseModel):
    apply_grammar: bool = True
    apply_punctuation: bool = True
    apply_style: bool = True

class SelectiveDOCXRequest(BaseModel):
    apply_grammar: bool = True
    apply_punctuation: bool = True
    apply_style: bool = True


@app.post("/proofread/{job_id}/generate-pdf")
def generate_selective_pdf(job_id: str, req: SelectivePDFRequest):
    """
    Re-run proofreading on the original uploaded text using only the correction
    types the user selected (grammar / punctuation / style), then return a PDF.
    """
    job = _proofread_jobs.get(job_id)
    if not job:
        raise HTTPException(
            404,
            "Proofreading job not found. It may have expired — re-upload to proofread again.",
        )

    if not req.apply_grammar and not req.apply_punctuation and not req.apply_style:
        raise HTTPException(400, "Please select at least one correction type.")

    original_text = job.get("original_text", "")
    if not original_text.strip():
        raise HTTPException(400, "Original document text is no longer available.")

    original_title = job.get("original_title", "Corrected Document")

    # Apply only the selected correction types
    selective_text = apply_selective_corrections(
        original_text,
        apply_grammar=req.apply_grammar,
        apply_punctuation=req.apply_punctuation,
        apply_style=req.apply_style,
    )

    # Generate a fresh PDF
    pdf_filename = f"selective_{job_id}.pdf"
    pdf_path = os.path.join(OUTPUT_DIR, pdf_filename)

    save_corrected_pdf(
        selective_text,
        pdf_path,
        original_title=original_title,
        apply_grammar=req.apply_grammar,
        apply_punctuation=req.apply_punctuation,
        apply_style=req.apply_style,
    )

    # Store the path so the download endpoint can serve it
    job[f"selective_pdf_{job_id}"] = pdf_path

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"corrected_{original_title}.pdf",
    )

@app.post("/proofread/{job_id}/generate-docx")
def generate_selective_docx(job_id: str, req: SelectiveDOCXRequest):
    """
    Re-run proofreading on the original uploaded text using only the correction
    types the user selected (grammar / punctuation / style), then return a DOCX.
    """
    job = _proofread_jobs.get(job_id)
    if not job:
        raise HTTPException(
            404,
            "Proofreading job not found. It may have expired — re-upload to proofread again.",
        )
 
    if not req.apply_grammar and not req.apply_punctuation and not req.apply_style:
        raise HTTPException(400, "Please select at least one correction type.")
 
    original_text = job.get("original_text", "")
    if not original_text.strip():
        raise HTTPException(400, "Original document text is no longer available.")
 
    original_title = job.get("original_title", "Corrected Document")
 
    # Apply only the selected correction types
    selective_text = apply_selective_corrections(
        original_text,
        apply_grammar=req.apply_grammar,
        apply_punctuation=req.apply_punctuation,
        apply_style=req.apply_style,
    )
 
    # Generate a fresh DOCX
    docx_filename = f"selective_{job_id}.docx"
    docx_path = os.path.join(OUTPUT_DIR, docx_filename)
 
    save_corrected_docx(
        selective_text,
        docx_path,
        original_title=original_title,
    )
 
    return FileResponse(
        docx_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"corrected_{original_title}.docx",
    )

# ─────────────────────────────────────────────────────────────────────────────

COVER_ALLOWED_DIRECT = {".pdf", ".docx"}
COVER_ALLOWED_ALL    = {".pdf", ".docx", ".zip"}


def _design_single(tmp_path: str, filename: str, book_title: str, description: str,
                   design_style: str = "",
                   cover_image_bytes: bytes | None = None) -> dict:
    """Run design_cover on one PDF or DOCX and return the result dict."""
    return design_cover(
        file_path         = tmp_path,
        filename          = filename,
        output_dir        = OUTPUT_DIR,
        book_title        = book_title,
        description       = description,
        design_style      = design_style,
        cover_image_bytes = cover_image_bytes,
    )


def _process_zip_for_covers(zip_path: str, book_title: str, description: str, design_style: str = "") -> list[dict]:
    """
    Extract every .pdf / .docx from a zip, design a cover for each,
    and return a list of result dicts:
      [{filename, output_path, concept, ext}, ...]
    Skips unsupported entries silently.
    Raises ValueError if no supported files were found.
    """
    results = []
    scratch_dir = os.path.join(OUTPUT_DIR, f"zip_scratch_{uuid.uuid4().hex}")
    os.makedirs(scratch_dir, exist_ok=True)

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            members = [
                m for m in zf.namelist()
                if os.path.splitext(m)[1].lower() in COVER_ALLOWED_DIRECT
                and not m.startswith("__MACOSX")   # skip macOS metadata
                and not os.path.basename(m).startswith(".")
            ]

            if not members:
                raise ValueError(
                    "No .pdf or .docx files found inside the zip. "
                    "Please upload a zip that contains at least one .pdf or .docx."
                )

            for member in members:
                ext  = os.path.splitext(member)[1].lower()
                base = os.path.basename(member)
                tmp  = os.path.join(scratch_dir, f"{uuid.uuid4().hex}{ext}")

                with zf.open(member) as src, open(tmp, "wb") as dst:
                    shutil.copyfileobj(src, dst)

                # Use the file's own name as the title if caller didn't provide one
                file_title = book_title or (
                    os.path.splitext(base)[0]
                    .replace("_", " ")
                    .replace("-", " ")
                    .title()
                )

                result = _design_single(tmp, base, file_title, description, design_style)
                result["source_filename"] = base
                results.append(result)

                if os.path.exists(tmp):
                    os.remove(tmp)

    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)

    return results


def _build_result_zip(cover_results: list[dict], zip_job_id: str) -> str:
    """
    Bundle all output files from a zip job into a single downloadable zip.
    Returns path to the bundle zip.
    """
    bundle_path = os.path.join(OUTPUT_DIR, f"covers_{zip_job_id}.zip")
    with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for r in cover_results:
            out_path = r["output_path"]
            ext      = r["ext"]
            base     = os.path.splitext(r["source_filename"])[0]
            arc_name = f"{base}_with_cover{ext}"
            zf.write(out_path, arcname=arc_name)
    return bundle_path


# ─────────────────────────────────────────────────────────────────────────────
# Cover Designer  —  endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/design-cover")
async def design_cover_endpoint(
    file: UploadFile = File(...),
    book_title: str = Form(default=""),
    description: str = Form(default=""),
    design_style: str = Form(default=""),
    cover_image: Optional[UploadFile] = File(default=None),
):
    """
    Upload a .pdf, .docx, or .zip file.

    • .pdf / .docx  → designs one cover, returns concept JSON + single-file download URL.
    • .zip          → extracts all .pdf/.docx inside, designs a cover for each,
                      returns per-file concepts + a bundle zip download URL.

    Optionally pass:
      `book_title`   — overrides the title extracted from the filename
      `description`  — extra context for the AI cover concept
      `design_style` — normal | premium | scifi | minimalist | fantasy |
                       thriller | romance | academic | vibrant | retro
      `cover_image`  — optional illustration to use as the full-bleed background
                       (PNG/JPEG). When provided, DALL-E is not called and the
                       supplied image is used directly — no tinting or blurring.
    """
    filename = file.filename or "document.pdf"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in COVER_ALLOWED_ALL:
        raise HTTPException(
            400,
            f"Unsupported file type '{ext}'. "
            "Upload a .pdf, .docx, or a .zip containing .pdf/.docx files."
        )

    # Read optional cover illustration
    cover_img_bytes: bytes | None = None
    if cover_image and cover_image.filename:
        cov_ext = os.path.splitext(cover_image.filename)[1].lower()
        if cov_ext in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
            cover_img_bytes = await cover_image.read()
            logger.info("Cover image supplied: %s (%d bytes)", cover_image.filename, len(cover_img_bytes))
        else:
            logger.warning("Unsupported cover_image extension '%s' — ignoring", cov_ext)

    tmp_path = os.path.join(OUTPUT_DIR, f"upload_{uuid.uuid4().hex}{ext}")
    try:
        await _stream_upload_to_disk(file, tmp_path)

        # ── Single file (PDF / DOCX) ──────────────────────────────────────────
        if ext in COVER_ALLOWED_DIRECT:
            result  = _design_single(tmp_path, filename, book_title, description, design_style,
                                     cover_image_bytes=cover_img_bytes)
            job_id  = result["job_id"]

            _cover_jobs[job_id] = {
                "original_filename": filename,
                "output_path": result["output_path"],
                "ext": ext,
                "is_zip_bundle": False,
            }

            return {
                "job_id": job_id,
                "mode": "single",
                "original_filename": filename,
                "concept": result["concept"],
                "download_url": f"/design-cover/{job_id}/download",
            }

        # ── ZIP bundle ────────────────────────────────────────────────────────
        else:
            try:
                cover_results = _process_zip_for_covers(tmp_path, book_title, description, design_style)
            except ValueError as e:
                raise HTTPException(400, str(e))

            zip_job_id   = uuid.uuid4().hex
            bundle_path  = _build_result_zip(cover_results, zip_job_id)

            _cover_jobs[zip_job_id] = {
                "original_filename": filename,
                "output_path": bundle_path,
                "ext": ".zip",
                "is_zip_bundle": True,
            }

            # Summarise per-file concepts for the response
            files_info = [
                {
                    "source_filename": r["source_filename"],
                    "concept": r["concept"],
                }
                for r in cover_results
            ]

            return {
                "job_id": zip_job_id,
                "mode": "zip_bundle",
                "original_filename": filename,
                "files_processed": len(cover_results),
                "files": files_info,
                "download_url": f"/design-cover/{zip_job_id}/download",
            }

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.get("/design-cover/{job_id}/download")
def download_cover_doc(job_id: str):
    """
    Download the output:
    • Single .pdf/.docx  → the original file with the AI cover page prepended.
    • ZIP bundle         → a zip containing all processed files with their covers.
    """
    job = _cover_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Cover job not found. Re-upload to regenerate.")

    path = job["output_path"]
    if not os.path.exists(path):
        raise HTTPException(404, "Output file not found on disk.")

    ext           = job["ext"]
    original_name = os.path.splitext(job["original_filename"])[0]
    is_bundle     = job.get("is_zip_bundle", False)

    if is_bundle:
        download_name = f"{original_name}_covers.zip"
        media_type    = "application/zip"
    elif ext == ".docx":
        download_name = f"{original_name}_with_cover.docx"
        media_type    = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        download_name = f"{original_name}_with_cover.pdf"
        media_type    = "application/pdf"

    return FileResponse(path, media_type=media_type, filename=download_name)


# ─────────────────────────────────────────────────────────────────────────────
# Handwritten Book Scanner
# ─────────────────────────────────────────────────────────────────────────────

SCAN_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif", ".pdf", ".docx", ".zip"}


@app.post("/scan-handwritten")
async def scan_handwritten(
    file: Optional[UploadFile] = File(default=None),
    files: list[UploadFile] = File(default=[]),
    book_title: str = Form(default=""),
):
    """
    Transcribe handwritten pages into a clean book.

    Accepts:
    - Single file: image (jpg/png/webp/bmp/tiff/gif), PDF scan, DOCX with images, or ZIP of images
    - Multiple files: list of image files (multi-upload)

    Returns job metadata + download URLs for PDF and DOCX.
    """
    import tempfile, zipfile as _zipfile

    # Normalise: single file vs multiple
    all_uploads: list[UploadFile] = []
    if file and file.filename:
        all_uploads.append(file)
    if files:
        all_uploads.extend(files)

    if not all_uploads:
        raise HTTPException(400, "No file(s) uploaded.")

    # Validate extensions
    for u in all_uploads:
        ext = os.path.splitext(u.filename or "")[1].lower()
        if ext not in SCAN_ALLOWED_EXTS:
            raise HTTPException(400, f"Unsupported file type '{ext}'. Accepted: images, .pdf, .docx, .zip")

    # If multiple image files, stream each to a temp file then bundle into ZIP
    if len(all_uploads) > 1:
        zip_job_id = uuid.uuid4().hex
        zip_tmp = os.path.join(OUTPUT_DIR, f"upload_pages_{zip_job_id}.zip")
        staged: list[str] = []   # temp files to clean up
        try:
            with _zipfile.ZipFile(zip_tmp, "w", _zipfile.ZIP_DEFLATED) as zf:
                for i, upload in enumerate(all_uploads):
                    fname = upload.filename or f"page_{i:04d}.jpg"
                    ext_i = os.path.splitext(fname)[1].lower() or ".jpg"
                    tmp_i = os.path.join(OUTPUT_DIR, f"mup_{zip_job_id}_{i}{ext_i}")
                    staged.append(tmp_i)
                    await _stream_upload_to_disk(upload, tmp_i)  # honours MAX_FILE_SIZE
                    zf.write(tmp_i, arcname=fname)
            result = scan_handwritten_book(
                file_path=zip_tmp,
                filename=f"pages_{zip_job_id}.zip",
                output_dir=OUTPUT_DIR,
                book_title=book_title,
            )
        finally:
            for p in staged:
                if os.path.exists(p):
                    try: os.remove(p)
                    except Exception: pass
            if os.path.exists(zip_tmp):
                os.remove(zip_tmp)
    else:
        # Single file upload — stream to disk
        upload = all_uploads[0]
        filename = upload.filename or "document"
        ext = os.path.splitext(filename)[1].lower()
        tmp_path = os.path.join(OUTPUT_DIR, f"upload_{uuid.uuid4().hex}{ext}")
        try:
            await _stream_upload_to_disk(upload, tmp_path)
            result = scan_handwritten_book(
                file_path=tmp_path,
                filename=filename,
                output_dir=OUTPUT_DIR,
                book_title=book_title,
            )
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    job_id = result["job_id"]
    _scan_jobs[job_id] = {
        "pdf_path": result["pdf_path"],
        "docx_path": result["docx_path"],
        "title": result["title"],
    }

    return {
        "job_id": job_id,
        "title": result["title"],
        "language": result["language"],
        "total_pages": result["total_pages"],
        "content_pages": result["content_pages"],
        "total_words": result["total_words"],
        "chapters": result["chapters"],
        "chapter_titles": result["chapter_titles"],
        "pdf_url": f"/scan-handwritten/{job_id}/download/pdf",
        "docx_url": f"/scan-handwritten/{job_id}/download/docx",
    }


@app.get("/scan-handwritten/{job_id}/download/pdf")
def download_scan_pdf(job_id: str):
    job = _scan_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found. Re-upload to scan again.")
    path = job["pdf_path"]
    if not os.path.exists(path):
        raise HTTPException(404, "PDF file not found on disk.")
    title = job.get("title", "manuscript")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(path, media_type="application/pdf", filename=f"{safe}.pdf")


@app.get("/scan-handwritten/{job_id}/download/docx")
def download_scan_docx(job_id: str):
    job = _scan_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found. Re-upload to scan again.")
    path = job["docx_path"]
    if not os.path.exists(path):
        raise HTTPException(404, "DOCX file not found on disk.")
    title = job.get("title", "manuscript")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{safe}.docx",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Book Editor — session management
# ─────────────────────────────────────────────────────────────────────────────

EDITOR_ALLOWED_EXTS = {".pdf", ".docx", ".zip", ".txt", ".md"}


@app.post("/editor/upload")
async def editor_upload(
    file: UploadFile = File(...),
    theme: str = Form(default="premium"),
):
    """
    Upload a book file to start an editing session.
    Returns session_id + parsed book metadata.
    """
    filename = file.filename or "book"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in EDITOR_ALLOWED_EXTS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Upload .pdf, .docx, .zip, .txt, or .md")

    tmp_path = os.path.join(OUTPUT_DIR, f"editor_upload_{uuid.uuid4().hex}{ext}")
    try:
        await _stream_upload_to_disk(file, tmp_path)

        raw_text = extract_book_text(tmp_path, filename)
        if not raw_text.strip():
            raise HTTPException(400, "Document appears empty or unreadable.")

        book_structure = parse_book_structure(raw_text, filename)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    session_id = uuid.uuid4().hex
    _editor_sessions[session_id] = {
        "book": book_structure,
        "theme": theme,
        "history": [],       # conversation history
        "versions": [],      # list of {pdf_path, docx_path, edit_summary, theme, turn}
        "turn": 0,
        "original_filename": filename,
    }

    return {
        "session_id": session_id,
        "title": book_structure.get("title", "Untitled"),
        "author": book_structure.get("author", ""),
        "chapters": len(book_structure.get("chapters", [])),
        "chapter_titles": [c["title"] for c in book_structure.get("chapters", [])],
        "theme": theme,
        "available_themes": list(THEMES.keys()),
        "message": f"Book loaded successfully. {len(book_structure.get('chapters', []))} chapters found. What would you like to edit?",
    }


@app.post("/editor/{session_id}/chat")
async def editor_chat(
    session_id: str,
    user_message: str = Form(...),
    theme: Optional[str] = Form(default=None),
):
    """
    Send an edit instruction. AI edits the book and returns a new downloadable version.
    Maintains full conversation context across turns.
    """
    session = _editor_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Editor session not found. Please re-upload your book.")

    current_book = session["book"]
    current_theme = theme or session["theme"]
    session["turn"] += 1
    turn = session["turn"]

    # Add user message to history
    session["history"].append({"role": "user", "content": user_message})

    try:
        result = process_editor_turn(
            book_structure=current_book,
            user_message=user_message,
            conversation_history=session["history"],
            output_dir=OUTPUT_DIR,
            theme=current_theme,
            job_id=f"{session_id}_v{turn}",
        )
    except Exception as e:
        # Don't crash the session — return error message
        session["history"].append({
            "role": "assistant",
            "content": f"I encountered an error applying that edit: {str(e)}. Please try rephrasing your request.",
        })
        raise HTTPException(500, f"Edit failed: {str(e)}")

    # Update session state
    session["book"]  = result["updated_book"]
    session["theme"] = result["theme"]

    version_record = {
        "turn": turn,
        "pdf_path": result["pdf_path"],
        "docx_path": result["docx_path"],
        "edit_summary": result["edit_summary"],
        "theme": result["theme"],
        "chapters_changed": result["chapters_changed"],
        "pdf_url": f"/editor/{session_id}/download/pdf/{turn}",
        "docx_url": f"/editor/{session_id}/download/docx/{turn}",
    }
    session["versions"].append(version_record)

    # Add assistant response to history
    assistant_msg = (
        f"{result['edit_summary']}\n\n"
        f"Theme: **{result['theme']}** · "
        f"Chapters modified: {result['chapters_changed'] or 'none'} · "
        f"Version {turn} ready to download."
    )
    session["history"].append({"role": "assistant", "content": assistant_msg})

    return {
        "turn": turn,
        "edit_summary": result["edit_summary"],
        "chapters_changed": result["chapters_changed"],
        "theme": result["theme"],
        "title": result["updated_book"].get("title", ""),
        "chapter_titles": [c["title"] for c in result["updated_book"].get("chapters", [])],
        "pdf_url": version_record["pdf_url"],
        "docx_url": version_record["docx_url"],
        "assistant_message": assistant_msg,
    }


@app.get("/editor/{session_id}/download/pdf/{turn}")
def editor_download_pdf(session_id: str, turn: int):
    session = _editor_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    version = next((v for v in session["versions"] if v["turn"] == turn), None)
    if not version or not os.path.exists(version["pdf_path"]):
        raise HTTPException(404, "PDF not found. It may have been cleaned up.")
    title = session["book"].get("title", "book")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(version["pdf_path"], media_type="application/pdf", filename=f"{safe}_v{turn}.pdf")


@app.get("/editor/{session_id}/download/docx/{turn}")
def editor_download_docx(session_id: str, turn: int):
    session = _editor_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    version = next((v for v in session["versions"] if v["turn"] == turn), None)
    if not version or not os.path.exists(version["docx_path"]):
        raise HTTPException(404, "DOCX not found.")
    title = session["book"].get("title", "book")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(
        version["docx_path"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{safe}_v{turn}.docx",
    )


@app.get("/editor/{session_id}/history")
def editor_history(session_id: str):
    session = _editor_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    return {
        "session_id": session_id,
        "turn": session["turn"],
        "title": session["book"].get("title", ""),
        "theme": session["theme"],
        "versions": [
            {
                "turn": v["turn"],
                "edit_summary": v["edit_summary"],
                "theme": v["theme"],
                "chapters_changed": v["chapters_changed"],
                "pdf_url": v["pdf_url"],
                "docx_url": v["docx_url"],
            }
            for v in session["versions"]
        ],
        "messages": session["history"],
    }


@app.delete("/editor/{session_id}")
def editor_delete_session(session_id: str):
    session = _editor_sessions.pop(session_id, None)
    if session:
        # Cleanup output files
        for v in session.get("versions", []):
            for path_key in ("pdf_path", "docx_path"):
                p = v.get(path_key, "")
                if p and os.path.exists(p):
                    try: os.remove(p)
                    except: pass
    return {"deleted": True}


# ─────────────────────────────────────────────────────────────────────────────
# Book Translator
# ─────────────────────────────────────────────────────────────────────────────

TRANSLATE_ALLOWED_EXTS = {".pdf", ".docx", ".zip"}


def _run_translation_job(job_id: str, file_path: str, filename: str,
                         target_language: str, source_language: str) -> None:
    """Background thread worker for translation."""
    def progress(stage: str, pct: int, message: str) -> None:
        _translate_jobs[job_id].update({"stage": stage, "pct": pct, "message": message})

    try:
        result = translate_book(
            file_path=file_path,
            filename=filename,
            output_dir=OUTPUT_DIR,
            target_language=target_language,
            source_language=source_language,
            progress_callback=progress,
        )
        _translate_jobs[job_id].update({
            "stage": "done",
            "pct": 100,
            "message": "Translation complete!",
            "result": result,
            "pdf_path": result["pdf_path"],
            "docx_path": result["docx_path"],
            "title": result["title"],
        })
    except Exception as e:
        _translate_jobs[job_id].update({
            "stage": "error",
            "pct": 0,
            "message": str(e),
        })
    finally:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass


@app.post("/translate")
async def translate_book_endpoint(
    file: UploadFile = File(...),
    target_language: str = Form(...),
    source_language: str = Form(default=""),
):
    """
    Upload a PDF, DOCX, or ZIP book and translate it to the target language.
    Returns a job_id immediately; poll /translate/{job_id}/status for progress.
    """
    filename = file.filename or "document.pdf"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in TRANSLATE_ALLOWED_EXTS:
        raise HTTPException(
            400,
            f"Unsupported file type '{ext}'. Upload a .pdf, .docx, or .zip file."
        )
    if not target_language.strip():
        raise HTTPException(400, "target_language is required.")

    job_id = uuid.uuid4().hex
    tmp_path = os.path.join(OUTPUT_DIR, f"translate_upload_{job_id}{ext}")
    await _stream_upload_to_disk(file, tmp_path)

    _translate_jobs[job_id] = {
        "stage": "extracting",
        "pct": 5,
        "message": "Upload received — starting extraction…",
        "result": None,
    }

    thread = threading.Thread(
        target=_run_translation_job,
        args=(job_id, tmp_path, filename, target_language.strip(), source_language.strip()),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "started"}


@app.get("/translate/{job_id}/status")
def translate_status(job_id: str):
    """Poll this endpoint for translation progress."""
    job = _translate_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Translation job not found.")

    resp: dict = {
        "job_id": job_id,
        "stage": job["stage"],
        "pct": job["pct"],
        "message": job["message"],
    }

    if job["stage"] == "done" and job.get("result"):
        r = job["result"]
        resp["result"] = {
            "job_id": job_id,
            "title": r["title"],
            "source_language": r["source_language"],
            "target_language": r["target_language"],
            "total_words": r["total_words"],
            "chapters": r["chapters"],
            "chapter_titles": r["chapter_titles"],
            "pdf_url": f"/translate/{job_id}/download/pdf",
            "docx_url": f"/translate/{job_id}/download/docx",
        }

    return resp


@app.get("/translate/{job_id}/download/pdf")
def download_translate_pdf(job_id: str):
    job = _translate_jobs.get(job_id)
    if not job or job.get("stage") != "done":
        raise HTTPException(404, "Translation not complete or job not found.")
    path = job.get("pdf_path", "")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "PDF file not found on disk.")
    title = job.get("title", "translated_book")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(path, media_type="application/pdf", filename=f"{safe}_translated.pdf")


@app.get("/translate/{job_id}/download/docx")
def download_translate_docx(job_id: str):
    job = _translate_jobs.get(job_id)
    if not job or job.get("stage") != "done":
        raise HTTPException(404, "Translation not complete or job not found.")
    path = job.get("docx_path", "")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "DOCX file not found on disk.")
    title = job.get("title", "translated_book")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{safe}_translated.docx",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Internal Layout Designer
# ─────────────────────────────────────────────────────────────────────────────

LAYOUT_ALLOWED_EXTS = {".pdf", ".docx", ".zip", ".txt", ".md"}


def _run_layout_job(
    job_id: str,
    file_path: str,
    filename: str,
    page_width_mm: float,
    page_height_mm: float,
    book_title: str,
    design_instructions: str,
    book_type: Optional[str] = None,
    visual_template: Optional[str] = None,
    # Typography overrides — None means "let AI decide"
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
    # Footer overrides
    footer_left_text: Optional[str] = None,
    footer_right_pagenum: Optional[bool] = True,
    # Advanced layout overrides
    mirror_margins: Optional[bool] = None,
    gutter_mm: Optional[float] = None,
    paragraph_spacing_mm: Optional[float] = None,
    indent_mm: Optional[float] = None,
    color_mode: Optional[str] = None,
    bleed_mm: Optional[float] = None,
    chapter_start: Optional[str] = None,
    page_number_start: Optional[int] = None,
    page_number_style: Optional[str] = None,
    header_custom_text: Optional[str] = None,
    heading_design: Optional[str] = None,
    section_breaks: Optional[bool] = None,
    front_matter: Optional[list] = None,
    back_matter: Optional[list] = None,
) -> None:
    """Background thread worker for layout design."""

    def progress(stage: str, pct: int, message: str) -> None:
        _layout_jobs[job_id].update({"stage": stage, "pct": pct, "message": message})

    try:
        result = design_layout(
            file_path=file_path,
            filename=filename,
            output_dir=OUTPUT_DIR,
            page_width_mm=page_width_mm,
            page_height_mm=page_height_mm,
            book_title=book_title,
            design_instructions=design_instructions,
            book_type=book_type,
            visual_template=visual_template,
            progress_callback=progress,
            # pass overrides through
            body_font=body_font,
            chapter_font=chapter_font,
            body_font_size=body_font_size,
            chapter_font_size=chapter_font_size,
            line_spacing=line_spacing,
            margin_top_mm=margin_top_mm,
            margin_bottom_mm=margin_bottom_mm,
            margin_left_mm=margin_left_mm,
            margin_right_mm=margin_right_mm,
            show_drop_cap=show_drop_cap,
            show_page_numbers=show_page_numbers,
            footer_left_text=footer_left_text,
            footer_right_pagenum=footer_right_pagenum,
            mirror_margins=mirror_margins,
            gutter_mm=gutter_mm,
            paragraph_spacing_mm=paragraph_spacing_mm,
            indent_mm=indent_mm,
            color_mode=color_mode,
            bleed_mm=bleed_mm,
            chapter_start=chapter_start,
            page_number_start=page_number_start,
            page_number_style=page_number_style,
            header_custom_text=header_custom_text,
            heading_design=heading_design,
            section_breaks=section_breaks,
            front_matter=front_matter,
            back_matter=back_matter,
        )
        _layout_jobs[job_id].update(
            {
                "stage": "done",
                "pct": 100,
                "message": "Layout design complete!",
                "result": result,
                "pdf_path": result["pdf_path"],
                "docx_path": result["docx_path"],
                "title": result["title"],
                "book_type": result.get("book_type", "auto"),
                "book_type_label": result.get("book_type_label", "Auto (AI chosen)"),
            }
        )
    except Exception as e:
        _layout_jobs[job_id].update(
            {"stage": "error", "pct": 0, "message": str(e)}
        )
    finally:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass


@app.post("/design-layout")
async def design_layout_endpoint(
    file: UploadFile = File(...),
    page_width_mm: float = Form(default=210.0),
    page_height_mm: float = Form(default=297.0),
    book_title: str = Form(default=""),
    design_instructions: str = Form(default=""),
    book_type: Optional[str] = Form(default=None),
    visual_template: Optional[str] = Form(default=None),
    # Typography overrides — all optional, empty string = let AI decide
    body_font: Optional[str] = Form(default=None),
    chapter_font: Optional[str] = Form(default=None),
    body_font_size: Optional[str] = Form(default=None),
    chapter_font_size: Optional[str] = Form(default=None),
    line_spacing: Optional[str] = Form(default=None),
    margin_top_mm: Optional[str] = Form(default=None),
    margin_bottom_mm: Optional[str] = Form(default=None),
    margin_left_mm: Optional[str] = Form(default=None),
    margin_right_mm: Optional[str] = Form(default=None),
    show_drop_cap: Optional[str] = Form(default=None),
    show_page_numbers: Optional[str] = Form(default=None),
    # Footer overrides
    footer_left_text: Optional[str] = Form(default=None),
    footer_right_pagenum: Optional[str] = Form(default="true"),
    # Advanced layout overrides
    mirror_margins: Optional[str] = Form(default=None),
    gutter_mm: Optional[str] = Form(default=None),
    paragraph_spacing_mm: Optional[str] = Form(default=None),
    indent_mm: Optional[str] = Form(default=None),
    color_mode: Optional[str] = Form(default=None),
    bleed_mm: Optional[str] = Form(default=None),
    chapter_start: Optional[str] = Form(default=None),
    page_number_start: Optional[str] = Form(default=None),
    page_number_style: Optional[str] = Form(default=None),
    header_custom_text: Optional[str] = Form(default=None),
    heading_design: Optional[str] = Form(default=None),
    section_breaks: Optional[str] = Form(default=None),
    front_matter: Optional[str] = Form(default=None),   # JSON array string
    back_matter: Optional[str] = Form(default=None),    # JSON array string
):
    """
    Upload a PDF, DOCX, or ZIP book and apply an AI-generated internal layout.
    Accepts custom page dimensions (mm), optional design instructions, and
    optional typography overrides (fonts, sizes, spacing, margins, drop caps).
    Returns a job_id immediately; poll /layout/{job_id}/status for progress.
    Every submission runs a full regeneration — changing any field always
    produces a fresh book.
    """
    filename = file.filename or "book.pdf"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in LAYOUT_ALLOWED_EXTS:
        raise HTTPException(
            400,
            f"Unsupported file type '{ext}'. Upload a .pdf, .docx, or .zip file.",
        )

    # Clamp page dimensions to sensible range (50 mm – 600 mm)
    page_width_mm  = max(50.0, min(600.0, page_width_mm))
    page_height_mm = max(50.0, min(600.0, page_height_mm))

    # Safe parsers for optional numeric / bool overrides
    def _float_or_none(v: Optional[str]) -> Optional[float]:
        if not v or not v.strip():
            return None
        try:
            return float(v)
        except ValueError:
            return None

    def _bool_or_none(v: Optional[str]) -> Optional[bool]:
        if not v or not v.strip():
            return None
        return v.strip().lower() in {"true", "1", "yes"}

    job_id = uuid.uuid4().hex
    tmp_path = os.path.join(OUTPUT_DIR, f"layout_upload_{job_id}{ext}")
    await _stream_upload_to_disk(file, tmp_path)

    _layout_jobs[job_id] = {
        "stage": "queued",
        "pct": 0,
        "message": "Job queued — starting shortly…",
        "result": None,
    }

    thread = threading.Thread(
        target=_run_layout_job,
        args=(
            job_id,
            tmp_path,
            filename,
            page_width_mm,
            page_height_mm,
            book_title.strip(),
            design_instructions.strip(),
        ),
        kwargs=dict(
            book_type=book_type.strip() if book_type and book_type.strip() else None,
            visual_template=visual_template.strip() if visual_template and visual_template.strip() else None,
            body_font=body_font.strip() if body_font and body_font.strip() else None,
            chapter_font=chapter_font.strip() if chapter_font and chapter_font.strip() else None,
            body_font_size=_float_or_none(body_font_size),
            chapter_font_size=_float_or_none(chapter_font_size),
            line_spacing=_float_or_none(line_spacing),
            margin_top_mm=_float_or_none(margin_top_mm),
            margin_bottom_mm=_float_or_none(margin_bottom_mm),
            margin_left_mm=_float_or_none(margin_left_mm),
            margin_right_mm=_float_or_none(margin_right_mm),
            show_drop_cap=_bool_or_none(show_drop_cap),
            show_page_numbers=_bool_or_none(show_page_numbers),
            # Footer
            footer_left_text=footer_left_text.strip() if footer_left_text and footer_left_text.strip() else None,
            footer_right_pagenum=_bool_or_none(footer_right_pagenum) if footer_right_pagenum else True,
            # Advanced
            mirror_margins=_bool_or_none(mirror_margins),
            gutter_mm=_float_or_none(gutter_mm),
            paragraph_spacing_mm=_float_or_none(paragraph_spacing_mm),
            indent_mm=_float_or_none(indent_mm),
            color_mode=color_mode.strip() if color_mode and color_mode.strip() else None,
            bleed_mm=_float_or_none(bleed_mm),
            chapter_start=chapter_start.strip() if chapter_start and chapter_start.strip() else None,
            page_number_start=int(_float_or_none(page_number_start) or 1) if page_number_start and page_number_start.strip() else None,
            page_number_style=page_number_style.strip() if page_number_style and page_number_style.strip() else None,
            header_custom_text=header_custom_text.strip() if header_custom_text and header_custom_text.strip() else None,
            heading_design=heading_design.strip() if heading_design and heading_design.strip() else None,
            section_breaks=_bool_or_none(section_breaks),
            front_matter=json.loads(front_matter) if front_matter and front_matter.strip().startswith("[") else None,
            back_matter=json.loads(back_matter) if back_matter and back_matter.strip().startswith("[") else None,
        ),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "started"}


@app.get("/layout/{job_id}/status")
def layout_status(job_id: str):
    """Poll this endpoint for layout-design progress."""
    job = _layout_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Layout job not found.")

    resp: dict = {
        "job_id": job_id,
        "stage": job["stage"],
        "pct": job["pct"],
        "message": job["message"],
    }

    if job["stage"] == "done" and job.get("result"):
        r = job["result"]
        resp["result"] = {
            "job_id": job_id,
            "title": r["title"],
            "style_name": r["style_name"],
            "concept": r["concept"],
            "chapter_count": r["chapter_count"],
            "chapter_titles": r["chapter_titles"],
            "book_type": r.get("book_type", job.get("book_type", "auto")),
            "book_type_label": r.get("book_type_label", job.get("book_type_label", "Auto (AI chosen)")),
            "pdf_url": f"/layout/{job_id}/download/pdf",
            "docx_url": f"/layout/{job_id}/download/docx",
        }

    return resp


@app.get("/layout/{job_id}/download/pdf")
def download_layout_pdf(job_id: str):
    job = _layout_jobs.get(job_id)
    if not job or job.get("stage") != "done":
        raise HTTPException(404, "Layout job not complete or not found.")
    path = job.get("pdf_path", "")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "PDF file not found on disk.")
    title = job.get("title", "book_layout")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(path, media_type="application/pdf", filename=f"{safe}_layout.pdf")


@app.get("/layout/{job_id}/download/docx")
def download_layout_docx(job_id: str):
    job = _layout_jobs.get(job_id)
    if not job or job.get("stage") != "done":
        raise HTTPException(404, "Layout job not complete or not found.")
    path = job.get("docx_path", "")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "DOCX file not found on disk.")
    title = job.get("title", "book_layout")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{safe}_layout.docx",
    )