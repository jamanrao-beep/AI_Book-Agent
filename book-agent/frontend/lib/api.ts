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
  /** Not returned by the status endpoint — fetch via downloadProofreadDoc() instead.
   *  Omitting corrected_text from the poll response is the fix for Railway's
   *  response-size limit (Bug A) and gzip mid-stream corruption (Bug C). */
  corrected_text?: string;
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
  onChunkProgress?: (done: number, total: number) => void,
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

      // BUG D fix: use a short per-poll timeout so a single dropped connection
      // doesn't stall the entire job. Railway silently closes sockets on large
      // responses; axios reports ERR_NETWORK immediately (not a timeout), so we
      // catch it and retry rather than rejecting the whole promise.
      const POLL_TIMEOUT_MS = 60_000; // 60 s per individual poll request
      const MAX_CONSECUTIVE_ERRORS = 10; // give up after 10 back-to-back failures
      let consecutiveErrors = 0;

      const poll = () => {
        API.get<{
          job_id: string;
          stage: string;
          chunks_done?: number;
          chunks_total?: number;
          result?: ProofreadResult;
          error?: string;
        }>(`/proofread/${jobId}/status`, { timeout: POLL_TIMEOUT_MS })
          .then(({ data: status }) => {
            consecutiveErrors = 0; // reset on success
            if (
              onChunkProgress &&
              typeof status.chunks_done === "number" &&
              typeof status.chunks_total === "number" &&
              status.chunks_total > 0
            ) {
              onChunkProgress(status.chunks_done, status.chunks_total);
            }
            if (status.stage === "done" && status.result) {
              resolve({ data: status.result });
            } else if (status.stage === "error") {
              reject(new Error(status.error ?? "Proofreading failed on the server."));
            } else {
              // Still processing — poll again in 3 seconds
              setTimeout(poll, 3000);
            }
          })
          .catch((err) => {
            consecutiveErrors += 1;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              reject(new Error(`Polling failed ${MAX_CONSECUTIVE_ERRORS} times in a row: ${err?.message ?? err}`));
              return;
            }
            // Transient network drop (Railway closed the socket) — retry after
            // a short back-off rather than killing the whole job.
            const backoff = Math.min(3000 * consecutiveErrors, 15000);
            console.warn(`[proofread] Poll attempt failed (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}), retrying in ${backoff}ms:`, err?.message);
            setTimeout(poll, backoff);
          });
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

// All layout design parameters — every field maps 1:1 to a backend Form param.
export interface LayoutDesignParams {
  // Core
  pageWidthMm: number;
  pageHeightMm: number;
  bookTitle?: string;
  designInstructions?: string;
  bookType?: string;
  visualTemplate?: string;
  // Typography
  bodyFont?: string;
  chapterFont?: string;
  bodyFontSize?: string;
  chapterFontSize?: string;
  lineSpacing?: string;
  // Margins
  marginTopMm?: string;
  marginBottomMm?: string;
  marginLeftMm?: string;
  marginRightMm?: string;
  // Appearance
  showDropCap?: boolean | null;
  showPageNumbers?: boolean | null;
  // Footer (3-slot)
  footerLeftText?: string;
  footerMiddleText?: string;
  footerRightPagenum?: boolean;
  // Advanced layout
  mirrorMargins?: boolean | null;
  gutterMm?: string;
  paragraphSpacingMm?: string;
  indentMm?: string;
  colorMode?: string;
  bleedMm?: string;
  chapterStart?: string;
  pageNumberStart?: string;
  pageNumberStyle?: string;
  headerCustomText?: string;
  headingDesign?: string;
  sectionBreaks?: boolean | null;
  // Front / Back matter (JSON array strings)
  frontMatter?: string;
  backMatter?: string;
}

export const designLayout = (
  file: File,
  params: LayoutDesignParams,
  onUploadProgress?: (pct: number) => void,
) => {
  const form = new FormData();
  form.append("file", file);
  form.append("page_width_mm", String(Math.max(50, Math.min(600, params.pageWidthMm || 210))));
  form.append("page_height_mm", String(Math.max(50, Math.min(600, params.pageHeightMm || 297))));

  const _s = (v?: string) => { if (v && v.trim()) form.append; return v?.trim() ?? ""; };

  if (params.bookTitle) form.append("book_title", params.bookTitle.trim());
  if (params.designInstructions) form.append("design_instructions", params.designInstructions.trim());
  if (params.bookType) form.append("book_type", params.bookType.trim());
  if (params.visualTemplate) form.append("visual_template", params.visualTemplate.trim());

  // Typography
  if (params.bodyFont) form.append("body_font", params.bodyFont.trim());
  if (params.chapterFont) form.append("chapter_font", params.chapterFont.trim());
  if (params.bodyFontSize) form.append("body_font_size", params.bodyFontSize.trim());
  if (params.chapterFontSize) form.append("chapter_font_size", params.chapterFontSize.trim());
  if (params.lineSpacing) form.append("line_spacing", params.lineSpacing.trim());

  // Margins
  if (params.marginTopMm) form.append("margin_top_mm", params.marginTopMm.trim());
  if (params.marginBottomMm) form.append("margin_bottom_mm", params.marginBottomMm.trim());
  if (params.marginLeftMm) form.append("margin_left_mm", params.marginLeftMm.trim());
  if (params.marginRightMm) form.append("margin_right_mm", params.marginRightMm.trim());

  // Booleans
  if (params.showDropCap !== null && params.showDropCap !== undefined) form.append("show_drop_cap", String(params.showDropCap));
  if (params.showPageNumbers !== null && params.showPageNumbers !== undefined) form.append("show_page_numbers", String(params.showPageNumbers));
  if (params.mirrorMargins !== null && params.mirrorMargins !== undefined) form.append("mirror_margins", String(params.mirrorMargins));
  if (params.sectionBreaks !== null && params.sectionBreaks !== undefined) form.append("section_breaks", String(params.sectionBreaks));

  // Footer
  if (params.footerLeftText) form.append("footer_left_text", params.footerLeftText.trim());
  if (params.footerMiddleText) form.append("footer_middle_text", params.footerMiddleText.trim());
  form.append("footer_right_pagenum", String(params.footerRightPagenum ?? true));

  // Advanced
  if (params.gutterMm) form.append("gutter_mm", params.gutterMm.trim());
  if (params.paragraphSpacingMm) form.append("paragraph_spacing_mm", params.paragraphSpacingMm.trim());
  if (params.indentMm) form.append("indent_mm", params.indentMm.trim());
  if (params.colorMode) form.append("color_mode", params.colorMode.trim());
  if (params.bleedMm) form.append("bleed_mm", params.bleedMm.trim());
  if (params.chapterStart) form.append("chapter_start", params.chapterStart.trim());
  if (params.pageNumberStart) form.append("page_number_start", params.pageNumberStart.trim());
  if (params.pageNumberStyle) form.append("page_number_style", params.pageNumberStyle.trim());
  if (params.headerCustomText) form.append("header_custom_text", params.headerCustomText.trim());
  if (params.headingDesign) form.append("heading_design", params.headingDesign.trim());

  // Front/Back matter (JSON arrays)
  if (params.frontMatter) form.append("front_matter", params.frontMatter);
  if (params.backMatter) form.append("back_matter", params.backMatter);

  return API.post<LayoutResult>("/design-layout", form, {
    timeout: 3600000,
    onUploadProgress: onUploadProgress
      ? (e) => { if (e.total) onUploadProgress(Math.round((e.loaded * 100) / e.total)); }
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