# pyrefly: ignore [missing-import]
from openai import OpenAI
import os, time, json
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL  = "gpt-4o"


def _call(prompt: str, max_tokens: int = 2048, retries: int = 3) -> str:
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model       = MODEL,
                messages    = [{"role": "user", "content": prompt}],
                temperature = 0.8,
                max_tokens  = max_tokens,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"  ⚠️  OpenAI attempt {attempt+1}/{retries} failed: {e}")
            time.sleep(3 * (attempt + 1))
    raise Exception("OpenAI API failed after all retries")


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
    style_note = f"\nThe book should be written in a '{writing_style}' style — reflect this in chapter titles and subheadings." if writing_style else ""
    prompt = f"""You are a professional book author and editor.
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
    style_instruction = ""
    if writing_style:
        style_instruction = f"\nWriting style: '{writing_style}' — strictly maintain this tone and style throughout."

    prompt = f"""You are a professional author writing a book titled: "{book_title}"{style_instruction}
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