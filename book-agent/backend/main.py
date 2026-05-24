from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os, sys

sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal
from models import Base, Book, BookSegment
from agent import run_book_agent

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="AI Book Writing Agent",
    description="Generate full books using OpenAI GPT-4o",   
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class BookRequest(BaseModel):
    title         : str
    num_pages     : int
    words_per_page: int = 250
    user_id       : Optional[str] = "default"


@app.get("/")
def root():
    return {"status": "running", "message": "AI Book Writing Agent is live 🚀"}


@app.post("/generate-book")
async def generate_book(req: BookRequest, bg: BackgroundTasks):
    if req.num_pages < 1 or req.num_pages > 500:
        raise HTTPException(400, "num_pages must be between 1 and 500")
    if req.words_per_page < 100 or req.words_per_page > 500:
        raise HTTPException(400, "words_per_page must be between 100 and 500")

    db = SessionLocal()
    book = Book(
        title          = req.title,
        num_pages      = req.num_pages,
        words_per_page = req.words_per_page,
        user_id        = req.user_id,
        status         = "pending"
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    book_id = book.id
    db.close()

    bg.add_task(run_book_agent, book_id)

    return {
        "book_id"     : book_id,
        "status"      : "started",
        "message"     : f"Book '{req.title}' generation started!",
        "check_status": f"/book/{book_id}/status"
    }


@app.get("/book/{book_id}/status")
def get_status(book_id: int):
    db   = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    db.close()
    if not book:
        raise HTTPException(404, "Book not found")
    return {
        "book_id"   : book.id,
        "title"     : book.title,
        "status"    : book.status,
        "pdf_url"   : book.pdf_url,
        "docx_url"  : book.docx_url,
        "created_at": str(book.created_at)
    }


@app.get("/book/{book_id}/progress")
def get_progress(book_id: int):
    db   = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    done = db.query(BookSegment).filter(
               BookSegment.book_id     == book_id,
               BookSegment.is_complete == True).count()
    db.close()
    if not book:
        raise HTTPException(404, "Book not found")
    return {
        "book_id"           : book_id,
        "status"            : book.status,
        "completed_segments": done,
    }


@app.get("/book/{book_id}/download/pdf")
def download_pdf(book_id: int):
    db   = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    db.close()
    if not book or not book.pdf_url:
        raise HTTPException(404, "PDF not ready yet")
    if not os.path.exists(book.pdf_url):
        raise HTTPException(404, "PDF file not found on disk")
    return FileResponse(book.pdf_url, media_type="application/pdf",
                        filename=f"{book.title}.pdf")


@app.get("/book/{book_id}/download/docx")
def download_docx(book_id: int):
    db   = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()
    db.close()
    if not book or not book.docx_url:
        raise HTTPException(404, "DOCX not ready yet")
    if not os.path.exists(book.docx_url):
        raise HTTPException(404, "DOCX file not found on disk")
    return FileResponse(
        book.docx_url,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{book.title}.docx"
    )


@app.get("/books")
def list_books():
    db    = SessionLocal()
    books = db.query(Book).order_by(Book.created_at.desc()).all()
    db.close()
    return [{"book_id": b.id, "title": b.title, "status": b.status,
             "pages": b.num_pages, "created_at": str(b.created_at)} for b in books]