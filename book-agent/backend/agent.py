import json
import time
import sys
import os
import traceback
from typing import Dict, Any

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import Book, BookSegment

# We keep your original imports but we will augment the generation process natively here
from openai_client import generate_outline, generate_section
# pyrefly: ignore [missing-import]
from openai import OpenAI
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"

# ─────────────────────────────────────────────────────────────────────────────
# ADVANCED MULTI-AGENT SWARM PROMPTS (UPGRADED: MEMGPT-STYLE ENTITY GRAPH)
# ─────────────────────────────────────────────────────────────────────────────

CRITIC_SYSTEM_PROMPT = """You are a ruthless, highly experienced Book Editor.
Your job is to review the newly drafted section of a book against the 'Entity Knowledge Graph' (which contains all facts, characters, and timelines established so far) and the intended writing style.

Look for:
1. Plot holes, factual inconsistencies, or character breaks compared to the Entity Knowledge Graph.
2. Repetitive phrasing, weak transitions, or hallucinations.
3. Deviation from the requested writing style.

Output STRICTLY valid JSON with no markdown formatting:
{
    "passed": true/false,
    "critique": "Detailed explanation of what is wrong and how to fix it, or 'perfect' if passed",
    "severity": "low/medium/high"
}
"""

REVISOR_SYSTEM_PROMPT = """You are a Master Author and Revisor.
You will be given a draft of a book section and a harsh critique from the Editor.
Your job is to rewrite the section to flawlessly address the Editor's critique while maintaining the exact requested word count and style.
Do NOT output any conversational text, only the final revised book content.
"""

STORY_BIBLE_PROMPT = """You are an elite Continuity Manager and Knowledge Graph Architect for a large book generation system.
You will be given the current 'Entity Knowledge Graph' (a JSON database of established facts, characters, plot points, and world-building) and a newly written section.

Your job: Extract any NEW permanent facts, character developments, or world-building rules from the new section and seamlessly merge them into the Entity Knowledge Graph.
Update existing characters' statuses, add new locations, and append to the timeline.

You MUST output ONLY a valid JSON object matching this exact structure:
{
    "Core_Premise": "Brief overarching summary of the book",
    "Characters": {
        "Character Name": "Description, motivations, current status, physical traits"
    },
    "Locations": {
        "Location Name": "Description and significance"
    },
    "Timeline": [
        "Event 1: Description",
        "Event 2: Description"
    ]
}
Do NOT wrap the JSON in markdown code blocks.
"""

# ─────────────────────────────────────────────────────────────────────────────
# ADVANCED PIPELINE FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def calculate_chapters(num_pages: int, words_per_page: int) -> int:
    """Calculates optimal chapter breaks based on total volume."""
    total_words = num_pages * words_per_page
    words_per_section = max(words_per_page, 400)
    # A standard chapter is ~4 sections
    words_per_chapter = 4 * words_per_section
    chapters = max(3, total_words // words_per_chapter)
    return min(chapters, 100) # Cap at 100 chapters to prevent runaway generation


def update_story_bible(current_bible: str, new_content: str, book_title: str) -> str:
    """
    Entity Knowledge Graph Engine: Updates the structured JSON memory of the book 
    to prevent AI amnesia and plot holes across 1000+ page generation runs.
    """
    print("    🧠 Updating Continuity Entity Knowledge Graph...")
    try:
        response = client.chat.completions.create(
            model=MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": STORY_BIBLE_PROMPT},
                {"role": "user", "content": f"Book Title: {book_title}\n\nCURRENT KNOWLEDGE GRAPH:\n{current_bible}\n\nNEW SECTION CONTENT:\n{new_content}"}
            ],
            max_tokens=2500,
            temperature=0.2
        )
        updated_bible = response.choices[0].message.content.strip()
        
        # Verify it is valid JSON before returning
        json.loads(updated_bible)
        return updated_bible
    except Exception as e:
        print(f"    ⚠️ Failed to update Entity Knowledge Graph (continuing with old graph): {e}")
        return current_bible


