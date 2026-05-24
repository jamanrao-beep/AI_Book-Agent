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
  writing_style?: string;
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

export interface ErrorDetail {
  original: string;
  corrected: string;
  explanation: string;
}

export interface ProofreadResult {
  job_id: string;
  original_filename: string;
  corrected_text: string;
  grammar_fixes: number;
  punctuation_fixes: number;
  style_suggestions: number;
  corrections_summary: string;
  download_url: string;
  grammar_details: ErrorDetail[];
  punctuation_details: ErrorDetail[];
  style_details: ErrorDetail[];
}

// ─────────────────────────────────────────────
// Types — Cover Designer
// ─────────────────────────────────────────────

export interface CoverPalette {
  bg_top: string;
  bg_bottom: string;
  accent: string;
  title_color: string;
  subtitle_color: string;
  tagline_color: string;
}

export interface CoverConcept {
  title: string;
  subtitle: string;
  tagline: string;
  author_line: string;
  palette: CoverPalette;
  style: string;
  motif: string;
  genre_label: string;
}

export interface CoverFileResult {
  source_filename: string;
  concept: CoverConcept;
}

/** Returned by POST /design-cover */
export interface CoverResult {
  job_id: string;
  mode: "single" | "zip_bundle";
  original_filename: string;
  download_url: string;
  // single mode
  concept?: CoverConcept;
  // zip_bundle mode
  files_processed?: number;
  files?: CoverFileResult[];
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

/** Upload a .txt, .docx, .pdf, .md, .rtf, or .zip file for AI proofreading. */
export const proofreadDocument = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return API.post<ProofreadResult>("/proofread", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
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

// ─────────────────────────────────────────────
// Cover Designer
// ─────────────────────────────────────────────

export const designCover = (
  file: File,
  bookTitle: string = "",
  description: string = "",
  designStyle: string = "",
) => {
  const form = new FormData();
  form.append("file", file);
  form.append("book_title", bookTitle);
  form.append("description", description);
  form.append("design_style", designStyle);
  return API.post<CoverResult>("/design-cover", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
};

export const downloadCoverDoc = (result: CoverResult) => {
  const url = `${API.defaults.baseURL}${result.download_url}`;
  const a = document.createElement("a");
  a.href = url;
  if (result.mode === "zip_bundle") {
    const base = result.original_filename.replace(/\.zip$/i, "");
    a.download = `${base}_covers.zip`;
  } else {
    const ext = result.original_filename.split(".").pop();
    const base = result.original_filename.replace(/\.(pdf|docx)$/i, "");
    a.download = `${base}_with_cover.${ext}`;
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};