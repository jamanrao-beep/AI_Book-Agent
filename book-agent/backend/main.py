# pyrefly: ignore [missing-import]
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form
# pyrefly: ignore [missing-import]
from fastapi.responses import FileResponse
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional
import os, sys, uuid, zipfile, shutil

sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal
from models import Base, Book, BookSegment
from agent import run_book_agent
from proofreader import (
    extract_text,
    proofread_text,
    save_corrected_docx,
    save_corrected_txt,
)
from cover_designer import design_cover

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Editorial AI — Book Writing + Proofreading + Cover Design",
    description="Generate full books, proofread documents, and design covers using OpenAI GPT-4o",
    version="4.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job stores (use Redis/DB in production)
_proofread_jobs: dict[str, dict] = {}
_cover_jobs:     dict[str, dict] = {}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

MAX_FILE_SIZE = 150 * 1024 * 1024  # 150 MB


# ─────────────────────────────────────────────────────────────────────────────
# Root
# ─────────────────────────────────────────────────────────────────────────────

class BookRequest(BaseModel):
    title: str
    num_pages: int
    words_per_page: int = 250
    user_id: Optional[str] = "default"


@app.get("/")
def root():
    return {"status": "running", "message": "Editorial AI Backend v4.1 🚀"}


# ─────────────────────────────────────────────────────────────────────────────
# Book Writing
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/generate-book")
async def generate_book(req: BookRequest, bg: BackgroundTasks):
    if req.num_pages < 1 or req.num_pages > 500:
        raise HTTPException(400, "num_pages must be between 1 and 500")
    if req.words_per_page < 100 or req.words_per_page > 500:
        raise HTTPException(400, "words_per_page must be between 100 and 500")

    db = SessionLocal()
    book = Book(
        title=req.title,
        num_pages=req.num_pages,
        words_per_page=req.words_per_page,
        user_id=req.user_id,
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


@app.post("/proofread")
async def proofread_document(file: UploadFile = File(...)):
    filename = file.filename or "document.txt"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in ALLOWED_PROOFREAD_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Upload .txt, .docx, .pdf, .md, .rtf, or .zip")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large. Maximum size is 150 MB.")

    tmp_path = os.path.join(OUTPUT_DIR, f"upload_{uuid.uuid4().hex}{ext}")
    try:
        with open(tmp_path, "wb") as f_out:
            f_out.write(content)

        original_text = extract_text(tmp_path, filename)
        if not original_text.strip():
            raise HTTPException(400, "Document appears to be empty.")

        result = proofread_text(original_text)

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
            "download_url": f"/proofread/{job_id}/download",
        }

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
# Cover Designer  —  helpers
# ─────────────────────────────────────────────────────────────────────────────

COVER_ALLOWED_DIRECT = {".pdf", ".docx"}
COVER_ALLOWED_ALL    = {".pdf", ".docx", ".zip"}


def _design_single(tmp_path: str, filename: str, book_title: str, description: str, design_style: str = "") -> dict:
    """Run design_cover on one PDF or DOCX and return the result dict."""
    return design_cover(
        file_path    = tmp_path,
        filename     = filename,
        output_dir   = OUTPUT_DIR,
        book_title   = book_title,
        description  = description,
        design_style = design_style,
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
):
    """
    Upload a .pdf, .docx, or .zip file.

    • .pdf / .docx  → designs one cover, returns concept JSON + single-file download URL.
    • .zip          → extracts all .pdf/.docx inside, designs a cover for each,
                      returns per-file concepts + a bundle zip download URL.

    Optionally pass `book_title`, `description`, and `design_style` as form fields.
    `design_style` accepts: normal | premium | scifi | minimalist | fantasy |
                            thriller | romance | academic | vibrant | retro
    Defaults to "premium" when omitted.
    """
    filename = file.filename or "document.pdf"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in COVER_ALLOWED_ALL:
        raise HTTPException(
            400,
            f"Unsupported file type '{ext}'. "
            "Upload a .pdf, .docx, or a .zip containing .pdf/.docx files."
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large. Maximum 150 MB.")

    tmp_path = os.path.join(OUTPUT_DIR, f"upload_{uuid.uuid4().hex}{ext}")
    try:
        with open(tmp_path, "wb") as f_out:
            f_out.write(content)

        # ── Single file (PDF / DOCX) ──────────────────────────────────────────
        if ext in COVER_ALLOWED_DIRECT:
            result  = _design_single(tmp_path, filename, book_title, description, design_style)
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