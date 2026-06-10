"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  FileText,
  Loader,
  CheckCircle,
  Download,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { proofreadDocument, downloadProofreadDoc } from "@/lib/api";

interface ErrorDetail {
  original: string;
  corrected: string;
  explanation: string;
}

interface ProofResult {
  job_id: string;
  original_filename: string;
  corrections_summary: string;
  grammar_fixes: number;
  punctuation_fixes: number;
  style_suggestions: number;
  corrected_text?: string;
  grammar_details?: ErrorDetail[];
  punctuation_details?: ErrorDetail[];
  style_details?: ErrorDetail[];
}

type TabType = "summary" | "grammar" | "punctuation" | "style" | "corrected";

export default function ProofreadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("summary");
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  // Selective PDF generation state
  const [applyGrammar, setApplyGrammar] = useState(true);
  const [applyPunctuation, setApplyPunctuation] = useState(true);
  const [applyStyle, setApplyStyle] = useState(true);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [correctedTextLoading, setCorrectedTextLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [docxGenerating, setDocxGenerating] = useState(false);
  const [docxError, setDocxError] = useState("");

  const toggleError = (key: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleFile = (f: File) => {
    const allowed = [
      "text/plain",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/markdown",
      "text/x-markdown",
      "application/rtf",
      "text/rtf",
      "application/zip",
      "application/x-zip-compressed",
      "application/x-zip",
    ];
    if (
      !allowed.includes(f.type) &&
      !f.name.endsWith(".txt") &&
      !f.name.endsWith(".docx") &&
      !f.name.endsWith(".pdf") &&
      !f.name.endsWith(".md") &&
      !f.name.endsWith(".rtf") &&
      !f.name.endsWith(".zip")
    ) {
      setError("Please upload a .txt, .docx, .pdf, .md, .rtf, or .zip file.");
      return;
    }
    if (f.size > 150 * 1024 * 1024) {
      setError("File must be under 150 MB.");
      return;
    }
    setError("");
    setFile(f);
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setUploadProgress(0);
    setElapsedSeconds(0);
    setChunkProgress(null);
    setError("");
    // Reset selections to all-on for each new upload
    setApplyGrammar(true);
    setApplyPunctuation(true);
    setApplyStyle(true);
    setPdfError("");

    // Tick elapsed time every second while loading
    const timerRef = { id: 0 };
    timerRef.id = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    try {
      const res = await proofreadDocument(
        file,
        (pct) => setUploadProgress(pct),
        (done, total) => setChunkProgress({ done, total }),
      );
      setResult(res.data);
      setActiveTab("summary");
      setExpandedErrors(new Set());

      // Fetch corrected text from the download endpoint (it is not in the
      // status payload — we stripped it to stay under Railway's response limit).
      if (res.data.download_url) {
        setCorrectedTextLoading(true);
        try {
          const baseURL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
          const textRes = await fetch(`${baseURL}${res.data.download_url}?format=txt`);
          if (textRes.ok) {
            const text = await textRes.text();
            setResult((prev) => prev ? { ...prev, corrected_text: text } : prev);
          }
        } catch (_) {
          // Non-fatal — corrected text tab will stay empty but download still works
        } finally {
          setCorrectedTextLoading(false);
        }
      }
    } catch (err: unknown) {
      // Extract the most useful error message from axios errors
      let message = "Proofreading failed. Make sure the backend is running.";
      if (err && typeof err === "object") {
        const axiosErr = err as {
          response?: { status: number; data?: { detail?: string } };
          request?: unknown;
          message?: string;
          code?: string;
        };
        if (axiosErr.response) {
          // Server responded with a non-2xx status
          const status = axiosErr.response.status;
          const detail = axiosErr.response.data?.detail ?? axiosErr.message ?? "";
          message = `Server error ${status}${detail ? `: ${detail}` : ""}`;
          console.error("[Proofread] Server error", status, axiosErr.response.data);
        } else if (axiosErr.request) {
          // Request was made but no response received (timeout, CORS, backend down)
          const code = axiosErr.code ?? "";
          if (code === "ECONNABORTED" || axiosErr.message?.includes("timeout")) {
            message =
              "The request timed out waiting for the server — but the backend may still be processing. " +
              "If you see a result missing some sections, this is why. " +
              "To fix permanently, increase the axios timeout in @/lib/api.ts (set timeout: 30 * 60 * 1000 for 30 min).";
          } else {
            message =
              "No response from server. Check that the backend is running and that there is no CORS or proxy issue. See browser console for details.";
          }
          console.error("[Proofread] No response received", axiosErr.request, axiosErr.message, code);
        } else {
          message = axiosErr.message ?? message;
          console.error("[Proofread] Request setup error", axiosErr.message);
        }
      }
      setError(message);
    } finally {
      clearInterval(timerRef.id);
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleGeneratePdf = async () => {
    if (!result) return;
    if (!applyGrammar && !applyPunctuation && !applyStyle) {
      setPdfError("Please select at least one correction type.");
      return;
    }
    setPdfGenerating(true);
    setPdfError("");
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${API_BASE}/proofread/${result.job_id}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apply_grammar: applyGrammar,
          apply_punctuation: applyPunctuation,
          apply_style: applyStyle,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `corrected_${result.original_filename.replace(/\.[^.]+$/, "")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setPdfError(err instanceof Error ? err.message : "PDF generation failed.");
    } finally {
      setPdfGenerating(false);
    }
  };

  const handleGenerateDocx = async () => {
    if (!result) return;
    if (!applyGrammar && !applyPunctuation && !applyStyle) {
      setDocxError("Please select at least one correction type.");
      return;
    }
    setDocxGenerating(true);
    setDocxError("");
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${API_BASE}/proofread/${result.job_id}/generate-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apply_grammar: applyGrammar,
          apply_punctuation: applyPunctuation,
          apply_style: applyStyle,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Server error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `corrected_${result.original_filename.replace(/\.[^.]+$/, "")}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setDocxError(err instanceof Error ? err.message : "DOCX generation failed.");
    } finally {
      setDocxGenerating(false);
    }
  };


  const TABS: { id: TabType; label: string; color: string; count?: number }[] = result
    ? [
      { id: "summary", label: "AI Summary", color: "#e2e8f0" },
      { id: "grammar", label: "Grammar", count: result.grammar_fixes, color: "#6366f1" },
      { id: "punctuation", label: "Punctuation", count: result.punctuation_fixes, color: "#f59e0b" },
      { id: "style", label: "Style", count: result.style_suggestions, color: "#10b981" },
      { id: "corrected", label: "Corrected Text", color: "#94a3b8" },
    ]
    : [];

  const getDetailList = (): ErrorDetail[] => {
    if (!result) return [];
    if (activeTab === "grammar") return result.grammar_details ?? [];
    if (activeTab === "punctuation") return result.punctuation_details ?? [];
    if (activeTab === "style") return result.style_details ?? [];
    return [];
  };

  const tabColor =
    TABS.find((t) => t.id === activeTab)?.color ?? "#e2e8f0";

  const categoryMeta: Record<string, { label: string; emptyMsg: string; badgeColor: string; badgeBg: string }> = {
    grammar: {
      label: "Grammar Fix",
      emptyMsg: "No grammar errors found — great writing!",
      badgeColor: "#818cf8",
      badgeBg: "rgba(99,102,241,0.12)",
    },
    punctuation: {
      label: "Punctuation Fix",
      emptyMsg: "No punctuation errors found.",
      badgeColor: "#fbbf24",
      badgeBg: "rgba(245,158,11,0.12)",
    },
    style: {
      label: "Style Suggestion",
      emptyMsg: "No style suggestions — the prose flows well.",
      badgeColor: "#34d399",
      badgeBg: "rgba(16,185,129,0.12)",
    },
  };

  // Derive a human-readable loading stage label
  const loadingLabel = (() => {
    if (!loading) return "";
    if (uploadProgress < 100) return `Uploading… ${uploadProgress}%`;
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    if (chunkProgress && chunkProgress.total > 1) {
      const chunkPct = Math.round((chunkProgress.done / chunkProgress.total) * 100);
      return `Proofreading chunk ${chunkProgress.done} of ${chunkProgress.total} (${chunkPct}%) — ${elapsed} elapsed. Please keep this tab open.`;
    }
    return `Analysing document… ${elapsed} elapsed. Large files can take 10–20 min — please keep this tab open.`;
  })();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c0f1a",
        fontFamily: "'DM Sans', sans-serif",
        color: "#e2e8f0",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          padding: "0 40px",
          height: "60px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          position: "sticky",
          top: 0,
          background: "rgba(12,15,26,0.95)",
          backdropFilter: "blur(12px)",
          zIndex: 50,
        }}
      >
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "none",
            border: "none",
            color: "#64748b",
            fontSize: "13px",
            cursor: "pointer",
            padding: "6px 0",
            transition: "color 0.2s",
          }}
          onMouseOver={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0")
          }
          onMouseOut={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#64748b")
          }
        >
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
        <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              background: "rgba(16,185,129,0.15)",
              border: "1px solid rgba(16,185,129,0.3)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={14} color="#10b981" />
          </div>
          <span style={{ fontWeight: "600", fontSize: "14px" }}>
            AI Proofreader
          </span>
        </div>
      </nav>

      <main
        style={{ maxWidth: "820px", margin: "0 auto", padding: "52px 40px" }}
      >
        {/* Header */}
        <div style={{ marginBottom: "40px" }}>
          <h1
            style={{
              fontSize: "36px",
              fontWeight: "800",
              letterSpacing: "-0.03em",
              fontFamily: "'Playfair Display', serif",
              marginBottom: "10px",
            }}
          >
            Proofread Your Document
          </h1>
          <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6" }}>
            Upload a .txt, .docx, .pdf, .md, .rtf, or .zip file. AI will correct grammar,
            punctuation, and suggest style improvements — with full error breakdowns.
          </p>
        </div>

        {/* Upload zone */}
        {!result && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !file && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "#10b981" : file ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: "16px",
              padding: "48px 32px",
              textAlign: "center",
              cursor: file ? "default" : "pointer",
              background: dragging
                ? "rgba(16,185,129,0.06)"
                : file
                  ? "rgba(16,185,129,0.04)"
                  : "rgba(255,255,255,0.02)",
              transition: "all 0.2s",
              marginBottom: "20px",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.docx,.pdf,.md,.rtf,.zip"
              style={{ display: "none" }}
              onChange={(e) =>
                e.target.files?.[0] && handleFile(e.target.files[0])
              }
            />

            {file ? (
              <div>
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    background: "rgba(16,185,129,0.12)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                  }}
                >
                  <FileText size={24} color="#10b981" />
                </div>
                <p style={{ fontWeight: "600", fontSize: "15px", marginBottom: "4px" }}>
                  {file.name}
                </p>
                <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "12px" }}>
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    padding: "6px 14px",
                    color: "#94a3b8",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <X size={12} /> Remove
                </button>
              </div>
            ) : (
              <div>
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                  }}
                >
                  <Upload size={24} color="#64748b" />
                </div>
                <p style={{ fontWeight: "600", fontSize: "15px", marginBottom: "6px" }}>
                  Drop your document here
                </p>
                <p style={{ color: "#64748b", fontSize: "13px" }}>
                  or click to browse · .txt .docx .pdf .md .rtf .zip · max 150 MB
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "10px",
              padding: "12px 16px",
              color: "#f87171",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}

        {/* Submit button + upload progress bar */}
        {file && !result && (
          <div style={{ marginBottom: "32px" }}>
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                width: "100%",
                background: loading
                  ? "rgba(16,185,129,0.4)"
                  : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "white",
                border: "none",
                borderRadius: "12px",
                padding: "14px 24px",
                fontSize: "14px",
                fontWeight: "700",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                transition: "background 0.2s",
                letterSpacing: "0.01em",
              }}
            >
              {loading ? (
                <>
                  <Loader size={18} style={{ animation: "spin 1s linear infinite" }} />
                  {loadingLabel}
                </>
              ) : (
                <>
                  <Sparkles size={18} /> Run AI Proofreader
                </>
              )}
            </button>

            {/* Upload progress bar — only visible while uploading */}
            {loading && uploadProgress > 0 && uploadProgress < 100 && (
              <div
                style={{
                  marginTop: "10px",
                  height: "4px",
                  borderRadius: "99px",
                  background: "rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${uploadProgress}%`,
                    background: "linear-gradient(90deg, #10b981, #059669)",
                    borderRadius: "99px",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            )}

            {/* Post-upload waiting hint */}
            {loading && uploadProgress === 100 && (
              <p
                style={{
                  marginTop: "10px",
                  fontSize: "12px",
                  color: "#475569",
                  textAlign: "center",
                }}
              >
                Upload complete — AI is now analysing your document chunk by chunk. Large Hindi/Devanagari files may take 10–20 minutes. Do not close this tab.
              </p>
            )}
          </div>
        )}

        {/* ── RESULTS ── */}
        {result && (
          <div style={{ animation: "fadeInUp 0.4s ease forwards" }}>
            {/* Success banner */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.25)",
                borderRadius: "12px",
                padding: "16px 20px",
                marginBottom: "24px",
              }}
            >
              <CheckCircle size={20} color="#10b981" />
              <div>
                <p style={{ fontWeight: "600", fontSize: "14px" }}>
                  Proofreading complete
                </p>
                <p style={{ color: "#64748b", fontSize: "12px", marginTop: "2px" }}>
                  {result.original_filename}
                </p>
              </div>
            </div>

            {/* ── Selective PDF Generator ─────────────────────────────────── */}
            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "14px",
                padding: "22px 24px",
                marginBottom: "28px",
              }}
            >
              <p
                style={{
                  fontSize: "13px",
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#94a3b8",
                  marginBottom: "14px",
                }}
              >
                Generate Corrected PDF
              </p>
              <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "16px", lineHeight: "1.6" }}>
                Choose which types of corrections to include in your downloaded PDF:
              </p>

              {/* Checkboxes */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
                {[
                  {
                    key: "grammar" as const,
                    label: "Grammar Fixes",
                    count: result.grammar_fixes,
                    color: "#6366f1",
                    bg: "rgba(99,102,241,0.1)",
                    border: "rgba(99,102,241,0.25)",
                    icon: "✦",
                    checked: applyGrammar,
                    set: setApplyGrammar,
                  },
                  {
                    key: "punctuation" as const,
                    label: "Punctuation Fixes",
                    count: result.punctuation_fixes,
                    color: "#f59e0b",
                    bg: "rgba(245,158,11,0.1)",
                    border: "rgba(245,158,11,0.25)",
                    icon: "✎",
                    checked: applyPunctuation,
                    set: setApplyPunctuation,
                  },
                  {
                    key: "style" as const,
                    label: "Style Suggestions",
                    count: result.style_suggestions,
                    color: "#10b981",
                    bg: "rgba(16,185,129,0.1)",
                    border: "rgba(16,185,129,0.25)",
                    icon: "◈",
                    checked: applyStyle,
                    set: setApplyStyle,
                  },
                ].map((opt) => (
                  <label
                    key={opt.key}
                    onClick={() => opt.set(!opt.checked)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                      padding: "12px 16px",
                      borderRadius: "10px",
                      border: `1px solid ${opt.checked ? opt.border : "rgba(255,255,255,0.07)"}`,
                      background: opt.checked ? opt.bg : "transparent",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      userSelect: "none",
                    }}
                  >
                    {/* Custom checkbox */}
                    <div
                      style={{
                        width: "18px",
                        height: "18px",
                        borderRadius: "5px",
                        border: `2px solid ${opt.checked ? opt.color : "rgba(255,255,255,0.2)"}`,
                        background: opt.checked ? opt.color : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "all 0.15s",
                      }}
                    >
                      {opt.checked && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>

                    {/* Icon + Label */}
                    <span style={{ fontSize: "16px", opacity: 0.8 }}>{opt.icon}</span>
                    <span style={{ flex: 1, fontSize: "13px", fontWeight: "600", color: opt.checked ? "#e2e8f0" : "#64748b" }}>
                      {opt.label}
                    </span>

                    {/* Count badge */}
                    <span
                      style={{
                        background: opt.checked ? `${opt.color}22` : "rgba(255,255,255,0.05)",
                        color: opt.checked ? opt.color : "#475569",
                        borderRadius: "20px",
                        padding: "2px 10px",
                        fontSize: "12px",
                        fontWeight: "700",
                        transition: "all 0.15s",
                      }}
                    >
                      {opt.count}
                    </span>
                  </label>
                ))}
              </div>

              {/* PDF error */}
              {pdfError && (
                <div
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    color: "#f87171",
                    fontSize: "12px",
                    marginBottom: "10px",
                  }}
                >
                  {pdfError}
                </div>
              )}

              {/* DOCX error */}
              {docxError && (
                <div
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    color: "#f87171",
                    fontSize: "12px",
                    marginBottom: "10px",
                  }}
                >
                  {docxError}
                </div>
              )}

              {/* Download buttons — side by side */}
              <div style={{ display: "flex", gap: "10px" }}>
                {/* Download Selective PDF */}
                <button
                  onClick={handleGeneratePdf}
                  disabled={pdfGenerating || (!applyGrammar && !applyPunctuation && !applyStyle)}
                  style={{
                    flex: 1,
                    background:
                      pdfGenerating || (!applyGrammar && !applyPunctuation && !applyStyle)
                        ? "rgba(99,102,241,0.3)"
                        : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                    color: "white",
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 16px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor:
                      pdfGenerating || (!applyGrammar && !applyPunctuation && !applyStyle)
                        ? "not-allowed"
                        : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    transition: "background 0.2s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {pdfGenerating ? (
                    <>
                      <Loader size={15} style={{ animation: "spin 1s linear infinite" }} />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Download size={15} />
                      Download PDF
                    </>
                  )}
                </button>

                {/* Download Selective DOCX */}
                <button
                  onClick={handleGenerateDocx}
                  disabled={docxGenerating || (!applyGrammar && !applyPunctuation && !applyStyle)}
                  style={{
                    flex: 1,
                    background:
                      docxGenerating || (!applyGrammar && !applyPunctuation && !applyStyle)
                        ? "rgba(16,185,129,0.3)"
                        : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                    color: "white",
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 16px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor:
                      docxGenerating || (!applyGrammar && !applyPunctuation && !applyStyle)
                        ? "not-allowed"
                        : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    transition: "background 0.2s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {docxGenerating ? (
                    <>
                      <Loader size={15} style={{ animation: "spin 1s linear infinite" }} />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Download size={15} />
                      Download DOCX
                    </>
                  )}
                </button>
              </div>

              {/* Helper note */}
              {!applyGrammar && !applyPunctuation && !applyStyle && (
                <p style={{ fontSize: "11px", color: "#ef4444", marginTop: "8px", textAlign: "center" }}>
                  Select at least one correction type above.
                </p>
              )}
            </div>
            {/* ── End Selective PDF Generator ──────────────────────────────── */}

            {/* Stat cards — clickable to jump to that tab */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "12px",
                marginBottom: "28px",
              }}
            >
              {[
                { id: "grammar" as TabType, label: "Grammar Fixes", value: result.grammar_fixes, color: "#6366f1", icon: "✦" },
                { id: "punctuation" as TabType, label: "Punctuation Fixes", value: result.punctuation_fixes, color: "#f59e0b", icon: "✎" },
                { id: "style" as TabType, label: "Style Suggestions", value: result.style_suggestions, color: "#10b981", icon: "◈" },
              ].map((s) => (
                <div
                  key={s.label}
                  onClick={() => setActiveTab(s.id)}
                  style={{
                    background: activeTab === s.id ? `${s.color}18` : `${s.color}10`,
                    border: `1px solid ${activeTab === s.id ? s.color + "55" : s.color + "25"}`,
                    borderRadius: "12px",
                    padding: "20px",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    transform: activeTab === s.id ? "translateY(-2px)" : "none",
                    boxShadow: activeTab === s.id ? `0 8px 24px ${s.color}22` : "none",
                  }}
                >
                  <div style={{ fontSize: "24px", marginBottom: "4px" }}>{s.icon}</div>
                  <div
                    style={{
                      fontSize: "32px",
                      fontWeight: "800",
                      fontFamily: "'Playfair Display', serif",
                      color: s.color,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {s.value}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      marginTop: "4px",
                      fontWeight: "600",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "11px",
                      color: s.color,
                      opacity: 0.7,
                    }}
                  >
                    Click to view details →
                  </div>
                </div>
              ))}
            </div>

            {/* Tab bar */}
            <div
              style={{
                display: "flex",
                gap: "4px",
                background: "rgba(255,255,255,0.04)",
                borderRadius: "10px",
                padding: "4px",
                marginBottom: "16px",
                overflowX: "auto",
              }}
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "600",
                    background:
                      activeTab === tab.id
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                    color: activeTab === tab.id ? tab.color : "#64748b",
                    transition: "all 0.15s",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      style={{
                        background: `${tab.color}22`,
                        color: tab.color,
                        borderRadius: "20px",
                        padding: "1px 7px",
                        fontSize: "11px",
                        fontWeight: "700",
                      }}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content panel */}
            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "12px",
                padding: "24px",
                minHeight: "200px",
              }}
            >
              {/* Summary tab */}
              {activeTab === "summary" && (
                <p
                  style={{
                    fontSize: "14px",
                    color: "#94a3b8",
                    lineHeight: "1.9",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {result.corrections_summary}
                </p>
              )}

              {/* Corrected text tab */}
              {activeTab === "corrected" && (
                correctedTextLoading ? (
                  <div style={{ color: "#64748b", fontSize: "14px", padding: "24px 0", textAlign: "center" }}>
                    Loading corrected text…
                  </div>
                ) : result.corrected_text ? (
                  <pre
                    style={{
                      fontSize: "13px",
                      color: "#cbd5e1",
                      lineHeight: "1.9",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "'DM Mono', monospace",
                      maxHeight: "500px",
                      overflowY: "auto",
                    }}
                  >
                    {result.corrected_text}
                  </pre>
                ) : (
                  <div style={{ color: "#64748b", fontSize: "14px", padding: "24px 0", textAlign: "center" }}>
                    Corrected text preview unavailable — use the Download button above to get the full corrected document.
                  </div>
                )
              )}

              {/* Grammar / Punctuation / Style detail tabs */}
              {(activeTab === "grammar" || activeTab === "punctuation" || activeTab === "style") && (() => {
                const details = getDetailList();
                const meta = categoryMeta[activeTab];
                if (!details || details.length === 0) {
                  return (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "40px",
                        color: "#475569",
                        gap: "8px",
                      }}
                    >
                      <CheckCircle size={32} color="#10b981" style={{ opacity: 0.5 }} />
                      <p style={{ fontSize: "14px" }}>{meta.emptyMsg}</p>
                    </div>
                  );
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {details.map((item, idx) => {
                      const key = `${activeTab}-${idx}`;
                      const isOpen = expandedErrors.has(key);
                      return (
                        <div
                          key={key}
                          style={{
                            border: `1px solid rgba(255,255,255,0.07)`,
                            borderRadius: "10px",
                            overflow: "hidden",
                            transition: "border-color 0.2s",
                          }}
                        >
                          {/* Collapsed header — always visible */}
                          <div
                            onClick={() => toggleError(key)}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "12px",
                              padding: "14px 16px",
                              cursor: "pointer",
                              background: isOpen
                                ? "rgba(255,255,255,0.04)"
                                : "transparent",
                              transition: "background 0.15s",
                            }}
                          >
                            {/* Index badge */}
                            <span
                              style={{
                                flexShrink: 0,
                                width: "22px",
                                height: "22px",
                                borderRadius: "6px",
                                background: meta.badgeBg,
                                color: meta.badgeColor,
                                fontSize: "11px",
                                fontWeight: "700",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginTop: "1px",
                              }}
                            >
                              {idx + 1}
                            </span>

                            {/* Original snippet with strikethrough */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "13px",
                                    color: "#ef4444",
                                    textDecoration: "line-through",
                                    fontFamily: "'DM Mono', monospace",
                                    opacity: 0.85,
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {item.original}
                                </span>
                                <span style={{ color: "#475569", fontSize: "12px" }}>→</span>
                                <span
                                  style={{
                                    fontSize: "13px",
                                    color: "#4ade80",
                                    fontFamily: "'DM Mono', monospace",
                                    fontWeight: "500",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {item.corrected}
                                </span>
                              </div>
                            </div>

                            {/* Expand toggle */}
                            <span
                              style={{
                                flexShrink: 0,
                                color: "#475569",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              {isOpen ? (
                                <ChevronUp size={15} />
                              ) : (
                                <ChevronDown size={15} />
                              )}
                            </span>
                          </div>

                          {/* Expanded explanation */}
                          {isOpen && (
                            <div
                              style={{
                                padding: "0 16px 14px 50px",
                                borderTop: "1px solid rgba(255,255,255,0.05)",
                              }}
                            >
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  background: meta.badgeBg,
                                  border: `1px solid ${meta.badgeColor}33`,
                                  borderRadius: "6px",
                                  padding: "3px 10px",
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  letterSpacing: "0.06em",
                                  textTransform: "uppercase",
                                  color: meta.badgeColor,
                                  marginTop: "12px",
                                  marginBottom: "8px",
                                }}
                              >
                                {meta.label}
                              </div>
                              <p
                                style={{
                                  fontSize: "13px",
                                  color: "#94a3b8",
                                  lineHeight: "1.6",
                                }}
                              >
                                {item.explanation}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* New upload */}
            <button
              onClick={() => {
                setResult(null);
                setFile(null);
                setExpandedErrors(new Set());
              }}
              style={{
                marginTop: "20px",
                background: "none",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "10px 20px",
                color: "#64748b",
                fontSize: "13px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0";
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
              }}
            >
              ← Proofread another document
            </button>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}