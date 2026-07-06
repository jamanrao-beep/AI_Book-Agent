/**
 * api.ts — Nano Banana AI  ·  Gemini-powered backend client
 *
 * All AI generation (book writing, proofreading, cover design) now runs
 * through Google Gemini / Nano Banana instead of OpenAI.
 *
 * Cover-designer timeout raised to 5 min (300 s) because the 5-tier Nano
 * Banana image cluster may take up to ~3 min on Tier 1 alone.
 */

import axios from "axios";

const API = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  // Large books are split into many chunks; allow up to 3 hours total.
  timeout: 10800000,
});

/**
 * Universal error parser to ensure no technical jargon reaches the user.
 * Catches Axios errors, native Fetch errors, Network errors, and HTML responses.
 */
export function parseFriendlyError(error: any): string {
  // If it's a known string, return it
  if (typeof error === "string") return error;

  let message = "Something went wrong. Please try again.";

  // Handle Axios errors
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return "We couldn't connect to the server. Please check your internet connection.";
    }
    // If backend returns a JSON error with "detail"
    if (error.response.data && typeof error.response.data.detail === "string") {
      return error.response.data.detail;
    }
    // Generic HTTP errors
    if (error.response.status >= 500) {
      return "Something went wrong on our end. Please try again later.";
    }
    if (error.response.status === 404) {
      return "We couldn't find what you were looking for.";
    }
    if (error.response.status === 413) {
      return "The file you uploaded is too large.";
    }
  }

  // Handle native Error objects (like thrown in fetch catches)
  if (error instanceof Error) {
    if (error.message.includes("Failed to fetch") || error.message.includes("NetworkError")) {
      return "We couldn't connect to the server. Please check your internet connection.";
    }
    if (error.message.includes("Unexpected token") || error.message.includes("JSON")) {
      return "We received an unexpected response from the server. Please try again later.";
    }
    // If we've explicitly thrown a friendly error string (e.g. `throw new Error("Friendly message")`)
    return error.message;
  }

  return message;
}

// Automatically apply friendly errors to all Axios calls
API.interceptors.response.use(
  (response) => response,
  (error) => {
    return Promise.reject(new Error(parseFriendlyError(error)));
  }
);

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
  /** Human-readable error message surfaced by the backend on failure. */
  error_message?: string;
}

export interface BookProgress {
  book_id: number;
  status: string;
  completed_segments: number;
  total_segments?: number | null;
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
  /**
   * Not returned by the status endpoint — fetch via downloadProofreadDoc().
   * Omitting corrected_text from the poll response fixes Railway's
   * response-size limit (Bug A) and gzip mid-stream corruption (Bug C).
   */
  corrected_text?: string;
  grammar_fixes: number;
  punctuation_fixes: number;
  style_suggestions: number;
  corrections_summary: string;
  download_url: string;
  grammar_details: ErrorDetail[];
  punctuation_details: ErrorDetail[];
  style_details: ErrorDetail[];
  /** Chunk numbers (1-based) that failed all 3 attempts and used original text. */
  skipped_chunks?: number[];
}

// ─────────────────────────────────────────────
// Types — Cover Designer  (Nano Banana / Gemini)
// ─────────────────────────────────────────────

/**
 * Colour palette returned by the Gemini cover-concept API.
 *
 * The backend returns both the canonical names (bg_primary / bg_secondary)
 * AND the legacy aliases (bg_top / bg_bottom) so both this type and any
 * older page.tsx local interfaces continue to work without breaking changes.
 */
export interface CoverPalette {
  // Canonical names (new — Gemini backend)
  bg_primary: string;
  bg_secondary: string;
  panel_color: string;
  accent: string;
  accent2: string;
  title_color: string;
  subtitle_color: string;
  tagline_color: string;
  // Legacy aliases kept for backward compat with older page.tsx local types
  bg_top: string;   // mirrors bg_primary
  bg_bottom: string;  // mirrors bg_secondary
}

