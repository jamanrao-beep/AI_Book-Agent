import sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except AttributeError:
    pass

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form
# pyrefly: ignore [missing-import]
from fastapi.responses import FileResponse, JSONResponse
# pyrefly: ignore [missing-import]
from fastapi.requests import Request
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional
import os, sys, uuid, zipfile, shutil, threading, logging, traceback, json

# ── NEW ENTERPRISE WEBSOCKET IMPORTS ─────────────────────────────────────────
import asyncio
# pyrefly: ignore [missing-import]
from fastapi import WebSocket, WebSocketDisconnect
# pyrefly: ignore [missing-import]
from contextlib import asynccontextmanager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("editorial_ai")

# H2 FIX: Define lifespan before app so FastAPI() can reference it
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Captures the main ASGI event loop on boot to allow background thread broadcasting."""
    global _global_event_loop
    _global_event_loop = asyncio.get_running_loop()
    logger.info("🚀 Enterprise ASGI Event Loop captured for background task broadcasting.")
    yield

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

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

_HEAVY_JOB_SEMAPHORE = threading.Semaphore(2)

# pyrefly: ignore [missing-import]
from sqlalchemy import text

# Auto-fix corrupted schema (from a bad previous deployment)
try:
    with engine.begin() as conn:
        result = conn.execute(text("PRAGMA table_info(books)")).fetchall()
        columns = [row[1] for row in result]
        if columns and "user_id" not in columns:
            conn.execute(text("DROP TABLE books"))
            conn.execute(text("DROP TABLE book_segments"))
except Exception:
    pass

Base.metadata.create_all(bind=engine)

# Auto-migrate missing column for existing SQLite databases
try:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE books ADD COLUMN total_sections INTEGER"))
except Exception:
    pass


app = FastAPI(
    title="Publixo AI — Book Writing + Proofreading + Cover Design",
    description="Generate full books, proofread documents, and design covers using Google Gemini (Nano Banana)",
    version="5.0.0",
    lifespan=lifespan,
)

# ─────────────────────────────────────────────────────────────────────────────
# CORS — must be added FIRST, before any other middleware or routes.
# Using explicit origin list instead of "*" so Railway's proxy correctly
# echoes the origin back on both preflight (OPTIONS) and actual requests.
# ─────────────────────────────────────────────────────────────────────────────

_env_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
_fallback_origins = [
    "https://ai-book-agent-23.vercel.app",  # production frontend
    "https://publixoai.com",                 # production frontend (new domain)
    "https://www.publixoai.com",             # production frontend (new domain)
    "http://localhost:3000",                 # local dev
    "http://localhost:3001",                 # alternate local dev port
    "http://localhost:3002",                 # fallback Next.js port
    "http://localhost:3003",                 # fallback Next.js port
]
ALLOWED_ORIGINS = list(set(_env_origins + _fallback_origins))

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
        content={"detail": "Something went wrong on our end. Please try again later."},
    )


# ─────────────────────────────────────────────────────────────────────────────
# ENTERPRISE WEBSOCKET CONNECTION MANAGER (Zero-Latency Streaming)
# ─────────────────────────────────────────────────────────────────────────────

class ConnectionManager:
    """
    Manages active WebSocket connections for real-time progress streaming.
    Thread-safe implementation allows synchronous background workers (PDF/DOCX renders)
    to push updates securely to the asynchronous ASGI event loop.
    Fully supports UTF-8/Devanagari payload streaming without encoding corruption.
    """
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}
        self.lock = threading.Lock()

    async def connect(self, websocket: WebSocket, job_id: str):
        await websocket.accept()
        with self.lock:
            if job_id not in self.active_connections:
                self.active_connections[job_id] = []
            self.active_connections[job_id].append(websocket)
        logger.info(f"🌐 WebSocket Connected: Real-time tunnel established for Job [{job_id}]")

    def disconnect(self, websocket: WebSocket, job_id: str):
        with self.lock:
            if job_id in self.active_connections:
                if websocket in self.active_connections[job_id]:
                    self.active_connections[job_id].remove(websocket)
                if not self.active_connections[job_id]:
                    del self.active_connections[job_id]
        logger.info(f"🔌 WebSocket Disconnected: Tunnel closed for Job [{job_id}]")

    async def broadcast(self, job_id: str, message: dict):
        """Pushes JSON payloads to all clients tracking this specific job_id."""
        # Take a snapshot of current connections under the lock so we don't
        # hold the lock during async sends, and avoid races with disconnect().
        with self.lock:
            connections = list(self.active_connections.get(job_id, []))
        
        if not connections:
            return
        
        dead_connections = []
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        
        for dead in dead_connections:
            self.disconnect(dead, job_id)

manager = ConnectionManager()
_global_event_loop = None

def sync_broadcast(job_id: str, message: dict):
    """
    Safely bridges synchronous background threads to the async WebSocket publisher 
    without blocking the server.
    """
    global _global_event_loop
    if _global_event_loop and _global_event_loop.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(job_id, message), _global_event_loop)

@app.websocket("/ws/status/{job_id}")
async def websocket_status_endpoint(websocket: WebSocket, job_id: str):
    """
    Persistent bi-directional endpoint for live job monitoring.
    Connect frontend via: new WebSocket(`ws://[domain]/ws/status/${job_id}`)
    """
    await manager.connect(websocket, job_id)
    try:
        while True:
            # Keep connection alive until frontend drops or error occurs
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, job_id)


# ─────────────────────────────────────────────────────────────────────────────
# In-memory job stores (use Redis/DB in production)
# ─────────────────────────────────────────────────────────────────────────────

_cover_jobs:      dict[str, dict] = {}

from database import SessionLocal
from models import Job

class _DBJobProxy:
    def __init__(self, prefix: str):
        self.prefix = prefix
    
    def get(self, key: str, default=None):
        with SessionLocal() as db:
            job = db.query(Job).filter(Job.id == key, Job.job_type == self.prefix).first()
            if not job: return default
            
            # Start with result_json to get all custom keys (like corrected_path, etc)
            d = dict(job.result_json or {})
            
            # Overlay standard columns
            d["stage"] = job.stage
            d["pct"] = job.pct
            d["message"] = job.message
            d["is_cancelled"] = job.is_cancelled
            if hasattr(job, "state"): d["state"] = job.stage
            
            return d
            
    def __getitem__(self, key: str):
        v = self.get(key)
        if v is None: raise KeyError(key)
        return v
        
    def __setitem__(self, key: str, value: dict):
        with SessionLocal() as db:
            job = db.query(Job).filter(Job.id == key, Job.job_type == self.prefix).first()
            if not job:
                job = Job(id=key, job_type=self.prefix)
                db.add(job)
                
            # Extract standard columns
            if "stage" in value: job.stage = value["stage"]
            if "state" in value: job.stage = value["state"]
            if "pct" in value: job.pct = value["pct"]
            if "message" in value: job.message = value["message"]
            if "is_cancelled" in value: job.is_cancelled = value["is_cancelled"]
            
            # Put EVERYTHING else (including "result" and custom fields) into result_json
            current_res = dict(job.result_json or {})
            for k, v in value.items():
                if k not in ["stage", "state", "pct", "message", "is_cancelled"]:
                    current_res[k] = v
            job.result_json = current_res
            
            db.commit()
            
    def update_job(self, key: str, updates: dict):
        existing = self.get(key) or {}
        existing.update(updates)
        self[key] = existing
        
    def pop(self, key: str, default=None):
        value = self.get(key, default)
        with SessionLocal() as db:
            job = db.query(Job).filter(Job.id == key, Job.job_type == self.prefix).first()
            if job:
                db.delete(job)
                db.commit()
        return value

_layout_jobs = _DBJobProxy("layout")
_scan_jobs = _DBJobProxy("scan")
_translate_jobs = _DBJobProxy("translate")
_cover_jobs = _DBJobProxy("cover")
_editor_sessions = _DBJobProxy("editor_session")
_editor_jobs = _DBJobProxy("editor_job")
_proofread_jobs = _DBJobProxy("proofread")

def _write_job(job_id: str, data: dict) -> None:
    _proofread_jobs[job_id] = data
def _read_job(job_id: str) -> dict | None:
    return _proofread_jobs.get(job_id)
def _update_job(job_id: str, updates: dict) -> None:
    _proofread_jobs.update_job(job_id, updates)


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
    language: Optional[str] = "English"   # ← NEW: output language for the book


@app.get("/")
def root():
    return {"status": "running", "message": "Publixo AI Backend v5.0.0 🚀"}


# ─────────────────────────────────────────────────────────────────────────────
# Book Writing
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/generate-book")
async def generate_book(req: BookRequest, bg: BackgroundTasks):
    if req.num_pages < 1 or req.num_pages > 10_000:
        raise HTTPException(400, "num_pages must be between 1 and 10 000")
    if req.words_per_page < 50 or req.words_per_page > 1000:
        raise HTTPException(400, "words_per_page must be between 50 and 1000")

    lang = (req.language or "English").strip()

    # Merge language into writing_style so the openai_client
    # language-instruction pipeline picks it up automatically.
    base_style  = (req.writing_style or "").strip()
    merged_style = f"{base_style} — Write the entire book in {lang}." if base_style else f"Write the entire book in {lang}."

    db = SessionLocal()
    book = Book(
        title=req.title,
        num_pages=req.num_pages,
        words_per_page=req.words_per_page,
        user_id=req.user_id,
        writing_style=merged_style,
        language=lang,
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
        "language": book.language or "English",
        "pdf_url": book.pdf_url,
        "docx_url": book.docx_url,
        "error_message": book.error_message,
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
    return {
        "book_id": book_id,
        "status": book.status,
        "completed_segments": done,
        # Real total from the outline (set once outlining finishes). None while
        # still outlining — the frontend should show an indeterminate state
        # until this is non-null rather than guessing from pages/words_per_page.
        "total_segments": book.total_sections,
    }



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
def list_books(user_id: str):
    db = SessionLocal()
    books = db.query(Book).filter(Book.user_id == user_id).order_by(Book.created_at.desc()).all()
    db.close()
    return [
        {
            "book_id": b.id,
            "title": b.title,
            "status": b.status,
            "pages": b.num_pages,
            "error_message": b.error_message,
            "created_at": str(b.created_at),
        }
        for b in books
    ]


@app.post("/book/{book_id}/cancel")
def cancel_book(book_id: int):
    """
    E8: Signal a running book generation job to stop after the current section.
    The agent checks is_cancelled after every section and exits cleanly.
    """
    db = SessionLocal()
    try:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(404, f"Book {book_id} not found")
        if book.status in ("done", "failed", "cancelled"):
            return {"book_id": book_id, "status": book.status, "message": "Job already finished — nothing to cancel."}
        book.is_cancelled = True
        db.commit()
        return {"book_id": book_id, "status": "cancel_requested", "message": "Cancellation signal sent. Job will stop after the current section."}
    finally:
        db.close()


@app.post("/book/{book_id}/resume")
def resume_book(book_id: int, bg: BackgroundTasks):
    """
    Re-runs the agent for a book that previously failed or was cancelled.
    agent.py's run_book_agent is resume-safe: it reuses the saved outline and
    skips any section already marked is_complete, so this only generates
    whatever didn't finish last time — it does NOT start the book over.
    """
    db = SessionLocal()
    try:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(404, f"Book {book_id} not found")
        if book.status not in ("failed", "cancelled"):
            return {
                "book_id": book_id,
                "status": book.status,
                "message": "Job isn't in a failed/cancelled state — nothing to resume.",
            }

        book.status        = "outlining" if not book.outline else "generating"
        book.error_message = None
        book.is_cancelled   = False
        db.commit()
    finally:
        db.close()

    bg.add_task(run_book_agent, book_id)

    return {
        "book_id": book_id,
        "status": "resumed",
        "message": "Resuming generation from where it left off.",
        "check_status": f"/book/{book_id}/status",
    }


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
        _update_job(job_id, {"stage": "extracting"})
        sync_broadcast(job_id, {"type": "progress", "job_id": job_id, "stage": "extracting", "progress": 10, "message": "Extracting text..."})
        
        original_text = extract_text(tmp_path, filename)
        if not original_text.strip():
            _update_job(job_id, {"stage": "error", "error": "Document appears to be empty or is an image-based PDF with no text layer."})
            sync_broadcast(job_id, {"type": "error", "job_id": job_id, "message": "Document appears to be empty."})
            return

        _update_job(job_id, {"stage": "proofreading", "chunks_done": 0, "chunks_total": 0})
        sync_broadcast(job_id, {"type": "progress", "job_id": job_id, "stage": "proofreading", "progress": 40, "message": "Proofreading initiated..."})

        def _chunk_progress(done: int, total: int) -> None:
            pct = 40 + int((done / total) * 55)
            _update_job(job_id, {
                "stage": "proofreading",
                "chunks_done": done,
                "chunks_total": total,
            })
            sync_broadcast(job_id, {
                "type": "progress",
                "job_id": job_id,
                "stage": "proofreading",
                "progress": pct,
                "chunks_done": done,
                "chunks_total": total,
                "message": f"Proofreading chunk {done}/{total}…",
            })

        result = proofread_text(
            original_text, 
            progress_callback=_chunk_progress,
            check_cancelled=lambda: _proofread_jobs.get(job_id, {}).get("is_cancelled")
        )

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

        # Always save a plain-text sidecar so the ?format=txt preview endpoint
        # can serve it without re-reading a DOCX or PDF.
        txt_path = os.path.join(OUTPUT_DIR, f"corrected_{job_id}.txt")
        save_corrected_txt(result["corrected_text"], txt_path)

        # BUG E fix: never store corrected_text in memory — only store the file
        # path and lightweight metadata. This prevents the status endpoint from
        # serialising a 100KB+ payload, which Railway's proxy kills mid-stream.
        metadata_result = {
            "job_id": job_id,
            "original_filename": filename,
            "grammar_fixes": result["grammar_fixes"],
            "punctuation_fixes": result["punctuation_fixes"],
            "style_suggestions": result["style_suggestions"],
            "corrections_summary": result["corrections_summary"],
            "grammar_details": result.get("grammar_details", []),
            "punctuation_details": result.get("punctuation_details", []),
            "style_details": result.get("style_details", []),
            "skipped_chunks": result.get("skipped_chunks", []),
            "download_url": f"/proofread/{job_id}/download",
            # corrected_text intentionally omitted — fetch via /download endpoint
        }

        payload = {
            "stage": "done",
            "original_filename": filename,
            "original_text": original_text,
            "original_title": title,
            "corrected_path": corrected_path,
            "txt_path": txt_path,
            "ext": out_ext,
            "original_ext": ext,
            "result": metadata_result,
        }
        
        _update_job(job_id, payload)
        sync_broadcast(job_id, {"type": "complete", "job_id": job_id, "result": metadata_result})

    except Exception as exc:
        logger.error("Background proofread failed for '%s': %s\n%s", filename, exc, traceback.format_exc())
        _update_job(job_id, {"stage": "error", "error": str(exc)})
        sync_broadcast(job_id, {"type": "error", "job_id": job_id, "message": str(exc)})
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
        raise HTTPException(400, "That file type isn\'t supported. Please upload a .txt, .docx, .pdf, .md, .rtf, or .zip file.")

    job_id = uuid.uuid4().hex
    tmp_path = os.path.join(OUTPUT_DIR, f"upload_{job_id}{ext}")

    try:
        byte_count = await _stream_upload_to_disk(file, tmp_path)
        logger.info("Upload complete: %d bytes -> %s", byte_count, tmp_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, "We encountered an issue uploading your file. Please try again.") from exc

    _proofread_jobs[job_id] = {"stage": "queued", "original_filename": filename}

    threading.Thread(
        target=_run_proofread_job,
        args=(job_id, tmp_path, filename, ext),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "started"}


@app.post("/proofread/{job_id}/cancel")
async def proofread_cancel(job_id: str):
    job = _proofread_jobs.get(job_id)
    if not job:
        logger.error(f"DEBUG: Proofread job {job_id} not found! Current jobs in DB: {_proofread_jobs._debug_list_all() if hasattr(_proofread_jobs, '_debug_list_all') else 'unknown'}")
        raise HTTPException(404, "Proofread job not found.")
    if job.get("stage") in ("done", "error", "cancelled"):
        raise HTTPException(400, "Job is already complete or cancelled.")
    _proofread_jobs.update_job(job_id, {"is_cancelled": True, "stage": "error", "error": "Cancelled by user"})
    return {"message": "Cancelled"}

@app.get("/proofread/{job_id}/status")
async def proofread_status(job_id: str):
    """
    Poll for background proofread progress. stage: queued|extracting|proofreading|done|error
    BUG B fix: async def so FastAPI handles this on the event loop rather than
    occupying a threadpool worker, preventing Railway's 100s proxy timeout when
    the threadpool is saturated by the background proofreading job.
    BUG A+C fix: result never contains corrected_text — only lightweight metadata
    (counts, summary, download URL). Corrected text is served via /download as a
    file stream, sidestepping Railway's response-size and gzip-corruption limits.
    """
    job = _proofread_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Proofread job not found.")
    stage = job.get("stage", "unknown")
    resp: dict = {
        "job_id": job_id,
        "stage": stage,
        "chunks_done": job.get("chunks_done", 0),
        "chunks_total": job.get("chunks_total", 0),
    }
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
        raise HTTPException(400, "That file type isn\'t supported. Please upload a .txt, .docx, .pdf, .md, .rtf, or .zip file.")

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
        corrected_ext = ext if ext in {".docx", ".pdf"} else ".txt"
        corrected_filename = f"corrected_{job_id}{corrected_ext}"
        corrected_path = os.path.join(OUTPUT_DIR, corrected_filename)

        if ext == ".docx":
            title = os.path.splitext(filename)[0]
            save_corrected_docx(result["corrected_text"], corrected_path, original_title=title)
        else:
            save_corrected_txt(result["corrected_text"], corrected_path)

        # Save plain-text sidecar for ?format=txt preview endpoint
        txt_path = os.path.join(OUTPUT_DIR, f"corrected_{job_id}.txt")
        save_corrected_txt(result["corrected_text"], txt_path)

        legacy_title = os.path.splitext(filename)[0]
        metadata_result = {
            "job_id": job_id,
            "original_filename": filename,
            "grammar_fixes": result["grammar_fixes"],
            "punctuation_fixes": result["punctuation_fixes"],
            "style_suggestions": result["style_suggestions"],
            "corrections_summary": result["corrections_summary"],
            "grammar_details": result.get("grammar_details", []),
            "punctuation_details": result.get("punctuation_details", []),
            "style_details": result.get("style_details", []),
            "skipped_chunks": result.get("skipped_chunks", []),
            "download_url": f"/proofread/{job_id}/download",
        }
        _proofread_jobs[job_id] = {
            "stage": "done",
            "original_filename": filename,
            "original_text": original_text,
            "original_title": legacy_title,
            "corrected_path": corrected_path,
            "txt_path": txt_path,
            "ext": corrected_ext,
            "original_ext": ext,   # H3 FIX: was missing — caused KeyError in downstream code
            "result": metadata_result,
        }
        return metadata_result

    except HTTPException:
        raise  # re-raise clean HTTP errors as-is

    except Exception as exc:
        # Log the full traceback so we can see exactly what crashed
        logger.error("Proofread failed for '%s': %s\n%s", filename, exc, traceback.format_exc())
        raise HTTPException(500, "We encountered an issue proofreading your file. Please try again.") from exc

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.get("/proofread/{job_id}/download")
async def download_proofread(job_id: str, format: str = ""):
    job = _proofread_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Proofreading job not found. It may have expired — re-upload to proofread again.")

    path = job["corrected_path"]
    if not os.path.exists(path):
        raise HTTPException(404, "Corrected file not found on disk.")

    # ?format=txt — frontend requests plain text for the in-page preview tab.
    # Read the stored corrected text and return it as UTF-8 plain text so the
    # browser can display it directly without triggering a file download.
    if format == "txt":
        # pyrefly: ignore [missing-import]
        from fastapi.responses import PlainTextResponse
        txt_path = job.get("txt_path")
        if txt_path and os.path.exists(txt_path):
            with open(txt_path, "r", encoding="utf-8", errors="replace") as f:
                return PlainTextResponse(f.read())
        # Fallback: read corrected_text stored in the job result dict
        corrected = (job.get("result") or {}).get("corrected_text", "")
        if not corrected:
            # Last resort: if the saved file is a .txt, read it directly
            if path.endswith(".txt"):
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    corrected = f.read()
        return PlainTextResponse(corrected or "")

    ext = job["ext"]
    original_name = os.path.splitext(job["original_filename"])[0]
    download_name = f"corrected_{original_name}{ext}"

    if ext == ".docx":
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif ext == ".pdf":
        media_type = "application/pdf"
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
async def generate_selective_pdf(job_id: str, req: SelectivePDFRequest):
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

    # Apply only the selected correction types (run in thread — can take minutes)
    selective_text = await asyncio.to_thread(
        apply_selective_corrections,
        original_text,
        req.apply_grammar,
        req.apply_punctuation,
        req.apply_style,
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

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"corrected_{original_title}.pdf",
    )

@app.post("/proofread/{job_id}/generate-docx")
async def generate_selective_docx(job_id: str, req: SelectiveDOCXRequest):
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
 
    # Apply only the selected correction types (run in thread — can take minutes)
    selective_text = await asyncio.to_thread(
        apply_selective_corrections,
        original_text,
        req.apply_grammar,
        req.apply_punctuation,
        req.apply_style,
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
                       (PNG/JPEG). When provided, Nano Banana is not called and the
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
                "image_generation_warning": result["concept"].get("_nb_note"),
            }

        # ── ZIP bundle ────────────────────────────────────────────────────────
        else:
            try:
                cover_results = _process_zip_for_covers(tmp_path, book_title, description, design_style)
            except ValueError as e:
                raise HTTPException(400, "We encountered an issue processing your request. Please check your inputs.")

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

            # Aggregate _nb_note warnings across all files in the bundle
            zip_nb_warning = next(
                (r["concept"].get("_nb_note") for r in cover_results if r["concept"].get("_nb_note")),
                None,
            )
            return {
                "job_id": zip_job_id,
                "mode": "zip_bundle",
                "original_filename": filename,
                "files_processed": len(cover_results),
                "files": files_info,
                "download_url": f"/design-cover/{zip_job_id}/download",
                "image_generation_warning": zip_nb_warning,
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


def _run_scan_job(
    job_id: str,
    file_path: str,
    filename: str,
    book_title: str,
    staged_paths: list,
) -> None:
    """
    Background thread worker for handwritten scanning with WebSocket real-time broadcast.
    Mirrors the pattern used by translation and layout jobs.
    staged_paths: extra temp files to clean up after (used in multi-upload ZIP bundling).
    """
    def progress(stage: str, pct: int, message: str) -> None:
        _scan_jobs.update_job(job_id, {"stage": stage, "pct": pct, "message": message})
        sync_broadcast(job_id, {
            "type": "progress",
            "job_id": job_id,
            "stage": stage,
            "progress": pct,
            "message": message,
        })

    # Queue if the server is already busy — update status so frontend knows
    _scan_jobs.update_job(job_id, {"stage": "queued", "pct": 0, "message": "Waiting for a free processing slot…"})
    with _HEAVY_JOB_SEMAPHORE:
        try:
            result = scan_handwritten_book(
                file_path=file_path,
                filename=filename,
                output_dir=OUTPUT_DIR,
                book_title=book_title,
                progress_callback=progress,
                check_cancelled=lambda: _scan_jobs.get(job_id, {}).get("is_cancelled")
            )

            payload = {
                "stage": "done",
                "pct": 100,
                "message": "Transcription complete!",
                "pdf_path": result["pdf_path"],
                "docx_path": result["docx_path"],
                "title": result["title"],
                "result": result,
            }
            _scan_jobs.update_job(job_id, payload)
            sync_broadcast(job_id, {
                "type": "complete",
                "job_id": job_id,
                "result": {
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
                },
            })

        except Exception as e:
            logger.error("Scan job failed for '%s': %s\n%s", filename, e, traceback.format_exc())
            _scan_jobs.update_job(job_id, {"stage": "error", "pct": 0, "message": str(e)})
            sync_broadcast(job_id, {"type": "error", "job_id": job_id, "message": str(e)})

        finally:
            for p in staged_paths + [file_path]:
                if p and os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass


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

    Returns job_id immediately. Poll /scan-handwritten/{job_id}/status or connect via
    WebSocket ws://.../ws/status/{job_id} for real-time progress.
    Download URLs become active when stage == "done".
    """
    import zipfile as _zipfile

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
            raise HTTPException(400, "That file type isn\'t supported. Please upload an image, .pdf, .docx, or .zip file.")

    job_id = uuid.uuid4().hex
    staged_paths: list[str] = []

    # If multiple image files, stream each to a temp file then bundle into ZIP
    if len(all_uploads) > 1:
        zip_tmp = os.path.join(OUTPUT_DIR, f"upload_pages_{job_id}.zip")
        try:
            with _zipfile.ZipFile(zip_tmp, "w", _zipfile.ZIP_DEFLATED) as zf:
                for i, upload in enumerate(all_uploads):
                    fname = upload.filename or f"page_{i:04d}.jpg"
                    ext_i = os.path.splitext(fname)[1].lower() or ".jpg"
                    tmp_i = os.path.join(OUTPUT_DIR, f"mup_{job_id}_{i}{ext_i}")
                    staged_paths.append(tmp_i)
                    await _stream_upload_to_disk(upload, tmp_i)
                    zf.write(tmp_i, arcname=fname)
            file_path = zip_tmp
            filename = f"pages_{job_id}.zip"
        except Exception:
            # C3 FIX: also clean up zip_tmp which is NOT in staged_paths
            for p in staged_paths + [zip_tmp]:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
            raise
    else:
        upload = all_uploads[0]
        filename = upload.filename or "document"
        ext = os.path.splitext(filename)[1].lower()
        file_path = os.path.join(OUTPUT_DIR, f"upload_{job_id}{ext}")
        await _stream_upload_to_disk(upload, file_path)

    _scan_jobs[job_id] = {
        "stage": "queued",
        "pct": 0,
        "message": "Upload received — starting shortly…",
        "result": None,
    }

    threading.Thread(
        target=_run_scan_job,
        args=(job_id, file_path, filename, book_title, staged_paths),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "started"}


