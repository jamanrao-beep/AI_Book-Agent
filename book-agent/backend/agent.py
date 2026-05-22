import json
import time
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import Book, BookSegment
from openai_client import generate_outline, generate_section


def calculate_chapters(num_pages: int, words_per_page: int) -> int:
    total_words = num_pages * words_per_page
    words_per_section = max(words_per_page, 400)
    words_per_chapter = 4 * words_per_section
    chapters = max(3, total_words // words_per_chapter)
    return min(chapters, 100)


def run_book_agent(book_id: int):
    db   = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()

    if not book:
        print(f"❌ Book ID {book_id} not found")
        db.close()
        return

    print(f"\n📖 Starting: '{book.title}'")
    print(f"   Pages: {book.num_pages}  |  Words/page: {book.words_per_page}")

    try:
        # ── STEP 1: Generate Outline ──────────────────────────────────────────
        book.status = "outlining"
        db.commit()

        num_chapters = calculate_chapters(book.num_pages, book.words_per_page)
        print(f"\n📋 Generating outline ({num_chapters} chapters)...")

        outline = generate_outline(book.title, num_chapters)
        book.outline = json.dumps(outline)
        book.status  = "generating"
        db.commit()

        total_sections = sum(len(ch["subheadings"]) for ch in outline["chapters"])
        done_sections  = 0
        print(f"✅ Outline done — {total_sections} sections to generate\n")

        # ── STEP 2: Generate Each Section ────────────────────────────────────
        previous_summary     = ""
        segment_order        = 0
        total_words_target   = book.num_pages * book.words_per_page
        words_per_section    = max(300, total_words_target // max(total_sections, 1))
        print(f"   Target: {total_words_target:,} words | {words_per_section} words/section\n")

        for chapter in outline["chapters"]:
            print(f"  📂 Chapter {chapter['chapter_number']}: {chapter['title']}")

            for subheading in chapter["subheadings"]:
                existing = db.query(BookSegment).filter(
                    BookSegment.book_id        == book_id,
                    BookSegment.chapter_number == chapter["chapter_number"],
                    BookSegment.subheading     == subheading,
                    BookSegment.is_complete    == True
                ).first()

                if existing:
                    print(f"    ⏭️  Skipping (already done): {subheading}")
                    previous_summary = existing.content[-500:]
                    segment_order   += 1
                    done_sections   += 1
                    continue

                print(f"    ✍️  Writing: {subheading}  (~{words_per_section} words)")
                content = generate_section(
                    book_title       = book.title,
                    chapter_title    = chapter["title"],
                    subheading       = subheading,
                    previous_summary = previous_summary,
                    word_count       = words_per_section
                )

                segment = BookSegment(
                    book_id        = book_id,
                    chapter_number = chapter["chapter_number"],
                    chapter_title  = chapter["title"],
                    subheading     = subheading,
                    content        = content,
                    segment_order  = segment_order,
                    is_complete    = True
                )
                db.add(segment)
                db.commit()

                previous_summary  = content[-500:]
                segment_order    += 1
                done_sections    += 1

                pct = int((done_sections / total_sections) * 100)
                print(f"    ✅ Done [{pct}%] ({done_sections}/{total_sections})")
                time.sleep(1)   # GPT-4o is faster, shorter delay needed

        # ── STEP 3: Assemble Files ────────────────────────────────────────────
        print(f"\n📦 Assembling PDF and DOCX...")
        book.status = "assembling"
        db.commit()

        segments = db.query(BookSegment).filter(
            BookSegment.book_id == book_id
        ).order_by(BookSegment.segment_order).all()

        from pdf_generator  import generate_pdf
        from docx_generator import generate_docx

        output_dir = os.path.join(os.path.dirname(__file__), "output")
        pdf_path   = generate_pdf(book.title, segments, output_dir)
        docx_path  = generate_docx(book.title, segments, output_dir)

        book.pdf_url  = pdf_path
        book.docx_url = docx_path
        book.status   = "done"
        db.commit()

        print(f"\n🎉 BOOK COMPLETE!")
        print(f"   PDF  → {pdf_path}")
        print(f"   DOCX → {docx_path}")
        return {"pdf": pdf_path, "docx": docx_path}

    except Exception as e:
        book.status = "failed"
        db.commit()
        print(f"\n❌ Agent failed: {e}")
        raise
    finally:
        db.close()