"""
proofreader.py
AI-powered proofreading: grammar, punctuation, style improvements.
Reads .txt or .docx, returns corrected text + structured diff summary.
"""
import os
import re
import uuid
import json
import tempfile
from pathlib import Path
from typing import Optional
# pyrefly: ignore [missing-import]
from openai import OpenAI
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"


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


def extract_text(path: str, filename: str) -> str:
    if filename.lower().endswith(".docx"):
        return extract_text_from_docx(path)
    return extract_text_from_txt(path)


# ─────────────────────────────────────────────────────────────────────────────
# AI proofreading
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert editor and proofreader. When given a document, you:
1. Fix all grammar and spelling errors
2. Correct punctuation (commas, semicolons, apostrophes, quotation marks, etc.)
3. Improve style and readability: simplify overly complex sentences, improve flow, remove redundancy
4. Preserve the author's voice and meaning

Respond with ONLY valid JSON (no markdown, no code fences). Structure:
{
  "corrected_text": "<the fully corrected document text>",
  "grammar_fixes": <integer count>,
  "punctuation_fixes": <integer count>,
  "style_suggestions": <integer count>,
  "corrections_summary": "<3-5 sentence narrative summary of what was changed and why>"
}"""


def _chunk_text(text: str, max_chars: int = 12000) -> list[str]:
    """Split long documents into overlapping chunks so we stay within token limits."""
    if len(text) <= max_chars:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        # Try to break at a paragraph boundary
        if end < len(text):
            newline = text.rfind("\n\n", start, end)
            if newline > start:
                end = newline
        chunks.append(text[start:end])
        start = end
    return chunks


def proofread_text(text: str) -> dict:
    """Run AI proofreading on text. Handles long documents by chunking."""
    chunks = _chunk_text(text)

    all_corrected = []
    total_grammar = 0
    total_punct = 0
    total_style = 0
    summaries = []

    for i, chunk in enumerate(chunks):
        prompt = f"Proofread the following document{f' (part {i+1}/{len(chunks)})' if len(chunks) > 1 else ''}:\n\n{chunk}"
        
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
        )

        raw = response.choices[0].message.content.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        # Extract JSON
        s = raw.find("{")
        e = raw.rfind("}") + 1
        if s == -1 or e == 0:
            raise ValueError(f"No JSON in AI response for chunk {i+1}")
        
        data = json.loads(raw[s:e])
        all_corrected.append(data.get("corrected_text", chunk))
        total_grammar += int(data.get("grammar_fixes", 0))
        total_punct += int(data.get("punctuation_fixes", 0))
        total_style += int(data.get("style_suggestions", 0))
        summaries.append(data.get("corrections_summary", ""))

    combined_summary = " ".join(s for s in summaries if s)
    if len(summaries) > 1:
        combined_summary = f"Document processed in {len(summaries)} parts. " + combined_summary

    return {
        "corrected_text": "\n\n".join(all_corrected),
        "grammar_fixes": total_grammar,
        "punctuation_fixes": total_punct,
        "style_suggestions": total_style,
        "corrections_summary": combined_summary,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Save corrected file
# ─────────────────────────────────────────────────────────────────────────────

def save_corrected_docx(corrected_text: str, output_path: str, original_title: str = "Corrected Document"):
    # pyrefly: ignore [missing-import]
    from docx import Document
    # pyrefly: ignore [missing-import]
    from docx.shared import Pt
    # pyrefly: ignore [missing-import]
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    doc = Document()
    section = doc.sections[0]

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
