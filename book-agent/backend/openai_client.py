# pyrefly: ignore [missing-import]
from openai import OpenAI
import os, time, json, unicodedata
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=300.0)
MODEL  = "gpt-4o"

# ── Language / script detection ───────────────────────────────────────────────

def detect_language_hint(text: str) -> str:
    """
    Return a short language-hint string so prompts can instruct the model
    to respond in the correct language and script.
    Covers CJK, Arabic, Hebrew, Devanagari, Thai, Cyrillic, Latin, etc.
    """
    scripts = {
        "Arabic":     (0x0600, 0x06FF),
        "Hebrew":     (0x0590, 0x05FF),
        "Devanagari": (0x0900, 0x097F),  # Hindi, Sanskrit, Marathi …
        "Bengali":    (0x0980, 0x09FF),
        "Tamil":      (0x0B80, 0x0BFF),
        "Telugu":     (0x0C00, 0x0C7F),
        "Kannada":    (0x0C80, 0x0CFF),
        "Malayalam":  (0x0D00, 0x0D7F),
        "Thai":       (0x0E00, 0x0E7F),
        "Georgian":   (0x10A0, 0x10FF),
        "Hangul":     (0xAC00, 0xD7AF),  # Korean
        "Hiragana":   (0x3040, 0x309F),  # Japanese
        "Katakana":   (0x30A0, 0x30FF),
        "CJK":        (0x4E00, 0x9FFF),  # Chinese / Japanese kanji
        "Cyrillic":   (0x0400, 0x04FF),  # Russian, Bulgarian …
        "Greek":      (0x0370, 0x03FF),
        "Armenian":   (0x0530, 0x058F),
    }
    counts = {name: 0 for name in scripts}
    for ch in text:
        cp = ord(ch)
        for name, (lo, hi) in scripts.items():
            if lo <= cp <= hi:
                counts[name] += 1
    dominant = max(counts, key=counts.get)
    if counts[dominant] > 0:
        return dominant
    return "Latin"


def _language_instruction(title: str, writing_style: str = "") -> str:
    """
    Build a universal language/script instruction block that tells GPT-4o
    to match the language of the title and produce properly encoded output.
    """
    hint = detect_language_hint(title + " " + writing_style)
    base = (
        "CRITICAL LANGUAGE RULES:\n"
        "1. Detect the primary language of the book title and writing style provided.\n"
        "2. Write ALL output — chapter titles, subheadings, and body text — "
        "in that SAME language and script without switching to English.\n"
        "3. Use only Unicode characters native to that script. "
        "Do NOT transliterate or romanise non-Latin scripts.\n"
        "4. For right-to-left scripts (Arabic, Hebrew, Urdu, etc.) write text "
        "naturally right-to-left as native readers expect.\n"
        "5. Preserve diacritics, tone marks, and special characters exactly "
        "(e.g. Arabic tashkeel, Thai tone marks, Devanagari matras).\n"
    )
    if hint not in ("Latin",):
        base += f"6. The detected script is '{hint}' — confirm your entire response uses this script.\n"
    return base


# ── Core call helper ──────────────────────────────────────────────────────────

def _call(prompt: str, max_tokens: int = 2048, retries: int = 3) -> str:
    """Maintained for legacy compatibility with other pipeline modules."""
    last_error = None
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model       = MODEL,
                messages    = [{"role": "user", "content": prompt}],
                temperature = 0.8,
                max_tokens  = max_tokens,
            )
            text = response.choices[0].message.content.strip()
            # Normalise to NFC so composed forms are used consistently
            return unicodedata.normalize("NFC", text)
        except Exception as e:
            last_error = e
            print(f"  ⚠️  OpenAI attempt {attempt+1}/{retries} failed: {e}")
            time.sleep(3 * (attempt + 1))
    raise Exception(f"OpenAI API failed after all retries: {last_error}") from last_error


# ── Outline generation ────────────────────────────────────────────────────────

def generate_outline(title: str, num_chapters: int, writing_style: str = "") -> dict:
    if num_chapters <= 20:
        return _generate_outline_batch(title, start=1, count=num_chapters, writing_style=writing_style)

    all_chapters = []
    start = 1
    while start <= num_chapters:
        count = min(20, num_chapters - start + 1)
        print(f"    📋 Outline batch: chapters {start}–{start+count-1}")
        batch = _generate_outline_batch(title, start=start, count=count, writing_style=writing_style)
        all_chapters.extend(batch["chapters"])
        start += count
        time.sleep(1)

    return {"chapters": all_chapters}


