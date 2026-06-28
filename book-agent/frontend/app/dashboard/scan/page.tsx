"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Upload,
    Loader,
    CheckCircle,
    Download,
    Sparkles,
    X,
    BookOpen,
    Archive,
    FileText,
    Image as ImageIcon,
    Languages,
    Hash,
    AlignLeft,
    ChevronRight,
    ScanLine,
    Layers,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SUPPORTED_EXTS = ["jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif", "gif", "pdf", "docx", "zip"];

interface ScanResult {
    job_id: string;
    title: string;
    language: string;
    total_pages: number;
    content_pages: number;
    total_words: number;
    chapters: number;
    chapter_titles: string[];
    pdf_url: string;
    docx_url: string;
}

interface ProgressState {
    stage: "idle" | "collecting" | "transcribing" | "healing" | "structuring" | "assembling" | "done" | "error";
    pct: number;
    message: string;
}

const STAGE_META: Record<string, { label: string; icon: string }> = {
    idle: { label: "Ready", icon: "⊙" },
    collecting: { label: "Extracting Files", icon: "◈" },
    transcribing: { label: "Transcribing Handwriting", icon: "✍" },
    healing: { label: "Healing Scans", icon: "🩹" },
    structuring: { label: "Structuring Prose", icon: "⚙" },
    assembling: { label: "Assembling Book", icon: "📐" },
    done: { label: "Complete", icon: "✓" },
    error: { label: "Error", icon: "✕" },
};

