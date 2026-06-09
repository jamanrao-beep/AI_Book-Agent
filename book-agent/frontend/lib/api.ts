import axios from "axios";

const API = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  // Large Hindi books are split into many small chunks; each chunk can take
  // ~30–60 s, and a 200-page book may have 20–30 chunks → allow up to 1 hour.
  timeout: 3600000, // 1 hour (was 900 s / 15 min)
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
  language?: string;
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
  /** Chunk numbers (1-based) that failed all 3 attempts and used original text */
  skipped_chunks?: number[];
}

// ─────────────────────────────────────────────
// Types — Cover Designer
// ─────────────────────────────────────────────

export interface CoverPalette {
  bg_top: string;
  bg_bottom: string;
  panel_color: string;   // mid-page text panel background (new)
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
  illustration_shape: string;  // hero shape drawn behind text panel (new)
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

/**
 * Upload a file for proofreading using the two-step approach:
 * 1. POST /proofread/upload  — streams file to server, returns job_id immediately
 * 2. Poll GET /proofread/{job_id}/status every 3 s until stage == "done" | "error"
 *
 * This avoids Railway's 100-second proxy timeout killing large uploads before
 * FastAPI finishes processing them. The upload itself completes quickly;
 * the AI work runs in a background thread on the server.
 */
export const proofreadDocument = (
  file: File,
  onUploadProgress?: (pct: number) => void,
): Promise<{ data: ProofreadResult }> => {
  const form = new FormData();
  form.append("file", file);

  // Step 1: upload file, get job_id back immediately
  const uploadPromise = API.post<{ job_id: string; status: string }>(
    "/proofread/upload",
    form,
    {
      // No Content-Type header — axios sets multipart/form-data + boundary automatically
      timeout: 3600000,
      onUploadProgress: onUploadProgress
        ? (e) => {
          if (e.total) {
            onUploadProgress(Math.round((e.loaded * 100) / e.total));
          }
        }
        : undefined,
    },
  );

  // Step 2: poll /proofread/{job_id}/status until done or error
  return uploadPromise.then(({ data }) => {
    const jobId = data.job_id;
    return new Promise<{ data: ProofreadResult }>((resolve, reject) => {
      // Signal 100% upload so the UI switches to "Analysing…"
      onUploadProgress?.(100);

      const poll = () => {
        API.get<{
          job_id: string;
          stage: string;
          result?: ProofreadResult;
          error?: string;
        }>(`/proofread/${jobId}/status`)
          .then(({ data: status }) => {
            if (status.stage === "done" && status.result) {
              resolve({ data: status.result });
            } else if (status.stage === "error") {
              reject(new Error(status.error ?? "Proofreading failed on the server."));
            } else {
              // Still processing — poll again in 3 seconds
              setTimeout(poll, 3000);
            }
          })
          .catch(reject);
      };

      // First poll after 2 s (small files finish fast)
      setTimeout(poll, 2000);
    });
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
    // No Content-Type header — axios sets multipart/form-data with boundary automatically
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

// ─────────────────────────────────────────────
// Layout Designer
// ─────────────────────────────────────────────

export interface LayoutResult {
  title: string;
  style_name: string;
  chapter_count: number;
  pdf_path: string;
  docx_path: string;
  job_id: string;
  book_type: string;
}

export const designLayout = (
  file: File,
  bookTitle: string = "",
  designInstructions: string = "",
  bookType: string = "",
  visualTemplate: string = "",
  pageWidthMm: number = 127.0,  // Dynamic parameter (Defaults to 5 inches)
  pageHeightMm: number = 203.2, // Dynamic parameter (Defaults to 8 inches)
  onUploadProgress?: (pct: number) => void
) => {
  const form = new FormData();
  form.append("file", file);
  form.append("book_title", bookTitle);
  form.append("design_instructions", designInstructions);
  form.append("book_type", bookType);
  form.append("visual_template", visualTemplate);

  // ── PASS DIMENSIONS DYNAMICALLY TO BACKEND ──
  form.append("page_width_mm", pageWidthMm.toString());
  form.append("page_height_mm", pageHeightMm.toString());

  return API.post<LayoutResult>("/design-layout", form, {
    // No Content-Type header — axios sets multipart/form-data with boundary automatically
    // Large Hindi books are split into many small chunks; each chunk can take
    // ~30–60 s, and a 200-page book may have 20–30 chunks → allow up to 1 hour.
    timeout: 3600000,
    onUploadProgress: onUploadProgress
      ? (e) => {
        if (e.total) {
          onUploadProgress(Math.round((e.loaded * 100) / e.total));
        }
      }
      : undefined,
  });
};

export const downloadLayoutDoc = (jobId: string, ext: "pdf" | "docx") => {
  const url = `${API.defaults.baseURL}/layout/${jobId}/download/${ext}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `layout_${jobId}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};