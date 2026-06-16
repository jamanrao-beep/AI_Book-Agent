import json
import time
import sys
import os
import traceback
from datetime import datetime
from typing import Dict, Any

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import Book, BookSegment

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
2. Repetitive phrasing, weak transitions, or hallucinations (any detail NOT present in the Entity Knowledge Graph).
3. Deviation from the requested writing style.

IMPORTANT: Any character, location, scent, object, or event that appears in the draft
but is NOT listed in the Entity Knowledge Graph counts as a hallucination and must be flagged.

Output STRICTLY valid JSON with no markdown formatting:
{
    "passed": true/false,
    "critique": "Detailed explanation of what is wrong and how to fix it, or 'perfect' if passed",
    "severity": "low/medium/high"
}
"""

REVISOR_SYSTEM_PROMPT = """You are a Master Author and Revisor.
You will be given:
- An Entity Knowledge Graph of ALL established facts (characters, locations, events, sensory details).
- A harsh critique from the Editor listing specific problems.
- The original draft that needs fixing.

Your job is to rewrite the section to flawlessly address the Editor's critique while:
1. Maintaining the exact requested word count and style.
2. NEVER introducing any character, location, scent, object, or event not listed in the Entity Knowledge Graph.
3. Reinterpreting any section title creatively within the EXISTING established world if it implies new elements.

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
    "Sensory_Details": {
        "Scents": [],
        "Sounds": [],
        "Textures": [],
        "Visual_Motifs": []
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
    return min(chapters, 100)  # Cap at 100 chapters to prevent runaway generation


def update_story_bible(current_bible: str, new_content: str, book_title: str) -> str:
    """
    Entity Knowledge Graph Engine: Updates the structured JSON memory of the book
    to prevent AI amnesia and plot holes across 1000+ page generation runs.

    Now includes a Sensory_Details field so scents, sounds, and textures are
    tracked explicitly — preventing the Writer from inventing new ones each section.
    """
    print("    🧠 Updating Continuity Entity Knowledge Graph...")
    try:
        response = client.chat.completions.create(
            model=MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": STORY_BIBLE_PROMPT},
                {"role": "user", "content": (
                    f"Book Title: {book_title}\n\n"
                    f"CURRENT KNOWLEDGE GRAPH:\n{current_bible}\n\n"
                    f"NEW SECTION CONTENT:\n{new_content}"
                )}
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
    If it fails, Revisor rewrites it WITH the EKG injected so it cannot hallucinate.

    Changes from v1:
    - MAX_ATTEMPTS raised to 3 (was 2) so Revisor output gets a final Critic check.
    - Revisor now receives story_bible as a hard constraint (was missing entirely).
    - Loop exits before final revision attempt so we don't waste a call on an
      unchecked draft — instead the last Critic run is the gate.
    """
    current_draft = draft
    MAX_ATTEMPTS = 3

    for attempt in range(MAX_ATTEMPTS):

        # ── AGENT 1: THE CRITIC ───────────────────────────────────────────────
        try:
            critique_response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
                    {"role": "user", "content": (
                        f"STYLE: {style}\n"
                        f"ENTITY KNOWLEDGE GRAPH:\n{story_bible}\n\n"
                        f"DRAFT TO CRITIQUE:\n{current_draft}"
                    )}
                ],
                max_tokens=600,
                temperature=0.2
            )
            raw_critique = critique_response.choices[0].message.content.strip()

            # Clean JSON markdown if present
            if raw_critique.startswith("```json"):
                raw_critique = raw_critique[7:-3].strip()

            critique_data = json.loads(raw_critique)

            if critique_data.get("passed", False):
                if attempt == 0:
                    print("    ✅ Critic approved draft on first pass.")
                else:
                    print(f"    ✅ Revisor successfully fixed the draft! (Attempt {attempt})")
                return current_draft

            print(f"    🚨 Critic flagged issues (Attempt {attempt + 1}/{MAX_ATTEMPTS}): {critique_data.get('critique')}")

        except Exception as e:
            print(f"    ⚠️ Critic agent failed JSON parse, bypassing critique loop: {e}")
            return current_draft

        # Don't revise on the final attempt — the Critic just ran and we're out of loops.
        # Return the best draft we have rather than producing an unchecked revision.
        if attempt == MAX_ATTEMPTS - 1:
            break

        # ── AGENT 2: THE REVISOR (now receives story_bible!) ─────────────────
        print(f"    ✍️ Revisor agent rewriting based on critique (Attempt {attempt + 1})...")
        try:
            revise_response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": REVISOR_SYSTEM_PROMPT},
                    {"role": "user", "content": (
                        f"TARGET WORDS: {target_words}\n\n"
                        f"ENTITY KNOWLEDGE GRAPH (STRICT — DO NOT CONTRADICT OR ADD TO THIS):\n"
                        f"{story_bible}\n\n"
                        f"CRITIQUE TO ADDRESS:\n{critique_data['critique']}\n\n"
                        f"ORIGINAL DRAFT:\n{current_draft}"
                    )}
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

        safe_style = book.writing_style or "Neutral, clear, and engaging."

        outline = generate_outline(book.title, num_chapters, writing_style=safe_style)
        book.outline = json.dumps(outline)
        book.status  = "generating"
        db.commit()

        total_sections = sum(len(ch["subheadings"]) for ch in outline["chapters"])
        done_sections  = 0
        print(f"✅ Master Outline established. Total logical blocks to generate: {total_sections}\n")

        # ── STEP 2: Swarm Generation & Continuity Loop ───────────────────────
        # Initialize the Entity Knowledge Graph with Sensory_Details from the start
        # so the Writer has an explicit bucket to respect from section 1.
        initial_graph = {
            "Core_Premise": f"A book titled '{book.title}' written in the style of: {safe_style}.",
            "Characters": {},
            "Locations": {},
            "Sensory_Details": {
                "Scents": [],
                "Sounds": [],
                "Textures": [],
                "Visual_Motifs": []
            },
            "Timeline": []
        }
        story_bible        = json.dumps(initial_graph)
        segment_order      = 0
        total_words_target = book.num_pages * book.words_per_page
        words_per_section  = max(300, total_words_target // max(total_sections, 1))

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
                    story_bible   = update_story_bible(story_bible, existing.content[-800:], book.title)
                    segment_order += 1
                    done_sections += 1
                    continue

                print(f"    ✍️  Writer Agent drafting: {subheading} (~{words_per_section} words)")

                # ── KEY FIX: pass story_bible directly to generate_section ──
                # Previously story_bible was passed as `previous_summary` which
                # framed it as optional backstory. Now it goes through the new
                # `story_bible` parameter which injects it as an absolute constraint
                # block with visual separators and explicit prohibition language.
                raw_draft = generate_section(
                    book_title       = book.title,
                    chapter_title    = chapter["title"],
                    subheading       = subheading,
                    previous_summary = "",   # narrative "what happened before" now comes from EKG Timeline
                    word_count       = words_per_section,
                    writing_style    = safe_style,
                    story_bible      = story_bible,   # ← hard constraint, not soft context
                )

                # Pass to Critic & Revisor Swarm (Revisor now also gets story_bible)
                final_content = critique_and_revise(
                    draft        = raw_draft,
                    story_bible  = story_bible,
                    style        = safe_style,
                    target_words = words_per_section,
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
                book.last_heartbeat = datetime.utcnow()
                db.commit()

                # Check for cancellation signal after every section
                db.refresh(book)
                if book.is_cancelled:
                    print(f"    🛑 Cancellation requested — stopping after section {done_sections}.")
                    book.status = "cancelled"
                    db.commit()
                    return

                # Update the rolling EKG for the next section
                story_bible = update_story_bible(story_bible, final_content, book.title)

                segment_order += 1
                done_sections += 1

                pct = int((done_sections / total_sections) * 100)
                print(f"    ✅ Section Finalized [{pct}%] ({done_sections}/{total_sections})")

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
            pdf_path  = generate_pdf(book.title, segments, output_dir)
            docx_path = generate_docx(book.title, segments, output_dir)

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
        error_str = str(e).lower()

        # Detect OpenAI quota/billing errors and surface a friendly message
        # instead of a raw technical crash. The frontend reads book.status and
        # book.error_message to decide what to show the user.
        if "insufficient_quota" in error_str or "exceeded your current quota" in error_str or "billing" in error_str:
            book.status        = "failed"
            book.error_message = (
                "Oops! It looks like the AI service ran out of credits. "
                "Please try again later or contact support if this keeps happening."
            )
        elif "429" in error_str or "rate limit" in error_str or "too many requests" in error_str:
            book.status        = "failed"
            book.error_message = (
                "The AI service is a bit busy right now. "
                "Please wait a few minutes and try again."
            )
        elif "timeout" in error_str or "timed out" in error_str:
            book.status        = "failed"
            book.error_message = (
                "The AI took too long to respond. "
                "Please try again — it usually works on the next attempt."
            )
        elif "connection" in error_str or "network" in error_str:
            book.status        = "failed"
            book.error_message = (
                "We had trouble reaching the AI service. "
                "Check your internet connection and try again."
            )
        else:
            book.status        = "failed"
            book.error_message = (
                "Something went wrong while generating your book. "
                "Please try again. If the problem continues, contact support."
            )

        db.commit()
        print(f"\n❌ Core Agent Engine failed: {e}")
        traceback.print_exc()
        raise
    finally:
        db.close()