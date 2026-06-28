import json
import time
import sys
import os
import traceback
import concurrent.futures
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
MODEL      = "gpt-4o"        # used for Writer + Revisor — needs real prose quality
FAST_MODEL = "gpt-4o-mini"   # used for Critic + EKG updates — structured JSON, no prose needed

# ── Speed tuning ──────────────────────────────────────────────────────────────
# How many sections within the SAME chapter generate concurrently. All sections
# in a chapter share the same Entity Knowledge Graph snapshot (taken at the
# start of the chapter) and the EKG is updated once per chapter (not per
# section) — see the chapter loop below. Raise this if your OpenAI rate limit
# tier can handle more concurrent requests; lower it if you start seeing 429s.
CHAPTER_PARALLEL_WORKERS = 4

# ─────────────────────────────────────────────────────────────────────────────
# ADVANCED MULTI-AGENT SWARM PROMPTS (UPGRADED: MEMGPT-STYLE ENTITY GRAPH)
# ─────────────────────────────────────────────────────────────────────────────

CRITIC_SYSTEM_PROMPT = """You are a highly experienced Book Editor reviewing a draft section.

The Entity Knowledge Graph contains FACTUAL CONSTRAINTS only — character names, location names,
established timeline events, and explicitly listed sensory details (specific scents, sounds, textures).

YOU MUST FLAG (these are real problems):
1. Wrong character names, traits, or motivations vs the Entity Knowledge Graph.
2. Wrong location names or descriptions vs the Entity Knowledge Graph.
3. New proper nouns (character names, place names) introduced that are NOT in the Entity Knowledge Graph.
4. Sensory details that DIRECTLY CONTRADICT the EKG (e.g. EKG says jasmine, draft says roses).
5. Events that contradict the established timeline.
6. Severely repetitive phrasing or broken narrative flow.

YOU MUST NOT FLAG (these are acceptable and expected in good prose):
- General metaphors, similes, or poetic imagery that do not contradict any established fact.
- Descriptive phrases and figurative language (e.g. "whispers of the divine", "tapestry of grace").
- New adjectives or emotional descriptions that don't introduce new proper nouns.
- Stylistic flourishes consistent with the writing style, even if not in the EKG.
- Minor embellishments that add colour without contradicting established facts.

Be a fair, professional editor — not a pedantic fact-checker of every metaphor.
Only flag things that would genuinely confuse or mislead a reader about established facts.

Output STRICTLY valid JSON with no markdown formatting:
{
    "passed": true/false,
    "critique": "List only genuine factual contradictions, or 'Approved' if passed",
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

Your job: Extract any NEW permanent facts, character developments, or world-building rules from the new content and seamlessly merge them into the Entity Knowledge Graph.
Update existing characters' statuses, add new locations, and append to the timeline.

IMPORTANT — keep the graph bounded as the book grows:
- Keep every Character/Location description to 1-2 concise sentences. Edit existing
  descriptions in place rather than appending more sentences to them over time.
- If "Timeline" already has more than 25 entries, COMPRESS the oldest ones into a single
  short summary entry (e.g. "Earlier: <one-line recap>") before appending new events, so the
  list never grows without bound.
- Do not repeat information that's already captured elsewhere in the graph.
- The output must comfortably fit in a few thousand tokens no matter how long the book is.

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
            model=FAST_MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": STORY_BIBLE_PROMPT},
                {"role": "user", "content": (
                    f"Book Title: {book_title}\n\n"
                    f"CURRENT KNOWLEDGE GRAPH:\n{current_bible}\n\n"
                    f"NEW SECTION CONTENT:\n{new_content}"
                )}
            ],
            max_tokens=4096,
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
                model=FAST_MODEL,
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

            # Low severity = minor stylistic nitpicks, not real factual errors.
            # Skip the Revisor entirely — the draft is good enough to proceed.
            if critique_data.get("severity") == "low":
                print(f"    ℹ️ Low severity notes only — proceeding without revision.")
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


def _generate_one_section(
    book_title: str,
    chapter_title: str,
    subheading: str,
    story_bible: str,
    safe_style: str,
    words_per_section: int,
) -> str:
    """
    Runs the Writer → Critic/Revisor pipeline for ONE section. Pure function —
    touches no database session — so it's safe to call from multiple threads
    at once when several sections of the same chapter are drafted in parallel.
    The caller is responsible for persisting the returned content.
    """
    raw_draft = generate_section(
        book_title       = book_title,
        chapter_title    = chapter_title,
        subheading       = subheading,
        previous_summary = "",
        word_count       = words_per_section,
        writing_style    = safe_style,
        story_bible      = story_bible,
    )
    return critique_and_revise(
        draft        = raw_draft,
        story_bible  = story_bible,
        style        = safe_style,
        target_words = words_per_section,
    )


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

    # RESUME FIX: this function also runs when /book/{id}/resume retries a
    # failed/cancelled job. Clear stale failure state from the last attempt
    # before doing anything else.
    book.is_cancelled  = False
    book.error_message = None
    db.commit()

    print(f"\n=======================================================")
    print(f"📖 STARTING VELIONYX-GRADE BOOK ENGINE: '{book.title}'")
    print(f"   Pages Target: {book.num_pages} | Words/page: {book.words_per_page}")
    print(f"   Writing Style: {book.writing_style or 'Standard Professional'}")
    print(f"=======================================================\n")

    try:
        safe_style = book.writing_style or "Neutral, clear, and engaging."

        # ── STEP 1: Master Outline ────────────────────────────────────────────
        # RESUME FIX: reuse a previously saved outline instead of generating a
        # new one. Regenerating would almost never reproduce the exact same
        # chapter titles/subheadings, which breaks the "skip already-done
        # sections" matching below — you'd end up with the old segments AND a
        # second, different set of new segments both saved under the same book.
        if book.outline:
            outline = json.loads(book.outline)
            print("📋 Found a saved outline for this book — resuming with it instead of regenerating.")
        else:
            book.status = "outlining"
            db.commit()
            num_chapters = calculate_chapters(book.num_pages, book.words_per_page)
            print(f"📋 Generating master outline architecture ({num_chapters} chapters)...")
            outline = generate_outline(book.title, num_chapters, writing_style=safe_style)
            book.outline = json.dumps(outline)
            db.commit()

        total_sections = sum(len(ch["subheadings"]) for ch in outline["chapters"])

        # Count what's already saved (non-zero on a resumed run) so progress
        # reporting is correct immediately, not just after the next section lands.
        done_sections = db.query(BookSegment).filter(
            BookSegment.book_id     == book_id,
            BookSegment.is_complete == True,
        ).count()

        book.status         = "generating"
        book.total_sections = total_sections
        db.commit()

        print(f"✅ Master Outline established. Total logical blocks: {total_sections} (already done: {done_sections})\n")

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

            # Split this chapter's subheadings into "already saved" (resume)
            # vs "still needs writing", up front.
            pending_subheadings    = []
            existing_chapter_tails = []
            for subheading in chapter["subheadings"]:
                existing = db.query(BookSegment).filter(
                    BookSegment.book_id        == book_id,
                    BookSegment.chapter_number == chapter["chapter_number"],
                    BookSegment.subheading     == subheading,
                    BookSegment.is_complete    == True
                ).first()

                if existing:
                    print(f"    ⏭️ Skipping (already generated): {subheading}")
                    segment_order += 1
                    existing_chapter_tails.append(existing.content[-800:])
                else:
                    pending_subheadings.append(subheading)

            if not pending_subheadings:
                # Whole chapter already done from a previous run — still walk
                # the EKG forward through it so later chapters stay consistent.
                if existing_chapter_tails:
                    story_bible = update_story_bible(
                        story_bible, "\n\n".join(existing_chapter_tails), book.title
                    )
                continue

            # ── PARALLEL WRITER + CRITIC/REVISOR PASS ────────────────────────
            # Every pending section in this chapter shares the SAME story_bible
            # snapshot, taken once right here before any of them run. That's
            # safe because sections within one chapter don't invalidate each
            # other's facts — the EKG only advances once, after the whole
            # chapter lands (see below), instead of after every section.
            chapter_bible_snapshot = story_bible
            workers = min(CHAPTER_PARALLEL_WORKERS, len(pending_subheadings))
            print(f"    🚀 Drafting {len(pending_subheadings)} section(s), up to {workers} in parallel...")

            results: Dict[str, Any] = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
                future_to_subheading = {
                    pool.submit(
                        _generate_one_section,
                        book.title,
                        chapter["title"],
                        subheading,
                        chapter_bible_snapshot,
                        safe_style,
                        words_per_section,
                    ): subheading
                    for subheading in pending_subheadings
                }
                for future in concurrent.futures.as_completed(future_to_subheading):
                    subheading = future_to_subheading[future]
                    try:
                        results[subheading] = future.result()
                        print(f"    ✅ Draft + review done: {subheading}")
                    except Exception as e:
                        # One bad section shouldn't cost you the others you
                        # already paid for — record the failure and keep going.
                        print(f"    ❌ Section failed after retries: {subheading} — {e}")
                        results[subheading] = None

            # Persist in original subheading order so reading order / segment_order
            # stay stable no matter which thread finished first.
            chapter_new_content = []
            any_failed           = False
            for subheading in pending_subheadings:
                content = results.get(subheading)
                if content is None:
                    any_failed = True
                    continue

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
                segment_order += 1
                done_sections += 1
                chapter_new_content.append(content)

            book.last_heartbeat = datetime.utcnow()
            db.commit()

            pct = int((done_sections / total_sections) * 100)
            print(f"    📊 Chapter progress saved [{pct}%] ({done_sections}/{total_sections})")

            # Check for cancellation once per chapter (still responsive — just
            # no longer a DB round-trip after every single section).
            db.refresh(book)
            if book.is_cancelled:
                print(f"    🛑 Cancellation requested — stopping after chapter {chapter['chapter_number']}.")
                book.status = "cancelled"
                db.commit()
                return

            # ── ONE EKG update for the whole chapter (was: one per section) ──
            # Cuts EKG calls ~3-5x and removes the single biggest source of the
            # "Unterminated string" truncation errors from earlier runs.
            if chapter_new_content:
                story_bible = update_story_bible(
                    story_bible, "\n\n".join(chapter_new_content), book.title
                )

            if any_failed:
                # Fail loudly AFTER saving the sections that did succeed, so a
                # retry via /book/{id}/resume only has to redo what's missing.
                raise Exception(
                    f"One or more sections in chapter {chapter['chapter_number']} failed "
                    f"after retries. Resume this book to pick up exactly where it left off."
                )

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
        # Walk the exception chain (cause) too, in case any layer wraps the
        # original OpenAI error without including its text in str(e).
        parts = []
        cur = e
        seen = set()
        while cur is not None and id(cur) not in seen:
            seen.add(id(cur))
            parts.append(str(cur))
            cur = cur.__cause__
        error_str = " | ".join(parts).lower()

        # Detect OpenAI quota/billing errors and surface a friendly message
        # instead of a raw technical crash. The frontend reads book.status and
        # book.error_message to decide what to show the user.
        # Deliberate partial-failure raised above when a chapter has one or
        # more sections that failed after retries — progress IS saved, so
        # point the user at Resume instead of a generic "something broke".
        if "resume this book" in error_str:
            book.status        = "failed"
            book.error_message = (
                "Most of your book generated successfully, but a few sections hit an error. "
                "Your progress has been saved — click Resume to pick up exactly where it left off "
                "instead of starting over."
            )
        elif "insufficient_quota" in error_str or "exceeded your current quota" in error_str or "billing" in error_str:
            book.status        = "failed"
            book.error_message = (
                "We're sorry — the AI service has temporarily run out of available credits. "
                "Please try again later, or contact support if the issue persists."
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