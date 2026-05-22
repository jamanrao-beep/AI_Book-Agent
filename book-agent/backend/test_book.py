"""
Quick test — runs the full book agent directly (no server needed).
Usage:  python test_book.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

# ── CONFIG ────────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "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")
BOOK_TITLE     = "The Art of Productivity: Mastering Your Time and Energy"
NUM_PAGES      = 75     
WORDS_PER_PAGE = 200
# ─────────────────────────────────────────────────────────────────────────────

os.environ["OPENAI_API_KEY"]  = OPENAI_API_KEY
os.environ["DATABASE_URL"]    = "sqlite:///./books.db"

from database import engine, SessionLocal
from models import Base, Book

# Create tables
Base.metadata.create_all(bind=engine)

# Create book record
db   = SessionLocal()
book = Book(
    title          = BOOK_TITLE,
    num_pages      = NUM_PAGES,
    words_per_page = WORDS_PER_PAGE,
    user_id        = "test_user",
    status         = "pending"
)
db.add(book)
db.commit()
db.refresh(book)
book_id = book.id
db.close()

print(f"{'='*55}")
print(f"  AI BOOK WRITING AGENT — TEST RUN")
print(f"{'='*55}")
print(f"  Book   : {BOOK_TITLE}")
print(f"  Pages  : {NUM_PAGES}  |  Words/page: {WORDS_PER_PAGE}")
print(f"  Book ID: {book_id}")
print(f"{'='*55}\n")

from agent import run_book_agent
result = run_book_agent(book_id)

if result:
    print(f"\n{'='*55}")
    print(f"  ✅ SUCCESS!")
    print(f"  PDF  → {result['pdf']}")
    print(f"  DOCX → {result['docx']}")
    print(f"{'='*55}")
    print(f"\n  Open the files from the 'output/' folder.")
