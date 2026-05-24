import axios from "axios";

const API = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  timeout: 900000,
});

// ─────────────────────────────────────────────
// Types — Book Writing
// ─────────────────────────────────────────────

export interface BookRequest {
  title: string;
  num_pages: number;
  words_per_page: number;
  user_id?: string;
}

export interface BookStatus {
  book_id: number;
  title: string;
  status: string;
  pages: number;
  pdf_url: string | null;
  docx_url: string | null;
  created_at: string;
}

export interface BookProgress {
  book_id: number;
  status: string;
  completed_segments: number;
}

// ─────────────────────────────────────────────
// Types — Proofreading
// ─────────────────────────────────────────────

export interface ProofreadResult {
  job_id: string;
  original_filename: string;
  corrected_text: string;
  grammar_fixes: number;
  punctuation_fixes: number;
  style_suggestions: number;
  corrections_summary: string;
  download_url: string;
}

// ─────────────────────────────────────────────
// Book Writing
// ─────────────────────────────────────────────

export const generateBook = (data: BookRequest) =>
  API.post<{ book_id: number; status: string }>("/generate-book", data);

export const getBookStatus = (id: number) =>
  API.get<BookStatus>(`/book/${id}/status`);

export const getProgress = (id: number) =>
  API.get<BookProgress>(`/book/${id}/progress`);

export const listBooks = () => API.get<BookStatus[]>("/books");

export const downloadPDF = (id: number) =>
  `${API.defaults.baseURL}/book/${id}/download/pdf`;

export const downloadDOCX = (id: number) =>
  `${API.defaults.baseURL}/book/${id}/download/docx`;

// ─────────────────────────────────────────────
// Proofreading
// ─────────────────────────────────────────────

/** Upload a .txt or .docx file for AI proofreading. */
export const proofreadDocument = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return API.post<ProofreadResult>("/proofread", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000, // proofreading can take longer than default 30s
  });
};

/** Trigger a browser download of the corrected file. */
export const downloadProofreadDoc = (
  jobId: string,
  originalFilename: string,
) => {
  const url = `${API.defaults.baseURL}/proofread/${jobId}/download`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `corrected_${originalFilename}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