export interface CoverConcept {
  title: string;
  subtitle: string;
  tagline: string;
  author_line: string;
  palette: CoverPalette;
  style: string;
  motif: string;
  /** Hero illustration shape drawn behind the text panel. */
  illustration_shape: string;
  /** One of: split_horizon | full_bleed | left_panel | top_image | diagonal_cut | magazine */
  layout_template: string;
  /** Image compositing treatment: tinted_overlay | grayscale_fade | duotone | vignette | blur_bg | color_burn */
  image_treatment: string;
  /** Up to 4 decorative accent element descriptions. */
  accent_elements: string[];
  genre_label: string;
  /** 1-2 sentences explaining why these design choices suit this specific book. */
  design_rationale?: string;
  /** Set by backend if all image-gen tiers fail; used to show a warning in the UI. */
  _nb_failed?: boolean;
  _nb_note?: string;
}

export interface CoverFileResult {
  source_filename: string;
  concept: CoverConcept;
}

/**
 * Returned by POST /design-cover
 *
 * mode === "single"     → concept + download_url for one file
 * mode === "zip_bundle" → files[] with per-file concepts + bundle download_url
 */
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
  /**
   * Non-null when all Nano Banana image-gen tiers failed and the cover uses
   * a gradient background instead. Show this as a warning toast in the UI.
   */
  image_generation_warning?: string | null;
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

export const cancelBookGeneration = (id: number) =>
  API.post(`/book/${id}/cancel`);

export const listBooks = (user_id: string) => API.get<BookStatus[]>(`/books?user_id=${user_id}`);

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

  // We can signal 100% upload so the UI switches to "Analysing…"
  onUploadProgress?.(100);

  return API.post<ProofreadResult>(
    "/proofread",
    form,
    {
      timeout: 300_000, // 5 min timeout
      onUploadProgress: onUploadProgress
        ? (e) => {
          if (e.total) onUploadProgress(Math.round((e.loaded * 100) / e.total));
        }
        : undefined,
    }
  ).then((res) => ({ data: res.data }));
};

