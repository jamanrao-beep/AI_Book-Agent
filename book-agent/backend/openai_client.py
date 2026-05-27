# pyrefly: ignore [missing-import]
from openai import OpenAI
import os, time, json, unicodedata
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
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
            print(f"  ⚠️  OpenAI attempt {attempt+1}/{retries} failed: {e}")
            time.sleep(3 * (attempt + 1))
    raise Exception("OpenAI API failed after all retries")


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
    end = start + count - 1
    style_note = (
        f"\nThe book should be written in a '{writing_style}' style — "
        "reflect this in chapter titles and subheadings."
        if writing_style else ""
    )
    lang_rules = _language_instruction(title, writing_style)
    prompt = f"""{lang_rules}
You are a professional book author and editor.
Create a detailed outline for a book titled: "{title}"{style_note}
Generate exactly {count} chapters numbered {start} through {end}.
Each chapter must have exactly 4 sub-headings.
Return ONLY valid JSON, no markdown, no explanation, no code fences:
{{
  "chapters": [
    {{
      "chapter_number": {start},
      "title": "Chapter Title Here",
      "subheadings": ["Sub One", "Sub Two", "Sub Three", "Sub Four"]
    }}
  ]
}}"""
    raw = _call(prompt, max_tokens=4096)
    raw = raw.replace("```json", "").replace("```", "").strip()
    s = raw.find("{")
    e = raw.rfind("}") + 1
    if s == -1 or e == 0:
        raise Exception(f"No JSON found in outline batch response (chapters {start}-{end})")
    return json.loads(raw[s:e])


# ── Section generation ────────────────────────────────────────────────────────

def generate_section(
    book_title      : str,
    chapter_title   : str,
    subheading      : str,
    previous_summary: str,
    word_count      : int = 400,
    writing_style   : str = "",
) -> str:
    context = (
        f"The previous section ended with: {previous_summary}"
        if previous_summary else "This is the very first section of the book."
    )
    style_instruction = (
        f"\nWriting style: '{writing_style}' — strictly maintain this tone and style throughout."
        if writing_style else ""
    )
    lang_rules = _language_instruction(book_title, writing_style)
    prompt = f"""{lang_rules}
You are a professional author writing a book titled: "{book_title}"{style_instruction}
Chapter: {chapter_title}
Section: {subheading}
Context: {context}
Write EXACTLY {word_count} words for this section. Count carefully — do not stop early.
- Do NOT repeat the section title or chapter title
- Write flowing, engaging prose paragraphs
- Maintain consistent tone matching the writing style
- No bullet points, pure prose only
- Fill the full {word_count} word requirement
Write only the content:"""
    max_tok = min(4096, int(word_count * 1.6) + 200)
    return _call(prompt, max_tokens=max_tok)