export default function ScanPage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    const [files, setFiles] = useState<File[]>([]);
    const [bookTitle, setBookTitle] = useState("");
    const [dragging, setDragging] = useState(false);
    const [progress, setProgress] = useState<ProgressState>({ stage: "idle", pct: 0, message: "" });
    const [result, setResult] = useState<ScanResult | null>(null);
    const [error, setError] = useState("");

    const addFiles = (incoming: FileList | File[]) => {
        const arr = Array.from(incoming);
        const valid = arr.filter(f => {
            const ext = f.name.split(".").pop()?.toLowerCase() || "";
            return SUPPORTED_EXTS.includes(ext);
        });
        if (valid.length < arr.length) {
            setError(`${arr.length - valid.length} unsupported file(s) were skipped. Accepted: images, PDF, DOCX, ZIP.`);
        } else {
            setError("");
        }
        setFiles(prev => {
            const combined = [...prev, ...valid];
            const seen = new Set<string>();
            return combined.filter(f => {
                const key = `${f.name}-${f.size}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, 400);
        });
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
    };

    const removeFile = (idx: number) => {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const handleSubmit = async () => {
        if (files.length === 0) return;
        setError("");
        setResult(null);
        setProgress({ stage: "collecting", pct: 2, message: "Uploading files…" });

        const controller = new AbortController();
        const uploadTimeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

        try {
            const form = new FormData();

            if (files.length === 1) {
                form.append("file", files[0]);
            } else {
                files.forEach(f => form.append("files", f));
            }

            if (bookTitle.trim()) form.append("book_title", bookTitle.trim());

            setProgress({ stage: "collecting", pct: 5, message: "Uploading…" });

            const res = await fetch(`${API_BASE}/scan-handwritten`, {
                method: "POST",
                body: form,
                signal: controller.signal,
            });

            clearTimeout(uploadTimeout);

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Unknown server error" }));
                throw new Error(err.detail || `Server error ${res.status}`);
            }

            const data: { job_id: string; status: string } = await res.json();

            setProgress({ stage: "transcribing", pct: 10, message: "Job started — connecting to progress feed…" });
            startProgressTracking(data.job_id);

        } catch (err: unknown) {
            clearTimeout(uploadTimeout);
            const msg = err instanceof Error
                ? (err.name === "AbortError" ? "Upload timed out. Try a smaller batch or faster connection." : err.message)
                : "Scan failed. Make sure the backend is running.";
            setError(msg);
            setProgress({ stage: "error", pct: 0, message: msg });
        }
    };

    const fileCount = files.length;
    const isImageOnly = files.every(f => {
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        return ["jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif", "gif"].includes(ext);
    });
    const stageMeta = STAGE_META[progress.stage] || STAGE_META.idle;
    const isLoading = ["collecting", "transcribing", "healing", "structuring", "assembling"].includes(progress.stage);

    useEffect(() => {
        return () => {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            if (wsRef.current) { try { wsRef.current.close(); } catch (_) { } wsRef.current = null; }
        };
    }, []);

    const startProgressTracking = (jobId: string) => {
        let ws: WebSocket | null = null;
        let wsConnected = false;
        let pollInterval: NodeJS.Timeout | null = null;

        const stopAll = () => {
            if (ws) { try { ws.close(); } catch (_) { } ws = null; wsRef.current = null; }
            if (pollInterval) { clearInterval(pollInterval); pollInterval = null; pollRef.current = null; }
        };

        const applyUpdate = (data: { stage?: string; pct?: number; message?: string; result?: ScanResult; error?: string }) => {
            if (data.stage && data.stage !== "done" && data.stage !== "error") {
                setProgress({
                    stage: data.stage as ProgressState["stage"],
                    pct: data.pct ?? 0,
                    message: data.message ?? "",
                });
            } else if (data.stage === "done" && data.result) {
                stopAll();
                setProgress({ stage: "done", pct: 100, message: "Complete!" });
                setResult(data.result);
            } else if (data.stage === "error" || data.error) {
                stopAll();
                const msg = data.message ?? data.error ?? "Scan failed.";
                setError(msg);
                setProgress({ stage: "error", pct: 0, message: msg });
            }
        };

        const startPolling = () => {
            if (pollInterval) return;
            pollInterval = setInterval(async () => {
                try {
                    const r = await fetch(`${API_BASE}/scan-handwritten/${jobId}/status`);
                    if (!r.ok) return;
                    const data = await r.json();
                    applyUpdate({ stage: data.stage, pct: data.pct, message: data.message, result: data.result, error: data.error });
                } catch (_) { }
            }, 3000);
            pollRef.current = pollInterval;
        };

        try {
            const wsUrl = API_BASE.replace(/^http/, "ws") + `/ws/status/${jobId}`;
            wsRef.current = ws = new WebSocket(wsUrl);

            ws.onopen = () => { wsConnected = true; };
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === "progress") applyUpdate({ stage: msg.stage, pct: msg.progress, message: msg.message });
                    else if (msg.type === "complete") applyUpdate({ stage: "done", pct: 100, result: msg.result });
                    else if (msg.type === "error") applyUpdate({ stage: "error", error: msg.message });
                } catch (_) { }
            };
            ws.onerror = () => { if (!wsConnected) startPolling(); };
            ws.onclose = () => { if (!wsConnected) startPolling(); };

            startPolling();
        } catch (_) {
            startPolling();
        }
    };

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--void)",
          fontFamily: "'DM Sans', sans-serif",
          color: "var(--text-primary)",
          position: "relative",
        }}
      >
        <div className="grid-overlay" />

        {/* ── Nav ── */}
        <nav
          className="glass"
          style={{
            borderBottom: "1.5px solid var(--border-mid)",
            padding: "0 40px",
            height: "60px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          <button
            onClick={() => router.push("/dashboard")}
            className="btn-ghost"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              fontSize: "12px",
              borderRadius: "8px",
            }}
          >
            <ArrowLeft size={13} /> Dashboard
          </button>
          <span style={{ color: "var(--border-mid)" }}>|</span>
          <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                background: "var(--text-primary)",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ScanLine size={14} color="var(--void)" />
            </div>
            <span
              style={{
                fontWeight: "800",
                fontSize: "14px",
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              Handwritten Scanner
            </span>
          </div>
        </nav>

        <main
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            padding: "64px 40px 96px",
            position: "relative",
            zIndex: 2,
          }}
        >
          {/* ── Header ── */}
          <div style={{ marginBottom: "44px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "var(--onyx)",
                border: "1.5px solid var(--border-mid)",
                borderRadius: "20px",
                padding: "4px 14px",
                fontSize: "10px",
                fontWeight: "700",
                letterSpacing: "0.1em",
                color: "var(--violet)",
                marginBottom: "16px",
                boxShadow: "0 4px 10px rgba(0,0,0,0.02)",
              }}
            >
              <Sparkles size={10} /> AI HANDWRITING RECOGNITION
            </div>
            <h1
              className="serif"
              style={{
                fontSize: "40px",
                fontWeight: "400",
                letterSpacing: "-0.02em",
                marginBottom: "10px",
                color: "var(--text-primary)",
              }}
            >
              Handwritten Book Scanner
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "15px",
                lineHeight: "1.6",
                maxWidth: "600px",
              }}
            >
              Upload photos of handwritten pages, a PDF scan, or a ZIP of images in any language. Our model reads page text verbatim, structures it, and exports a print-ready book.
            </p>

            {/* Capability chips */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                marginTop: "20px",
              }}
            >
              {[
                { icon: "🖼️", text: "Up to 400 photos" },
                { icon: "🌏", text: "Any language" },
                { icon: "📄", text: "PDF / DOCX / ZIP" },
                { icon: "📚", text: "Auto chapter detection" },
                { icon: "⬇️", text: "PDF + DOCX export" },
              ].map((c) => (
                <span
                  key={c.text}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    background: "var(--onyx)",
                    border: "1px solid var(--border-mid)",
                    borderRadius: "20px",
                    padding: "5px 14px",
                    fontWeight: "500",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.01)",
                  }}
                >
                  <span style={{ fontSize: "12px" }}>{c.icon}</span> {c.text}
                </span>
              ))}
            </div>
          </div>

          {!result ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr",
                gap: "28px",
                alignItems: "start",
              }}
            >
              {/* ── Left: Upload ── */}
              <div>
                {/* Drop zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() =>
                    files.length === 0 && fileInputRef.current?.click()
                  }
                  style={{
                    border: `2px dashed ${
                      dragging
                        ? "var(--violet)"
                        : files.length > 0
                        ? "rgba(139, 92, 246, 0.4)"
                        : "var(--border-strong)"
                    }`,
                    borderRadius: "20px",
                    padding: "48px 32px",
                    textAlign: "center",
                    cursor: files.length > 0 ? "default" : "pointer",
                    background: dragging
                      ? "rgba(139, 92, 246, 0.04)"
                      : files.length > 0
                      ? "rgba(37, 99, 235, 0.02)"
                      : "var(--onyx)",
                    transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                    marginBottom: "16px",
                    position: "relative",
                    overflow: "hidden",
                    boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.02)",
                  }}
                >
                  {/* Glowing Laser Scan beam when active uploading/processing */}
                  {isLoading && <div className="scan-beam" />}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif,.pdf,.docx,.zip"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                  {files.length === 0 ? (
                    <>
                      <div
                        style={{
                          width: "56px",
                          height: "56px",
                          background: "var(--void)",
                          borderRadius: "14px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 16px",
                          border: "1.5px solid var(--border-mid)",
                        }}
                      >
                        <Upload size={22} color="var(--violet)" />
                      </div>
                      <p
                        style={{
                          fontWeight: "700",
                          fontSize: "14px",
                          marginBottom: "6px",
                          color: "var(--text-primary)",
                        }}
                      >
                        Drop handwritten pages here
                      </p>
                      <p
                        style={{
                          color: "var(--text-tertiary)",
                          fontSize: "12px",
                          lineHeight: "1.6",
                        }}
                      >
                        Images (JPG, PNG, WEBP…) · PDF scan · ZIP archive
                        <br />
                        Up to 400 pages · Any language
                      </p>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          width: "56px",
                          height: "56px",
                          background: "var(--void)",
                          borderRadius: "14px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 12px",
                          border: "1.5px solid var(--border-mid)",
                        }}
                      >
                        {isImageOnly ? (
                          <Layers size={22} color="var(--violet)" />
                        ) : (
                          <Archive size={22} color="var(--violet)" />
                        )}
                      </div>
                      <p
                        style={{
                          fontWeight: "700",
                          fontSize: "14px",
                          color: "var(--text-primary)",
                        }}
                      >
                        {fileCount} file{fileCount !== 1 ? "s" : ""} selected
                      </p>
                      <p
                        style={{
                          color: "var(--text-tertiary)",
                          fontSize: "12px",
                          marginTop: "4px",
                        }}
                      >
                        {isImageOnly
                          ? `${fileCount} page image${fileCount !== 1 ? "s" : ""}`
                          : "Mixed document files"}
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="btn-outline"
                        style={{
                          marginTop: "14px",
                          padding: "6px 14px",
                          fontSize: "12px",
                          borderRadius: "8px",
                        }}
                      >
                        + Add more pages
                      </button>
                    </>
                  )}
                </div>

                {/* File list */}
                {files.length > 0 && (
                  <div
                    style={{
                      maxHeight: "240px",
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      marginBottom: "16px",
                      paddingRight: "2px",
                    }}
                  >
                    {files.map((f, idx) => {
                      const ext = f.name.split(".").pop()?.toUpperCase() || "?";
                      const isImg = [
                        "JPG",
                        "JPEG",
                        "PNG",
                        "WEBP",
                        "BMP",
                        "TIFF",
                        "TIF",
                        "GIF",
                      ].includes(ext);
                      return (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            background: "var(--onyx)",
                            border: "1.5px solid var(--border-mid)",
                            borderRadius: "10px",
                            padding: "10px 14px",
                          }}
                        >
                          <div
                            style={{
                              width: "28px",
                              height: "28px",
                              background: "var(--void)",
                              border: "1px solid var(--border-mid)",
                              borderRadius: "6px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {isImg ? (
                              <ImageIcon size={13} color="var(--violet)" />
                            ) : (
                              <FileText size={13} color="var(--text-primary)" />
                            )}
                          </div>
                          <span
                            style={{
                              flex: 1,
                              fontSize: "12px",
                              color: "var(--text-primary)",
                              fontWeight: "600",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {f.name}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              color: "var(--text-tertiary)",
                              flexShrink: 0,
                            }}
                          >
                            {(f.size / 1024).toFixed(0)} KB
                          </span>
                          <button
                            onClick={() => removeFile(idx)}
                            style={{
                              background: "rgba(239, 68, 68, 0.05)",
                              border: "none",
                              color: "var(--crimson)",
                              cursor: "pointer",
                              display: "flex",
                              padding: "4px",
                              borderRadius: "6px",
                              transition: "all 0.2s",
                            }}
                            onMouseOver={(e) =>
                              (e.currentTarget.style.background =
                                "rgba(239, 68, 68, 0.15)")
                            }
                            onMouseOut={(e) =>
                              (e.currentTarget.style.background =
                                "rgba(239, 68, 68, 0.05)")
                            }
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {error && (
                  <div
                    style={{
                      background: "rgba(239, 68, 68, 0.06)",
                      border: "1px solid rgba(239, 68, 68, 0.18)",
                      borderRadius: "10px",
                      padding: "12px 16px",
                      color: "var(--crimson)",
                      fontSize: "13px",
                      marginBottom: "16px",
                    }}
                  >
                    {error}
                  </div>
                )}
              </div>

              {/* ── Right: Config + progress ── */}
              <div
                style={{ display: "flex", flexDirection: "column", gap: "16px" }}
              >
                {/* Book title */}
                <div>
                  <label className="field-label">
                    Book Title{" "}
                    <span
                      style={{
                        color: "var(--text-tertiary)",
                        fontWeight: "400",
                        textTransform: "none",
                        fontSize: "11px",
                      }}
                    >
                      (optional — AI will infer)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                    placeholder="e.g. Grandma's Recipe Chronicles"
                    className="input-field"
                  />
                </div>

                {/* How it works info card */}
                <div
                  className="card"
                  style={{
                    background: "var(--onyx)",
                    border: "1.5px solid var(--border-mid)",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <p
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      lineHeight: "1.65",
                      margin: 0,
                    }}
                  >
                    <span style={{ color: "var(--violet)", fontWeight: "700" }}>
                      Transcription Flow:
                    </span>{" "}
                    Page photos are read by our model. The output text is then
                    processed by the structural agent to fix typos, arrange headings,
                    and format tables of content before PDF/DOCX compile.
                  </p>
                </div>

                {/* Tips */}
                <div
                  className="card"
                  style={{
                    background: "var(--onyx)",
                    border: "1.5px solid var(--border-mid)",
                    borderRadius: "14px",
                    padding: "20px",
                  }}
                >
                  <p
                    className="field-label"
                    style={{ color: "var(--violet)", marginBottom: "12px" }}
                  >
                    Tips for best results
                  </p>
                  {[
                    "Shoot in high resolution, flat angles",
                    "Avoid dark ambient shadows across text lines",
                    "Keep pages sequential in multi-upload batches",
                    "Supports both print script and cursive handwriting",
                  ].map((tip) => (
                    <div
                      key={tip}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        marginBottom: "8px",
                      }}
                    >
                      <span
                        style={{
                          color: "var(--violet)",
                          fontSize: "12px",
                          lineHeight: "1.4",
                          fontWeight: "bold",
                        }}
                      >
                        ✓
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                          lineHeight: "1.4",
                        }}
                      >
                        {tip}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Progress panel */}
                {isLoading && (
                  <div
                    className="card pulse-glow"
                    style={{
                      background: "var(--onyx)",
                      border: "1.5px solid rgba(139, 92, 246, 0.25)",
                      borderRadius: "14px",
                      padding: "20px",
                      animation: "fadeInUp 0.3s ease",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginBottom: "12px",
                      }}
                    >
                      <Loader
                        size={16}
                        style={{
                          color: "var(--violet)",
                          animation: "spin 1.2s linear infinite",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <p
                          style={{
                            fontSize: "13px",
                            fontWeight: "700",
                            color: "var(--text-primary)",
                          }}
                        >
                          {stageMeta.label}
                        </p>
                        <p
                          style={{
                            fontSize: "11px",
                            color: "var(--text-tertiary)",
                            marginTop: "2px",
                          }}
                        >
                          {progress.message}
                        </p>
                      </div>
                      <span
                        className="serif"
                        style={{
                          fontSize: "22px",
                          fontWeight: "400",
                          color: "var(--text-primary)",
                        }}
                      >
                        {progress.pct}%
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${progress.pct}%`,
                          background: "var(--violet)",
                        }}
                      />
                    </div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: "var(--text-tertiary)",
                        marginTop: "10px",
                        lineHeight: 1.4,
                      }}
                    >
                      Transcription runs segment-by-segment. Please keep this tab active to follow status.
                    </p>
                  </div>
                )}

                {/* Submit button */}
                <button
                  onClick={handleSubmit}
                  disabled={files.length === 0 || isLoading}
                  className="btn-dark"
                  style={{
                    justifyContent: "center",
                    padding: "13px 24px",
                    fontSize: "14px",
                    borderRadius: "12px",
                    background:
                      files.length === 0 || isLoading
                        ? "rgba(0,0,0,0.04)"
                        : "var(--text-primary)",
                    color:
                      files.length === 0 || isLoading
                        ? "var(--ash)"
                        : "var(--void)",
                    border: "none",
                    cursor:
                      files.length === 0 || isLoading
                        ? "not-allowed"
                        : "pointer",
                    boxShadow:
                      files.length > 0 && !isLoading
                        ? "0 4px 15px rgba(0,0,0,0.06)"
                        : "none",
                    opacity: files.length === 0 || isLoading ? 0.6 : 1,
                  }}
                >
                  {isLoading ? (
                    <>
                      <Loader
                        size={16}
                        style={{ animation: "spin 1s linear infinite" }}
                      />{" "}
                      Processing batch…
                    </>
                  ) : (
                    <>
                      <ScanLine size={16} /> Scan & Transcribe
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* ── Results ── */
            <div style={{ animation: "fadeInUp 0.4s ease" }}>
              {/* Success banner */}
              <div
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "18px",
                  background: "var(--onyx)",
                  border: "1.5px solid var(--border-mid)",
                  borderRadius: "16px",
                  padding: "24px",
                  marginBottom: "28px",
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    background: "rgba(16, 185, 129, 0.08)",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    border: "1px solid rgba(16, 185, 129, 0.15)",
                  }}
                >
                  <CheckCircle size={22} color="var(--emerald)" />
                </div>
                <div style={{ flex: 1 }}>
                  <h2
                    className="serif"
                    style={{
                      fontWeight: "400",
                      fontSize: "20px",
                      color: "var(--text-primary)",
                    }}
                  >
                    {result.title}
                  </h2>
                  <p
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: "12px",
                      marginTop: "4px",
                    }}
                  >
                    Transcription complete · {result.content_pages} of{" "}
                    {result.total_pages} pages contain text
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  <a
                    href={`${API_BASE}/scan-handwritten/${result.job_id}/download/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-dark"
                    style={{
                      padding: "10px 18px",
                      fontSize: "13px",
                      borderRadius: "10px",
                      textDecoration: "none",
                    }}
                  >
                    <Download size={13} /> PDF
                  </a>
                  <a
                    href={`${API_BASE}/scan-handwritten/${result.job_id}/download/docx`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline"
                    style={{
                      padding: "9px 18px",
                      fontSize: "13px",
                      borderRadius: "10px",
                      textDecoration: "none",
                    }}
                  >
                    <Download size={13} /> DOCX
                  </a>
                </div>
              </div>

              {/* Stats grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px",
                  marginBottom: "32px",
                }}
              >
                {[
                  {
                    icon: <Languages size={16} color="var(--violet)" />,
                    label: "Language",
                    value: result.language,
                  },
                  {
                    icon: <Hash size={16} color="var(--violet)" />,
                    label: "Pages Scanned",
                    value: `${result.content_pages}/${result.total_pages}`,
                  },
                  {
                    icon: <AlignLeft size={16} color="var(--violet)" />,
                    label: "Words",
                    value: result.total_words.toLocaleString(),
                  },
                  {
                    icon: <BookOpen size={16} color="var(--violet)" />,
                    label: "Chapters",
                    value: result.chapters.toString(),
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="card"
                    style={{
                      background: "var(--onyx)",
                      border: "1.5px solid var(--border-mid)",
                      padding: "20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "10px",
                      }}
                    >
                      {s.icon}
                      <span className="field-label" style={{ margin: 0 }}>
                        {s.label}
                      </span>
                    </div>
                    <div
                      className="serif"
                      style={{
                        fontSize: "22px",
                        fontWeight: "400",
                        color: "var(--text-primary)",
                      }}
                    >
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Chapter list */}
              {result.chapter_titles.length > 0 && (
                <div
                  className="card"
                  style={{
                    background: "var(--onyx)",
                    border: "1.5px solid var(--border-mid)",
                    padding: "24px",
                    marginBottom: "32px",
                  }}
                >
                  <p
                    className="field-label"
                    style={{ color: "var(--violet)", marginBottom: "16px" }}
                  >
                    Detected Chapters ({result.chapters})
                  </p>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {result.chapter_titles.map((title, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "10px 16px",
                          background: "var(--void)",
                          border: "1px solid var(--border-mid)",
                          borderRadius: "10px",
                        }}
                      >
                        <span
                          style={{
                            width: "24px",
                            height: "24px",
                            borderRadius: "6px",
                            background: "var(--text-primary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            fontWeight: "700",
                            color: "var(--void)",
                            flexShrink: 0,
                          }}
                        >
                          {i + 1}
                        </span>
                        <span
                          style={{
                            fontSize: "13px",
                            color: "var(--text-primary)",
                            fontWeight: "600",
                            flex: 1,
                          }}
                        >
                          {title}
                        </span>
                        <ChevronRight
                          size={13}
                          color="var(--text-tertiary)"
                          style={{ opacity: 0.6 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New scan button */}
              <button
                onClick={() => {
                  setResult(null);
                  setFiles([]);
                  setBookTitle("");
                  setError("");
                  setProgress({ stage: "idle", pct: 0, message: "" });
                }}
                className="btn-outline"
                style={{ padding: "10px 20px", fontSize: "13px" }}
              >
                ← Scan another book
              </button>
            </div>
          )}
        </main>
      </div>
    );
}