/** Trigger a browser download of the corrected file. */
export const downloadProofreadDoc = (jobId: string, originalFilename: string) => {
  const url = `${API.defaults.baseURL}/proofread/${jobId}/download`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `corrected_${originalFilename}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// ─────────────────────────────────────────────
// Cover Designer  (Nano Banana / Gemini)
// ─────────────────────────────────────────────

/**
 * Upload a book file (.pdf, .docx, or .zip) to generate an AI cover via
 * the Nano Banana 5-tier image cluster (Gemini 2.5 Flash Image → Gemini 2.0
 * Flash Exp → Stability AI → SVG template → procedural fallback).
 *
 * @param file         The book file (.pdf / .docx / .zip)
 * @param bookTitle    Optional title override (inferred from filename if blank)
 * @param description  Optional extra context for the Gemini cover concept prompt
 * @param designStyle  One of: normal | premium | scifi | minimalist | fantasy |
 *                     thriller | romance | academic | vibrant | retro
 * @param coverImage   Optional user-supplied illustration (PNG/JPEG) used as the
 *                     full-bleed background. When provided, Nano Banana is skipped.
 *
 * Timeout: 300 s (5 min). The 5-tier cluster can take up to ~3 min on slow
 * Gemini responses; 120 s (old value) was too short and caused false failures.
 */
export const designCover = (
  file: File,
  bookTitle: string = "",
  description: string = "",
  designStyle: string = "",
  coverImage?: File,
) => {
  const form = new FormData();
  form.append("file", file);
  form.append("book_title", bookTitle);
  form.append("description", description);
  form.append("design_style", designStyle);

  // Optional user-supplied cover illustration — skips the Nano Banana cluster
  if (coverImage) {
    form.append("cover_image", coverImage);
  }

  return API.post<CoverResult>("/design-cover", form, {
    // Raised from 120 s → 300 s for Nano Banana 5-tier image generation.
    // No Content-Type header — axios sets multipart/form-data with boundary.
    timeout: 300_000,
  });
};

/**
 * Trigger a browser download of the cover-enhanced file.
 * Handles both single-file and zip-bundle modes.
 */
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
  job_id: string;
  title: string;
  style_name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  concept: Record<string, any>;
  chapter_count: number;
  chapter_titles: string[];
  book_type: string;
  book_type_label: string;
  /** Relative paths — fetch via downloadLayoutDoc(), not directly. */
  pdf_url: string;
  docx_url: string;
}

/**
 * Shape returned by GET /layout/{job_id}/status.
 * `stage` cycles: queued → (running stages from progress_callback) → done | error.
 * `result` is only present once stage === "done".
 */
export interface LayoutStatus {
  job_id: string;
  stage: string;
  pct: number;
  message: string;
  result?: LayoutResult;
}

/** All layout design parameters — every field maps 1:1 to a backend Form param. */
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

/**
 * Poll the status of a previously-started layout job.
 * Exposed directly in case a caller wants manual control over polling
 * (e.g. to drive a progress bar independently of designLayout()'s own loop).
 */
export const getLayoutStatus = (jobId: string) =>
  API.get<LayoutStatus>(`/layout/${jobId}/status`);

export const designLayout = (
  file: File,
  params: LayoutDesignParams,
  onUploadProgress?: (pct: number) => void,
  onProgress?: (stage: string, pct: number, message: string) => void,
): Promise<{ data: LayoutResult }> => {
  const form = new FormData();
  form.append("file", file);
  form.append("page_width_mm", String(Math.max(50, Math.min(600, params.pageWidthMm || 210))));
  form.append("page_height_mm", String(Math.max(50, Math.min(600, params.pageHeightMm || 297))));

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
  if (params.showDropCap != null) form.append("show_drop_cap", String(params.showDropCap));
  if (params.showPageNumbers != null) form.append("show_page_numbers", String(params.showPageNumbers));
  if (params.mirrorMargins != null) form.append("mirror_margins", String(params.mirrorMargins));
  if (params.sectionBreaks != null) form.append("section_breaks", String(params.sectionBreaks));

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

  // Step 1: upload + kick off the background job. The backend streams the
  // file to disk and starts a thread, then returns {job_id, status:"started"}
  // almost immediately — it does NOT wait for the render pipeline to finish.
  const startPromise = API.post<{ job_id: string; status: string }>(
    "/design-layout",
    form,
    {
      // Generous, but this call returns fast in practice — it only covers
      // the upload itself, not the actual layout/render work.
      timeout: 10800000,
      onUploadProgress: onUploadProgress
        ? (e) => { if (e.total) onUploadProgress(Math.round((e.loaded * 100) / e.total)); }
        : undefined,
    },
  );

  // Step 2: poll GET /layout/{job_id}/status until stage is "done" or "error".
  // This is what actually survives Railway's request-duration limit — each
  // poll is a short, independent request instead of one connection held
  // open for the entire pipeline (GPT call + font downloads + PDF/DOCX/EPUB
  // render), which is what was previously causing "Failed to fetch".
  return startPromise.then(({ data }) => {
    const jobId = data.job_id;
    return new Promise<{ data: LayoutResult }>((resolve, reject) => {
      // Signal 100% upload so the UI can switch to a "designing layout…" state.
      onUploadProgress?.(100);

      const POLL_INTERVAL_MS = 3000;
      const MAX_CONSECUTIVE_ERRORS = 10;
      let consecutiveErrors = 0;

      const poll = () => {
        getLayoutStatus(jobId)
          .then(({ data: status }) => {
            consecutiveErrors = 0;
            onProgress?.(status.stage, status.pct, status.message);

            if (status.stage === "done" && status.result) {
              resolve({ data: status.result });
              return;
            }
            if (status.stage === "error") {
              reject(new Error(status.message || "Layout design failed."));
              return;
            }
            setTimeout(poll, POLL_INTERVAL_MS);
          })
          .catch((err) => {
            consecutiveErrors += 1;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              reject(
                new Error(
                  `Lost connection to layout job after ${MAX_CONSECUTIVE_ERRORS} failed polls: ${err?.message}`,
                ),
              );
              return;
            }
            const backoff = Math.min(3000 * consecutiveErrors, 15000);
            console.warn(
              `[layout] Poll ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} failed, ` +
              `retrying in ${backoff}ms:`,
              err?.message,
            );
            setTimeout(poll, backoff);
          });
      };

      // First poll after 1.5 s — small books can finish fast, queued jobs
      // (semaphore-limited to 2 concurrent heavy jobs) will just keep polling.
      setTimeout(poll, 1500);
    });
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