def _generate_outline_batch(title: str, start: int, count: int, writing_style: str = "") -> dict:
    """
    Generates a deeply structured outline batch.
    Forces strict JSON formatting so the Swarm Agent can parse it flawlessly.
    """
    end = start + count - 1
    lang_rules = _language_instruction(title, writing_style)
    
    prompt = f"""{lang_rules}
You are an elite publishing architect outlining a book.
Book Title: "{title}"
Target Chapters for this batch: {count} (Chapters {start} through {end})
Style/Genre: {writing_style}

Create a highly detailed, compelling outline. Each chapter must have EXACTLY 3 to 5 logical subheadings.
The pacing must make sense for a full-length book.

You MUST respond strictly with valid JSON in this exact format, with no markdown fences:
{{
  "chapters": [
    {{
      "chapter_number": {start},
      "title": "Chapter {start}: Title Here",
      "subheadings": [
        "Setting the Scene",
        "The Inciting Incident",
        "The Immediate Fallout"
      ]
    }}
  ]
}}
"""
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": "You are a master book outliner. Output only raw JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
                max_tokens=4000,
            )
            raw = response.choices[0].message.content.strip()
            return json.loads(raw)
        except Exception as e:
            last_error = e
            print(f"  ⚠️  Outline batch generation attempt {attempt+1} failed: {e}")
            time.sleep(3 * (attempt + 1))

    raise Exception(
        f"Failed to generate structured JSON outline for chapters {start}-{end}: {last_error}"
    ) from last_error


# ── Section generation ────────────────────────────────────────────────────────

def generate_section(
    book_title      : str,
    chapter_title   : str,
    subheading      : str,
    previous_summary: str,
    word_count      : int = 400,
    writing_style   : str = "",
    story_bible     : str = "",   # ← NEW: structured EKG injected as strict rules
) -> str:
    """
    Drafts the actual book content using Premium Bestseller Prose constraints.
    Eliminates passive voice, repetitive AI jargon, and forces 'Show, Don't Tell'.

    story_bible: JSON Entity Knowledge Graph from agent.py. When provided, it is
    injected as a hard constraint block BEFORE the prose directives so the model
    treats it as inviolable rules rather than optional context.
    """
    # ── Build the two context blocks separately so they're clearly distinct ──
    ekg_block = ""
    if story_bible and story_bible.strip():
        ekg_block = f"""
══════════════════════════════════════════════════════
ENTITY KNOWLEDGE GRAPH — ABSOLUTE CONSTRAINTS
You are STRICTLY FORBIDDEN from introducing any character, location, object,
scent, sound, or event that is not already listed in this graph.
If the section title implies a new location or character not in this graph,
reinterpret it creatively within the EXISTING established world.
Do NOT invent new proper nouns, place names, or sensory details that contradict
the descriptions below.

{story_bible}
══════════════════════════════════════════════════════
"""

    narrative_context = (
        f"NARRATIVE CONTINUITY — what happened immediately before this section:\n{previous_summary}"
        if previous_summary else "This is the very first section of the book."
    )

    style_instruction = (
        f"\nTARGET WRITING STYLE: '{writing_style}' — strictly maintain this tone."
        if writing_style else ""
    )

    lang_rules = _language_instruction(book_title, writing_style)

    prompt = f"""{lang_rules}
You are a bestselling author writing a commercial manuscript.
Book: "{book_title}"{style_instruction}
Current Chapter: {chapter_title}
Current Section: {subheading}
{ekg_block}
{narrative_context}

CRITICAL PROSE DIRECTIVES:
1. Write EXACTLY {word_count} words for this section. Do not stop early.
2. SHOW, DON'T TELL. Use strong sensory details, active voice, and dynamic verbs.
3. Avoid generic AI phrasing (e.g., "It is important to note," "In conclusion," "A testament to").
4. Do NOT repeat the section title or chapter title at the top of the text.
5. Write in flowing, engaging prose paragraphs. No bullet points.
6. Seamlessly continue the narrative or argument from the NARRATIVE CONTINUITY above.
7. ONLY use sensory details (scents, textures, sounds, colours) that are consistent
   with the Entity Knowledge Graph above. Do not introduce new ones.

Write only the prose content:"""

    max_toks = max(2048, int(word_count * 1.5) + 200)

    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": (
                        "You are a master author generating premium, publish-ready prose. "
                        "You treat the Entity Knowledge Graph as inviolable law — "
                        "you never introduce facts, characters, or locations not listed there."
                    )},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=max_toks,
            )
            text = response.choices[0].message.content.strip()
            return unicodedata.normalize("NFC", text)
        except Exception as e:
            last_error = e
            print(f"  ⚠️  Section generation attempt {attempt+1} failed: {e}")
            time.sleep(3 * (attempt + 1))

    raise Exception(f"Failed to generate section after all retries: {last_error}") from last_error