@app.post("/scan-handwritten/{job_id}/cancel")
async def scan_cancel(job_id: str):
    job = _scan_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found.")
    if job.get("stage") in ("done", "error", "cancelled"):
        raise HTTPException(400, "Job is already complete or cancelled.")
    _scan_jobs.update_job(job_id, {"is_cancelled": True, "stage": "error", "error": "Cancelled by user"})
    return {"message": "Cancelled"}

@app.get("/scan-handwritten/{job_id}/status")
async def scan_status(job_id: str):
    """Poll for scan progress. stage: queued|collecting|transcribing|healing|structuring|assembling|done|error"""
    job = _scan_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found.")

    stage = job.get("stage", "unknown")
    resp: dict = {
        "job_id": job_id,
        "stage": stage,
        "pct": job.get("pct", 0),
        "message": job.get("message", ""),
    }

    if stage == "done" and job.get("result"):
        r = job["result"]
        resp["result"] = {
            "job_id": job_id,
            "title": r["title"],
            "language": r["language"],
            "total_pages": r["total_pages"],
            "content_pages": r["content_pages"],
            "total_words": r["total_words"],
            "chapters": r["chapters"],
            "chapter_titles": r["chapter_titles"],
            "pdf_url": f"/scan-handwritten/{job_id}/download/pdf",
            "docx_url": f"/scan-handwritten/{job_id}/download/docx",
        }
    elif stage == "error":
        resp["error"] = job.get("message", "Unknown error")

    return resp