def critique_and_revise(draft: str, story_bible: str, style: str, target_words: int) -> str:
    """
    Multi-Agent Loop: Critic reviews the draft against the JSON Knowledge Graph. 
    If it fails, Revisor rewrites it. Maximum of 2 revision loops to prevent infinite hanging.
    """
    current_draft = draft
    
    for attempt in range(2):
        # --- AGENT 1: THE CRITIC ---
        try:
            critique_response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
                    {"role": "user", "content": f"STYLE: {style}\nENTITY KNOWLEDGE GRAPH:\n{story_bible}\n\nDRAFT TO CRITIQUE:\n{current_draft}"}
                ],
                max_tokens=500,
                temperature=0.2
            )
            raw_critique = critique_response.choices[0].message.content.strip()
            
            # Clean JSON markdown if present
            if raw_critique.startswith("```json"):
                raw_critique = raw_critique[7:-3].strip()
            
            critique_data = json.loads(raw_critique)
            
            if critique_data.get("passed", False):
                if attempt > 0:
                    print("    ✅ Revisor successfully fixed the draft!")
                else:
                    print("    ✅ Critic approved draft on first pass.")
                return current_draft
                
            print(f"    🚨 Critic flagged issues (Attempt {attempt+1}): {critique_data.get('critique')}")
            
        except Exception as e:
            print(f"    ⚠️ Critic agent failed JSON parse, bypassing critique loop: {e}")
            return current_draft
            
        # --- AGENT 2: THE REVISOR ---
        print("    ✍️ Revisor agent rewriting based on critique...")
        try:
            revise_response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": REVISOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"TARGET WORDS: {target_words}\nCRITIQUE TO ADDRESS:\n{critique_data['critique']}\n\nORIGINAL DRAFT:\n{current_draft}"}
                ],
                max_tokens=max(2000, int(target_words * 1.5)),
                temperature=0.7
            )
            current_draft = revise_response.choices[0].message.content.strip()
        except Exception as e:
            print(f"    ⚠️ Revisor agent failed, returning best available draft: {e}")
            return current_draft

    print("    ⚠️ Max revision loops reached. Proceeding with best draft.")
    return current_draft

# ─────────────────────────────────────────────────────────────────────────────
# MAIN EXECUTION ENGINE
# ─────────────────────────────────────────────────────────────────────────────

