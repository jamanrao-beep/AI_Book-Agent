# pyrefly: ignore [missing-import]
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File
# pyrefly: ignore [missing-import]
from fastapi.responses import FileResponse
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional
import os, sys, uuid, tempfile, shutil

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

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Editorial AI — Book Writing + Proofreading",
    description="Generate full books and proofread documents using OpenAI GPT-4o",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for proofreading jobs (keyed by job_id)
# For production, move this to a database or Redis
_proofread_jobs: dict[str, dict] = {}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)


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
    return {"status": "running", "message": "Editorial AI Backend v3 🚀"}


# ─────────────────────────────────────────────────────────────────────────────
# Book Writing  (unchanged endpoints)
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
# Proofreading  (NEW)
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {".txt", ".docx"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@app.post("/proofread")
async def proofread_document(file: UploadFile = File(...)):
    """
    Upload a .txt or .docx file.
    Returns AI-corrected text + grammar/punctuation/style counts.
    The corrected file is stored at output/corrected_<job_id>.<ext> for download.
    """
    filename = file.filename or "document.txt"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Upload .txt or .docx.")

    # Read & size-check
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large. Maximum size is 10 MB.")

    # Save to temp file
    tmp_path = os.path.join(OUTPUT_DIR, f"upload_{uuid.uuid4().hex}{ext}")
    try:
        with open(tmp_path, "wb") as f_out:
            f_out.write(content)

        # Extract text
        original_text = extract_text(tmp_path, filename)
        if not original_text.strip():
            raise HTTPException(400, "Document appears to be empty.")

        # AI proofreading
        result = proofread_text(original_text)

        # Save corrected file
        job_id = uuid.uuid4().hex
        corrected_filename = f"corrected_{job_id}{ext}"
        corrected_path = os.path.join(OUTPUT_DIR, corrected_filename)

        if ext == ".docx":
            title = os.path.splitext(filename)[0]
            save_corrected_docx(result["corrected_text"], corrected_path, original_title=title)
        else:
            save_corrected_txt(result["corrected_text"], corrected_path)

        # Store job info
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
        # Clean up original upload
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.get("/proofread/{job_id}/download")
def download_proofread(job_id: str):
    """Download the corrected document."""
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