@app.get("/scan-handwritten/{job_id}/download/pdf")
def download_scan_pdf(job_id: str):
    job = _scan_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found. Re-upload to scan again.")
    if job.get("stage") != "done":
        raise HTTPException(400, "The scan is not complete yet. Please wait.")
    path = job.get("pdf_path", "")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "PDF file not found on disk.")
    title = job.get("title", "manuscript")
    safe = "".join(c for c in title if c.isalnum() or c in (" ", "-", "_")).strip()
    return FileResponse(path, media_type="application/pdf", filename=f"{safe}.pdf")


@app.get("/scan-handwritten/{job_id}/download/docx")
def download_scan_docx(job_id: str):
    job = _scan_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found. Re-upload to scan again.")
    if job.get("stage") != "done":
        raise HTTPException(400, "The scan is not complete yet. Please wait.")
    path = job.get("docx_path", "")
    if not path or not os.path.exists(path):
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
        raise HTTPException(400, "That file type isn\'t supported. Please upload a .pdf, .docx, .zip, .txt, or .md file.")

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
    session = _editor_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Editor session not found. Please re-upload your book.")

    job_id = str(uuid.uuid4())
    _editor_jobs[job_id] = {"state": "processing", "result": None, "error": None}

    current_theme = theme or session["theme"]
    session["turn"] += 1
    turn = session["turn"]
    session["history"].append({"role": "user", "content": user_message})

    # Snapshot what the thread needs (don't let it race with next turn)
    book_snapshot = session["book"]
    history_snapshot = list(session["history"])

    def _run():
        try:
            result = process_editor_turn(
                book_structure=book_snapshot,
                user_message=user_message,
                conversation_history=history_snapshot,
                output_dir=OUTPUT_DIR,
                theme=current_theme,
                job_id=f"{session_id}_v{turn}",
                check_cancelled=lambda: _editor_jobs.get(job_id, {}).get("is_cancelled")
            )
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

            assistant_msg = (
                f"{result['edit_summary']}\n\n"
                f"Theme: **{result['theme']}** · "
                f"Chapters modified: {result['chapters_changed'] or 'none'} · "
                f"Version {turn} ready to download."
            )
            session["history"].append({"role": "assistant", "content": assistant_msg})

            _editor_jobs[job_id]["result"] = {
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
            _editor_jobs[job_id]["state"] = "done"
        except Exception as e:
            _editor_jobs[job_id]["state"] = "error"
            _editor_jobs[job_id]["error"] = str(e)

    threading.Thread(target=_run, daemon=True).start()
    return {"job_id": job_id, "state": "processing"}


@app.post("/editor/{session_id}/job/{job_id}/cancel")
async def editor_cancel(session_id: str, job_id: str):
    job = _editor_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Editor job not found.")
    if job.get("state") in ("done", "error", "cancelled"):
        raise HTTPException(400, "Job is already complete or cancelled.")
    job["is_cancelled"] = True
    job["state"] = "error"
    job["error"] = "Cancelled by user"
    return {"message": "Cancelled"}

@app.get("/editor/{session_id}/job/{job_id}/status")
async def editor_job_status(session_id: str, job_id: str):
    job = _editor_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "state": job["state"],
        "result": job["result"],
        "error": job["error"],
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
                    except Exception: pass
    return {"deleted": True}


# ─────────────────────────────────────────────────────────────────────────────
# Book Translator
# ─────────────────────────────────────────────────────────────────────────────

TRANSLATE_ALLOWED_EXTS = {".pdf", ".docx", ".zip"}


def _run_translation_job(job_id: str, file_path: str, filename: str,
                         target_language: str, source_language: str) -> None:
    """Background thread worker for translation with WebSocket real-time broadcast."""
    def progress(stage: str, pct: int, message: str) -> None:
        _translate_jobs.update_job(job_id, {"stage": stage, "pct": pct, "message": message})
        sync_broadcast(job_id, {
            "type": "progress",
            "job_id": job_id,
            "stage": stage,
            "progress": pct,
            "message": message
        })

    _translate_jobs.update_job(job_id, {"stage": "queued", "pct": 0, "message": "Waiting for a free processing slot…"})
    with _HEAVY_JOB_SEMAPHORE:
        try:
            result = translate_book(
                file_path=file_path,
                filename=filename,
                output_dir=OUTPUT_DIR,
                target_language=target_language,
                source_language=source_language,
                progress_callback=progress,
                check_cancelled=lambda: _translate_jobs.get(job_id, {}).get("is_cancelled")
            )
            
            payload = {
                "stage": "done",
                "pct": 100,
                "message": "Translation complete!",
                "result": result,
                "pdf_path": result["pdf_path"],
                "docx_path": result["docx_path"],
                "title": result["title"],
            }
            _translate_jobs.update_job(job_id, payload)
            sync_broadcast(job_id, {"type": "complete", "job_id": job_id, "result": payload["result"]})
            
        except Exception as e:
            _translate_jobs.update_job(job_id, {
                "stage": "error",
                "pct": 0,
                "message": str(e),
            })
            sync_broadcast(job_id, {"type": "error", "job_id": job_id, "message": str(e)})
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


@app.post("/translate/{job_id}/cancel")
async def translate_cancel(job_id: str):
    job = _translate_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Translate job not found.")
    if job.get("stage") in ("done", "error", "cancelled"):
        raise HTTPException(400, "Job is already complete or cancelled.")
    _translate_jobs.update_job(job_id, {"is_cancelled": True, "stage": "error", "error": "Cancelled by user"})
    return {"message": "Cancelled"}

@app.get("/translate/{job_id}/status")
async def translate_status(job_id: str):
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
async def download_translate_pdf(job_id: str):
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
async def download_translate_docx(job_id: str):
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
    footer_middle_text: Optional[str] = None,
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
    """Background thread worker for layout design with WebSocket real-time broadcast."""

    def progress(stage: str, pct: int, message: str) -> None:
        _layout_jobs.update_job(job_id, {"stage": stage, "pct": pct, "message": message})
        sync_broadcast(job_id, {
            "type": "progress",
            "job_id": job_id,
            "stage": stage,
            "progress": pct,
            "message": message
        })

    _layout_jobs.update_job(job_id, {"stage": "queued", "pct": 0, "message": "Waiting for a free processing slot…"})
    with _HEAVY_JOB_SEMAPHORE:
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
                footer_middle_text=footer_middle_text,
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
                check_cancelled=lambda: _layout_jobs.get(job_id, {}).get("is_cancelled")
            )

            payload = {
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
            _layout_jobs.update_job(job_id, payload)
            sync_broadcast(job_id, {"type": "complete", "job_id": job_id, "result": payload["result"]})

        except Exception as e:
            _layout_jobs.update_job(job_id, {"stage": "error", "pct": 0, "message": str(e)})
            sync_broadcast(job_id, {"type": "error", "job_id": job_id, "message": str(e)})
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
    footer_middle_text: Optional[str] = Form(default=None),
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

    # M4 FIX: Wrap json.loads in try/except — invalid JSON would otherwise 500
    def _parse_json_list(v: Optional[str]) -> Optional[list]:
        if not v or not v.strip().startswith("["):
            return None
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return None

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
            footer_middle_text=footer_middle_text.strip() if footer_middle_text and footer_middle_text.strip() else None,
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
            front_matter=_parse_json_list(front_matter),
            back_matter=_parse_json_list(back_matter),
        ),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "started"}


@app.post("/layout/{job_id}/cancel")
async def layout_cancel(job_id: str):
    job = _layout_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Layout job not found.")
    if job.get("stage") in ("done", "error", "cancelled"):
        raise HTTPException(400, "Job is already complete or cancelled.")
    _layout_jobs.update_job(job_id, {"is_cancelled": True, "stage": "error", "error": "Cancelled by user"})
    return {"message": "Cancelled"}

@app.get("/layout/{job_id}/status")
async def layout_status(job_id: str):
    """Poll this endpoint for layout-design progress.
    async def so FastAPI handles it on the event loop rather than blocking
    a threadpool worker — prevents Railway's 100s proxy timeout under load."""
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
async def download_layout_pdf(job_id: str):
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
async def download_layout_docx(job_id: str):
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