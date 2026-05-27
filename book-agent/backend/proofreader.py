"""
proofreader.py
AI-powered proofreading: grammar, punctuation, style improvements.
Reads .txt or .docx, returns corrected text + structured diff summary
WITH detailed per-error lists for each category.
"""
import os
import re
import uuid
import json
import logging
import zipfile
from pathlib import Path
# pyrefly: ignore [missing-import]
import pdfplumber
from typing import Optional
# pyrefly: ignore [missing-import]
from openai import OpenAI
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"

logger = logging.getLogger("editorial_ai")


# ─────────────────────────────────────────────────────────────────────────────
# Text extraction helpers
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_from_txt(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def extract_text_from_docx(path: str) -> str:
    # pyrefly: ignore [missing-import]
    from docx import Document
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_text_from_pdf(path: str) -> str:
    # pyrefly: ignore [missing-import]
    import pdfplumber
    text = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text.append(t)
    return "\n".join(text)


def extract_text_from_rtf(path: str) -> str:
    # pyrefly: ignore [missing-import]
    from striprtf.striprtf import rtf_to_text
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return rtf_to_text(f.read())


def extract_text_from_zip(path: str) -> str:
    """Extract and concatenate all readable text files inside a zip."""
    texts = []
    with zipfile.ZipFile(path, "r") as z:
        for name in z.namelist():
            ext = os.path.splitext(name)[1].lower()
            if ext not in {".txt", ".md", ".docx", ".pdf", ".rtf"}:
                continue
            with z.open(name) as f:
                tmp = os.path.join(os.path.dirname(path), f"zip_extract_{uuid.uuid4().hex}{ext}")
                with open(tmp, "wb") as out:
                    out.write(f.read())
                try:
                    texts.append(f"--- {name} ---\n{extract_text(tmp, name)}")
                finally:
                    if os.path.exists(tmp):
                        os.remove(tmp)
    if not texts:
        raise ValueError("No readable text files found inside the zip.")
    return "\n\n".join(texts)


def extract_text_from_md(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def extract_text(path: str, filename: str) -> str:
    name = filename.lower()
    if name.endswith(".docx"):
        return extract_text_from_docx(path)
    elif name.endswith(".pdf"):
        return extract_text_from_pdf(path)
    elif name.endswith(".rtf"):
        return extract_text_from_rtf(path)
    elif name.endswith(".zip"):
        return extract_text_from_zip(path)
    elif name.endswith(".md"):
        return extract_text_from_md(path)
    # Fallback: try as plain text (covers .txt, .text, any unknown text format)
    return extract_text_from_txt(path)


# ─────────────────────────────────────────────────────────────────────────────
# JSON parsing helper — robust against markdown fences, leading text, truncation
# ─────────────────────────────────────────────────────────────────────────────

def _parse_json_response(raw: str, context: str = "") -> dict:
    """
    Robustly extract a JSON object from an OpenAI response string.

    Handles:
    - Markdown code fences (```json ... ```) anywhere in the string
    - Leading/trailing prose before or after the JSON block
    - Truncated JSON (attempts partial recovery)

    Raises ValueError with a clear message if nothing works.
    """
    cleaned = raw.strip()

    # ── Step 1: try to pull content out of a markdown fence if one exists ──
    # This handles cases where GPT adds preamble like:
    #   "Sure! Here is the JSON:\n```json\n{...}\n```"
    fence_match = re.search(r"```(?:json)?\s*\n?([\s\S]*?)(?:```|$)", cleaned, re.IGNORECASE)
    if fence_match:
        candidate = fence_match.group(1).strip()
        # Only use the fence content if it actually starts with a JSON object
        if candidate.startswith("{"):
            cleaned = candidate

    # ── Step 2: strip any remaining leading/trailing markdown fences (belt & braces) ──
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    # ── Step 3: find the outermost { ... } ──
    start = cleaned.find("{")
    if start == -1:
        logger.error(
            "No JSON object found in AI response%s. Raw (first 500): %s",
            f" ({context})" if context else "", raw[:500],
        )
        raise ValueError(
            f"No JSON in AI response{f' for {context}' if context else ''}. "
            f"Raw response starts with: {raw[:200]!r}"
        )

    end = cleaned.rfind("}")
    if end == -1 or end <= start:
        logger.error(
            "JSON object not closed in AI response%s. Raw (first 500): %s",
            f" ({context})" if context else "", raw[:500],
        )
        raise ValueError(
            f"JSON object not properly closed in AI response"
            f"{f' for {context}' if context else ''}."
        )

    json_str = cleaned[start:end + 1]

    # ── Step 4: attempt normal parse ──
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        # ── Step 5: last-ditch recovery — close open brackets/braces ──
        logger.warning(
            "JSON parse error%s (%s) — attempting recovery",
            f" ({context})" if context else "", e,
        )
        try:
            fixed = json_str
            # If the last char is a comma or colon, trim it
            fixed = re.sub(r'[,:\s]+$', '', fixed)
            # Count unclosed braces and brackets and close them
            open_braces   = fixed.count("{") - fixed.count("}")
            open_brackets = fixed.count("[") - fixed.count("]")
            fixed += "]" * max(open_brackets, 0)
            fixed += "}" * max(open_braces, 0)
            return json.loads(fixed)
        except Exception:
            logger.error(
                "JSON recovery failed%s. Raw (first 500): %s",
                f" ({context})" if context else "", raw[:500],
            )
            raise ValueError(
                f"Could not parse JSON from AI response{f' for {context}' if context else ''}. "
                f"Parse error: {e}. Raw starts with: {raw[:200]!r}"
            )


# ─────────────────────────────────────────────────────────────────────────────
# AI proofreading — system prompt
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert editor and proofreader. When given a document, you:
1. Fix all grammar and spelling errors
2. Correct punctuation (commas, semicolons, apostrophes, quotation marks, etc.)
3. Improve style and readability: simplify overly complex sentences, improve flow, remove redundancy
4. Preserve the author's voice and meaning

Respond with ONLY valid JSON (no markdown, no code fences, no preamble). Structure:
{
  "corrected_text": "<the fully corrected document text>",
  "grammar_fixes": <integer count>,
  "punctuation_fixes": <integer count>,
  "style_suggestions": <integer count>,
  "corrections_summary": "<3-5 sentence narrative summary of what was changed and why>",
  "grammar_details": [
    {
      "original": "<the original incorrect text snippet (max ~15 words)>",
      "corrected": "<the corrected version>",
      "explanation": "<brief explanation>"
    }
  ],
  "punctuation_details": [
    {
      "original": "<the original text snippet with punctuation error>",
      "corrected": "<the corrected version>",
      "explanation": "<brief explanation>"
    }
  ],
  "style_details": [
    {
      "original": "<the original wordy or unclear text>",
      "corrected": "<the improved version>",
      "explanation": "<brief explanation>"
    }
  ]
}

For each category, list up to 20 of the most significant issues. Keep snippets short (max 15 words each).
IMPORTANT: Output ONLY the raw JSON object. Do not wrap it in markdown. Do not add any text before or after."""


# ─────────────────────────────────────────────────────────────────────────────
# Selective correction system prompt
# ─────────────────────────────────────────────────────────────────────────────

def _build_selective_system_prompt(apply_grammar: bool, apply_punctuation: bool, apply_style: bool) -> str:
    tasks = []
    if apply_grammar:
        tasks.append("Fix all grammar and spelling errors")
    if apply_punctuation:
        tasks.append("Correct punctuation (commas, semicolons, apostrophes, quotation marks, etc.)")
    if apply_style:
        tasks.append("Improve style and readability: simplify overly complex sentences, improve flow, remove redundancy")

    task_list = "\n".join(f"{i+1}. {t}" for i, t in enumerate(tasks))

    skipped = []
    if not apply_grammar:
        skipped.append("grammar/spelling errors (leave them as-is)")
    if not apply_punctuation:
        skipped.append("punctuation issues (leave them as-is)")
    if not apply_style:
        skipped.append("style/readability (leave as-is)")

    skip_note = ""
    if skipped:
        skip_note = f"\n\nIMPORTANT: Do NOT fix {', '.join(skipped)}. Only apply the correction types listed above."

    return f"""You are an expert editor and proofreader. When given a document, you:
{task_list}
4. Preserve the author's voice and meaning{skip_note}

Respond with ONLY valid JSON (no markdown, no code fences, no preamble). Structure:
{{
  "corrected_text": "<the corrected document text with ONLY the selected fix types applied>"
}}
IMPORTANT: Output ONLY the raw JSON object. Do not wrap it in markdown. Do not add any text before or after."""


# ─────────────────────────────────────────────────────────────────────────────
# Chunking helper
# ─────────────────────────────────────────────────────────────────────────────

def _chunk_text(text: str, max_chars: int = 50000) -> list[str]:
    """Split long documents into chunks so we stay within token limits."""
    if len(text) <= max_chars:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            newline = text.rfind("\n\n", start, end)
            if newline > start:
                end = newline
        chunks.append(text[start:end])
        start = end
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# OpenAI call with retry
# ─────────────────────────────────────────────────────────────────────────────

def _call_openai_with_retry(
    messages: list[dict],
    context: str,
    max_retries: int = 2,
    use_json_mode: bool = True,
) -> dict:
    """
    Call the OpenAI API and parse the JSON response.

    Key improvements over the original:
    - Uses response_format={"type": "json_object"} when use_json_mode=True.
      This forces GPT-4o to always return a valid JSON object — no markdown
      fences, no preamble. The model requires the word "json" to appear
      somewhere in the messages for this mode, which our system prompts satisfy.
    - max_tokens bumped to 16000 to avoid truncation on longer chunks.
    - Retries up to max_retries times on JSON parse failures.
    - Raises RuntimeError (→ HTTP 500) after all retries are exhausted.
    """
    last_error = None

    for attempt in range(1, max_retries + 2):  # +2 so range gives max_retries+1 attempts
        try:
            kwargs: dict = {
                "model": MODEL,
                "messages": messages,
                "temperature": 0.3,
                "max_tokens": 16000,  # raised from 4096 to avoid mid-JSON truncation
            }

            # json_object mode guarantees a parseable JSON response from GPT-4o.
            # Falls back gracefully if the model doesn't support it.
            if use_json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            response = client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content or ""
            logger.info(
                "OpenAI response received for %s (attempt %d), length=%d",
                context, attempt, len(raw),
            )
            return _parse_json_response(raw, context)

        except ValueError as e:
            last_error = e
            logger.warning(
                "Attempt %d/%d failed for %s: %s",
                attempt, max_retries + 1, context, e,
            )
            if attempt <= max_retries:
                # Append a correction nudge and retry
                messages = messages + [{
                    "role": "user",
                    "content": (
                        "Your previous response was not valid JSON. "
                        "Please respond with ONLY a raw JSON object, "
                        "no markdown, no code fences, no extra text."
                    ),
                }]

        except Exception as e:
            last_error = e
            logger.error(
                "OpenAI API call failed for %s (attempt %d): %s",
                context, attempt, e,
            )
            if attempt <= max_retries:
                continue

    # All retries exhausted — raise so the endpoint returns a proper 500
    raise RuntimeError(
        f"OpenAI did not return valid JSON after {max_retries + 1} attempts "
        f"for {context}: {last_error}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Main proofreading entry point
# ─────────────────────────────────────────────────────────────────────────────

def proofread_text(text: str) -> dict:
    """Run AI proofreading on text. Handles long documents by chunking."""
    chunks = _chunk_text(text)
    logger.info("Proofreading %d chunk(s), total chars=%d", len(chunks), len(text))

    all_corrected = []
    total_grammar = 0
    total_punct = 0
    total_style = 0
    summaries = []
    all_grammar_details: list = []
    all_punctuation_details: list = []
    all_style_details: list = []

    for i, chunk in enumerate(chunks):
        context = f"chunk {i+1}/{len(chunks)}"
        prompt = f"Proofread the following document{f' ({context})' if len(chunks) > 1 else ''}:\n\n{chunk}"
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        data = _call_openai_with_retry(messages, context)

        all_corrected.append(data.get("corrected_text", chunk))
        total_grammar += int(data.get("grammar_fixes", 0))
        total_punct   += int(data.get("punctuation_fixes", 0))
        total_style   += int(data.get("style_suggestions", 0))
        summaries.append(data.get("corrections_summary", ""))
        all_grammar_details.extend(data.get("grammar_details", []))
        all_punctuation_details.extend(data.get("punctuation_details", []))
        all_style_details.extend(data.get("style_details", []))

    combined_summary = " ".join(s for s in summaries if s)
    if len(summaries) > 1:
        combined_summary = f"Document processed in {len(summaries)} parts. " + combined_summary

    return {
        "corrected_text": "\n\n".join(all_corrected),
        "grammar_fixes": total_grammar,
        "punctuation_fixes": total_punct,
        "style_suggestions": total_style,
        "corrections_summary": combined_summary,
        "grammar_details": all_grammar_details[:20],
        "punctuation_details": all_punctuation_details[:20],
        "style_details": all_style_details[:20],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Selective correction
# ─────────────────────────────────────────────────────────────────────────────

def apply_selective_corrections(
    original_text: str,
    apply_grammar: bool = True,
    apply_punctuation: bool = True,
    apply_style: bool = True,
) -> str:
    """
    Re-run AI proofreading on original_text applying only the selected
    correction categories. Returns the selectively corrected text.
    """
    if not any([apply_grammar, apply_punctuation, apply_style]):
        return original_text

    system_prompt = _build_selective_system_prompt(apply_grammar, apply_punctuation, apply_style)
    chunks = _chunk_text(original_text)
    all_corrected = []

    for i, chunk in enumerate(chunks):
        context = f"selective chunk {i+1}/{len(chunks)}"
        prompt = f"Apply the requested corrections to the following document{f' ({context})' if len(chunks) > 1 else ''}:\n\n{chunk}"
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        try:
            data = _call_openai_with_retry(messages, context)
            all_corrected.append(data.get("corrected_text", chunk))
        except Exception as e:
            logger.error(
                "Selective correction failed for %s: %s — using original chunk",
                context, e,
            )
            all_corrected.append(chunk)

    return "\n\n".join(all_corrected)


# ─────────────────────────────────────────────────────────────────────────────
# Save corrected file helpers
# ─────────────────────────────────────────────────────────────────────────────

def save_corrected_docx(corrected_text: str, output_path: str, original_title: str = "Corrected Document"):
    # pyrefly: ignore [missing-import]
    from docx import Document
    # pyrefly: ignore [missing-import]
    from docx.shared import Pt
    # pyrefly: ignore [missing-import]
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    doc = Document()

    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)

    title_para = doc.add_heading(original_title, level=1)
    title_para.alignment = WD_ALIGN_PARAGRAPH.LEFT

    doc.add_paragraph("Proofread and corrected by Editorial AI").italic = True
    doc.add_paragraph()

    for para_text in corrected_text.split("\n"):
        para_text = para_text.strip()
        if para_text:
            p = doc.add_paragraph(para_text)
            p.paragraph_format.space_after = Pt(6)

    doc.save(output_path)
    return output_path


def save_corrected_txt(corrected_text: str, output_path: str):
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(corrected_text)
    return output_path


def save_corrected_pdf(
    corrected_text: str,
    output_path: str,
    original_title: str = "Corrected Document",
    apply_grammar: bool = True,
    apply_punctuation: bool = True,
    apply_style: bool = True,
) -> str:
    """
    Generate a styled PDF from corrected_text using reportlab.
    Supports Unicode (Devanagari, Arabic, CJK, etc.) via Noto/FreeFont TTFs.
    """
    # pyrefly: ignore [missing-import]
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
    )
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # ── Register Unicode fonts (idempotent) ───────────────────────────────────
    _UNICODE_FONTS = {
        "NotoSans":            "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "NotoSans-Bold":       "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        "NotoSansDevanagari":  "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
        "FreeSerif":           "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
        "FreeSans":            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "DejaVuSans":          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "DejaVuSans-Bold":     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    }
    registered_unicode_font = None
    for fname, fpath in _UNICODE_FONTS.items():
        if os.path.exists(fpath):
            try:
                pdfmetrics.registerFont(TTFont(fname, fpath))
                if registered_unicode_font is None:
                    registered_unicode_font = fname
            except Exception:
                pass

    # Detect if text contains non-Latin characters
    has_non_latin = any(ord(c) > 0x024F for c in corrected_text if not c.isspace())

    # Choose fonts: use Unicode-capable font if non-Latin detected
    if has_non_latin and registered_unicode_font:
        body_font      = registered_unicode_font
        bold_font      = registered_unicode_font + "-Bold" if (registered_unicode_font + "-Bold") in _UNICODE_FONTS else registered_unicode_font
        # Verify bold variant was registered
        try:
            pdfmetrics.getFont(bold_font)
        except Exception:
            bold_font = body_font
    else:
        body_font = "Helvetica"
        bold_font = "Helvetica-Bold"

    PAGE_W, PAGE_H = A4
    MARGIN = 22 * mm

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
    )

    title_style = ParagraphStyle(
        "DocTitle",
        fontSize=22,
        leading=28,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=4,
        fontName=bold_font,
        wordWrap="CJK" if has_non_latin else "LTR",
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=2,
        fontName=body_font,
    )
    badge_style = ParagraphStyle(
        "Badge",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#10b981"),
        fontName=bold_font,
        spaceAfter=0,
    )
    body_style = ParagraphStyle(
        "DocBody",
        fontSize=11,
        leading=18,
        textColor=colors.HexColor("#1e293b"),
        fontName=body_font,
        spaceAfter=8,
        spaceBefore=0,
        alignment=TA_JUSTIFY,
        wordWrap="CJK" if has_non_latin else "LTR",
    )

    applied = []
    if apply_grammar:      applied.append("Grammar")
    if apply_punctuation:  applied.append("Punctuation")
    if apply_style:        applied.append("Style")
    applied_str = " · ".join(applied) if applied else "No corrections"

    story = []
    safe_title = original_title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    story.append(Paragraph(safe_title, title_style))
    story.append(Paragraph("Proofread and corrected by Editorial AI", subtitle_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"Corrections applied: {applied_str}", badge_style))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e2e8f0"), spaceAfter=14))

    for para_text in corrected_text.split("\n"):
        para_text = para_text.strip()
        if para_text:
            safe = (
                para_text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            story.append(Paragraph(safe, body_style))
        else:
            story.append(Spacer(1, 6))

    doc.build(story)
    return output_path