def run_book_agent(book_id: int):
    db   = SessionLocal()
    book = db.query(Book).filter(Book.id == book_id).first()

    if not book:
        print(f"❌ Book ID {book_id} not found in database.")
        db.close()
        return

    print(f"\n=======================================================")
    print(f"📖 STARTING VELIONYX-GRADE BOOK ENGINE: '{book.title}'")
    print(f"   Pages Target: {book.num_pages} | Words/page: {book.words_per_page}")
    print(f"   Writing Style: {book.writing_style or 'Standard Professional'}")
    print(f"=======================================================\n")

    try:
        # ── STEP 1: Generate Master Outline ───────────────────────────────────
        book.status = "outlining"
        db.commit()

        num_chapters = calculate_chapters(book.num_pages, book.words_per_page)
        print(f"📋 Generating master outline architecture ({num_chapters} chapters)...")

        # Fallback empty string if style is None to prevent OpenAI typing errors
        safe_style = book.writing_style or "Neutral, clear, and engaging."
        
        outline = generate_outline(book.title, num_chapters, writing_style=safe_style)
        book.outline = json.dumps(outline)
        book.status  = "generating"
        db.commit()

        total_sections = sum(len(ch["subheadings"]) for ch in outline["chapters"])
        done_sections  = 0
        print(f"✅ Master Outline established. Total logical blocks to generate: {total_sections}\n")

        # ── STEP 2: Swarm Generation & Continuity Loop ───────────────────────
        # Initialize the Entity Knowledge Graph as a strict JSON structure
        initial_graph = {
            "Core_Premise": f"A book titled '{book.title}' written in the style of: {safe_style}.",
            "Characters": {},
            "Locations": {},
            "Timeline": []
        }
        story_bible          = json.dumps(initial_graph)
        segment_order        = 0
        total_words_target   = book.num_pages * book.words_per_page
        words_per_section    = max(300, total_words_target // max(total_sections, 1))
        
        print(f"🎯 Target Volume: {total_words_target:,} words | Expected ~{words_per_section} words/section\n")

        for chapter in outline["chapters"]:
            print(f"\n📂 INITIATING CHAPTER {chapter['chapter_number']}: {chapter['title']}")
            print(f"-------------------------------------------------------")

            for subheading in chapter["subheadings"]:
                # Idempotency check: allows agent to resume if server crashed
                existing = db.query(BookSegment).filter(
                    BookSegment.book_id        == book_id,
                    BookSegment.chapter_number == chapter["chapter_number"],
                    BookSegment.subheading     == subheading,
                    BookSegment.is_complete    == True
                ).first()

                if existing:
                    print(f"    ⏭️ Skipping (Resuming from DB): {subheading}")
                    # Rapidly rebuild story bible from existing segments to maintain continuity on resume
                    story_bible = update_story_bible(story_bible, existing.content[-800:], book.title)
                    segment_order   += 1
                    done_sections   += 1
                    continue

                print(f"    ✍️  Writer Agent drafting: {subheading} (~{words_per_section} words)")
                
                # We inject the structured JSON story bible into the context for the Writer Agent
                enhanced_context = f"ENTITY KNOWLEDGE GRAPH / CONTINUITY RULES:\n{story_bible}"
                
                raw_draft = generate_section(
                    book_title       = book.title,
                    chapter_title    = chapter["title"],
                    subheading       = subheading,
                    previous_summary = enhanced_context,
                    word_count       = words_per_section,
                    writing_style    = safe_style,
                )

                # Pass to Critic & Revisor Swarm
                final_content = critique_and_revise(
                    draft=raw_draft, 
                    story_bible=story_bible, 
                    style=safe_style, 
                    target_words=words_per_section
                )

                # Save to database
                segment = BookSegment(
                    book_id        = book_id,
                    chapter_number = chapter["chapter_number"],
                    chapter_title  = chapter["title"],
                    subheading     = subheading,
                    content        = final_content,
                    segment_order  = segment_order,
                    is_complete    = True
                )
                db.add(segment)
                db.commit()

                # Update the rolling memory for the next section
                story_bible = update_story_bible(story_bible, final_content, book.title)
                
                segment_order    += 1
                done_sections    += 1

                pct = int((done_sections / total_sections) * 100)
                print(f"    ✅ Section Finalized [{pct}%] ({done_sections}/{total_sections})")
                
                # Dynamic delay to respect API rate limits based on generation size
                time.sleep(1.5)

        # ── STEP 3: Premium Assembly & Formatting ─────────────────────────────
        print(f"\n📦 Assembling Premium Output Files (PDF and DOCX)...")
        book.status = "assembling"
        db.commit()

        segments = db.query(BookSegment).filter(
            BookSegment.book_id == book_id
        ).order_by(BookSegment.segment_order).all()

        from pdf_generator  import generate_pdf
        from docx_generator import generate_docx

        output_dir = os.path.join(os.path.dirname(__file__), "output")
        os.makedirs(output_dir, exist_ok=True)
        
        try:
            pdf_path   = generate_pdf(book.title, segments, output_dir)
            docx_path  = generate_docx(book.title, segments, output_dir)
            
            book.pdf_url  = pdf_path
            book.docx_url = docx_path
            book.status   = "done"
            db.commit()

            print(f"\n🎉 VELIONYX AGENT COMPLETE!")
            print(f"   STANDARD PDF → {pdf_path}")
            print(f"   DOCX         → {docx_path}")
            return {"pdf": pdf_path, "docx": docx_path}
            
        except Exception as assembly_error:
            print(f"\n❌ Assembly failed during PDF/DOCX generation: {assembly_error}")
            traceback.print_exc()
            raise

    except Exception as e:
        book.status = "failed"
        db.commit()
        print(f"\n❌ Core Agent Engine failed: {e}")
        traceback.print_exc()
        raise
    finally:
        db.close()