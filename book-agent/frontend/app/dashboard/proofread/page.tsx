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
  AlertCircle,
  FileDown,
  BookOpen,
} from "lucide-react";
import { proofreadDocument, downloadProofreadDoc, parseFriendlyError } from "@/lib/api";

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
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
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
        setActiveJobId(null);
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
        setActiveJobId(null);
    setApplyGrammar(true);
    setApplyPunctuation(true);
    setApplyStyle(true);
    setPdfError("");

    const timer = setInterval(() => {
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

      if (res.data.download_url) {
        setCorrectedTextLoading(true);
        try {
          const baseURL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
          const textRes = await fetch(`${baseURL}${res.data.download_url}?format=txt`);
          if (textRes.ok) {
            const text = await textRes.text();
            setResult((prev) => prev ? { ...prev, corrected_text: text } : prev);
          }
        } catch (_) { }
        finally {
          setCorrectedTextLoading(false);
        }
      }
    } catch (err: unknown) {
      setError(parseFriendlyError(err));
    } finally {
      clearInterval(timer);
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
      setPdfError(parseFriendlyError(err));
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
      setDocxError(parseFriendlyError(err));
    } finally {
      setDocxGenerating(false);
    }
  };

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timerStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  let loadingLabel = "Initializing…";
  if (uploadProgress > 0 && uploadProgress < 100) {
    loadingLabel = `Uploading document: ${uploadProgress}%`;
  } else if (uploadProgress === 100) {
    if (chunkProgress) {
      loadingLabel = `Parsing chunk ${chunkProgress.done} of ${chunkProgress.total}…`;
    } else {
      loadingLabel = `AI processing sections (elapsed: ${timerStr})…`;
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--void)",
      fontFamily: "'DM Sans', sans-serif",
      color: "var(--text-primary)",
      position: "relative",
    }}>
      <div className="grid-overlay" />

      {/* Nav */}
      <nav className="glass" style={{
        borderBottom: "1.5px solid var(--border-mid)",
        padding: "0 40px", height: "60px",
        display: "flex", alignItems: "center", gap: "16px",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <button onClick={() => router.push("/dashboard")} className="btn-ghost" style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 12px", fontSize: "12px", borderRadius: "8px"
        }}>
          <ArrowLeft size={13} /> Dashboard
        </button>
        <span style={{ color: "var(--border-mid)" }}>|</span>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <div style={{
            width: "28px", height: "28px",
            background: "var(--text-primary)",
            borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Sparkles size={14} color="var(--void)" />
          </div>
          <span style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>AI Proofreader</span>
        </div>
      </nav>

      <main style={{ maxWidth: "880px", margin: "0 auto", padding: "64px 32px 96px", position: "relative", zIndex: 2 }}>
        
        {/* Header */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
            borderRadius: "20px", padding: "4px 14px",
            fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em",
            color: "var(--emerald)", marginBottom: "16px",
            boxShadow: "0 4px 10px rgba(0,0,0,0.02)",
          }}>
            <Sparkles size={10} /> GRAMMAR & READABILITY ENGINE
          </div>
          <h1 className="serif" style={{
            fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em",
            marginBottom: "10px", color: "var(--text-primary)"
          }}>
            Proofread Your Document
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.6" }}>
            Upload any text file or PDF manuscript. AI will scan grammatical errors, punctuation anomalies, and make suggestions to improve formatting style.
          </p>
        </div>

        {/* Upload zone */}
        {!result && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !file && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "var(--emerald)" : file ? "rgba(16,185,129,0.4)" : "var(--border-strong)"}`,
              borderRadius: "20px", padding: "48px 32px",
              background: dragging ? "rgba(16, 185, 129, 0.05)" : file ? "rgba(16, 185, 129, 0.02)" : "var(--onyx)",
              cursor: file ? "default" : "pointer", textAlign: "center",
              transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)", marginBottom: "20px",
              boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.02)",
            }}
          >
            <input
              ref={fileInputRef} type="file"
              accept=".txt,.docx,.pdf,.md,.rtf,.zip"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {file ? (
              <div>
                <div style={{
                  width: "56px", height: "56px", margin: "0 auto 16px",
                  background: "var(--void)", border: "1.5px solid var(--border-mid)",
                  borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <FileText size={24} color="var(--emerald)" />
                </div>
                <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "4px", color: "var(--text-primary)" }}>
                  {file.name}
                </p>
                <p style={{ color: "var(--text-tertiary)", fontSize: "12px", marginBottom: "14px" }}>
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="btn-ghost"
                  style={{
                    padding: "6px 14px", fontSize: "12px", borderRadius: "8px",
                    background: "rgba(239, 68, 68, 0.05)", color: "var(--crimson)", border: "none"
                  }}
                >
                  <X size={12} /> Remove file
                </button>
              </div>
            ) : (
              <div>
                <div style={{
                  width: "56px", height: "56px", margin: "0 auto 16px",
                  background: "var(--void)", border: "1.5px solid var(--border-mid)",
                  borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Upload size={22} color="var(--emerald)" />
                </div>
                <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "6px", color: "var(--text-primary)" }}>
                  Drop your document here
                </p>
                <p style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>
                  or click to select · TXT, DOCX, PDF, MD, RTF, ZIP · max 150 MB
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)",
            borderRadius: "10px", padding: "12px 16px", color: "var(--crimson)", fontSize: "13px", marginBottom: "16px"
          }}>
            {error}
          </div>
        )}

        {/* Submit action */}
        {file && !result && (
          <div style={{ marginBottom: "32px" }}>
            <button
              onClick={handleSubmit} disabled={loading}
              className="btn-dark"
              style={{
                width: "100%", padding: "13px 24px", fontSize: "14px", borderRadius: "12px",
                justifyContent: "center", opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? (
                <>
                  <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
                  {loadingLabel}
                </>
              ) : (
                <>
                  <Sparkles size={16} /> Run AI Proofreader
                </>
              )}
            </button>

            {loading && (
              <div className="card pulse-glow" style={{
                background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
                borderRadius: "14px", padding: "20px", marginTop: "16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "var(--emerald)" }}>Analyzing Draft</span>
                  <span className="serif" style={{ fontSize: "20px", color: "var(--text-primary)" }}>
                    {uploadProgress === 100 ? "Processing" : `${uploadProgress}%`}
                  </span>
                </div>
                {uploadProgress < 100 ? (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${uploadProgress}%`, background: "var(--emerald)" }} />
                  </div>
                ) : (
                  <p style={{ fontSize: "12px", color: "var(--text-tertiary)", lineHeight: 1.5, margin: 0 }}>
                    Upload complete. Our AI is parsing your text blocks sequentially. Keep this browser window open.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── RESULTS ── */}
        {result && (
          <div style={{ animation: "fadeInUp 0.4s ease forwards" }}>
            
            {/* Success panel */}
            <div className="card" style={{
              display: "flex", alignItems: "center", gap: "16px",
              background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
              borderRadius: "16px", padding: "20px 24px", marginBottom: "28px"
            }}>
              <div style={{
                width: "44px", height: "44px",
                background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)",
                borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
              }}>
                <CheckCircle size={22} color="var(--emerald)" />
              </div>
              <div style={{ flex: 1 }}>
                <h3 className="serif" style={{ fontWeight: "400", fontSize: "18px", color: "var(--text-primary)" }}>
                  Proofreading complete
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "12px", marginTop: "3px" }}>
                  {result.original_filename}
                </p>
              </div>
            </div>

            {/* Selective PDF/DOCX Generator block */}
            <div className="card" style={{
              background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
              borderRadius: "16px", padding: "24px", marginBottom: "32px",
            }}>
              <p className="field-label" style={{ color: "var(--emerald)", marginBottom: "12px" }}>Download Corrected Document</p>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "18px", lineHeight: 1.5 }}>
                Filter which categories of changes to apply to your downloaded document:
              </p>

              {/* Toggles */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
                {[
                  {
                    key: "grammar" as const, label: "Grammar Fixes", count: result.grammar_fixes,
                    color: "var(--violet)", bg: "rgba(139,92,246,0.06)", checked: applyGrammar, set: setApplyGrammar
                  },
                  {
                    key: "punctuation" as const, label: "Punctuation Fixes", count: result.punctuation_fixes,
                    color: "var(--amber)", bg: "rgba(245,158,11,0.06)", checked: applyPunctuation, set: setApplyPunctuation
                  },
                  {
                    key: "style" as const, label: "Style Improvements", count: result.style_suggestions,
                    color: "var(--sapphire)", bg: "var(--sapphire-dim)", checked: applyStyle, set: setApplyStyle
                  }
                ].map(opt => (
                  <label key={opt.key} style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    background: "var(--void)", border: `1.5px solid var(--border-mid)`,
                    borderRadius: "12px", padding: "12px 16px", cursor: "pointer",
                  }}>
                    <input type="checkbox" checked={opt.checked} onChange={e => opt.set(e.target.checked)}
                      style={{ width: "16px", height: "16px", accentColor: opt.color, cursor: "pointer" }} />
                    <span style={{ flex: 1, fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>{opt.label}</span>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: opt.color, background: opt.bg, padding: "3px 10px", borderRadius: "10px" }}>
                      {opt.count} issues
                    </span>
                  </label>
                ))}
              </div>

              {/* PDF & DOCX triggers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <button onClick={handleGeneratePdf} disabled={pdfGenerating} className="btn-dark" style={{ width: "100%", justifyContent: "center" }}>
                    {pdfGenerating ? <><Loader size={13} style={{ animation: "spin 1.1s linear infinite" }} /> PDF Generating…</> : <><FileDown size={14} /> Download PDF</>}
                  </button>
                  {pdfError && <p style={{ color: "var(--crimson)", fontSize: "11px", marginTop: "6px" }}>{pdfError}</p>}
                </div>

                <div>
                  <button onClick={handleGenerateDocx} disabled={docxGenerating} className="btn-outline" style={{ width: "100%", justifyContent: "center" }}>
                    {docxGenerating ? <><Loader size={13} style={{ animation: "spin 1.1s linear infinite" }} /> DOCX Generating…</> : <><Download size={14} /> Download DOCX</>}
                  </button>
                  {docxError && <p style={{ color: "var(--crimson)", fontSize: "11px", marginTop: "6px" }}>{docxError}</p>}
                </div>
              </div>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: "flex", borderBottom: "1.5px solid var(--border-mid)", gap: "4px", marginBottom: "20px" }}>
              {(["summary", "grammar", "punctuation", "style", "corrected"] as const).map(tab => {
                const isActive = activeTab === tab;
                let countLabel = "";
                if (tab === "grammar") countLabel = ` (${result.grammar_fixes})`;
                if (tab === "punctuation") countLabel = ` (${result.punctuation_fixes})`;
                if (tab === "style") countLabel = ` (${result.style_suggestions})`;
                return (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    background: "none", border: "none",
                    padding: "10px 16px", fontSize: "13px", fontWeight: isActive ? "700" : "500",
                    color: isActive ? "var(--emerald)" : "var(--text-tertiary)",
                    borderBottom: `2px solid ${isActive ? "var(--emerald)" : "transparent"}`,
                    cursor: "pointer", textTransform: "capitalize",
                  }}>
                    {tab === "style" ? "Style Suggestions" : tab + countLabel}
                  </button>
                );
              })}
            </div>

            {/* Tab content panel */}
            <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "28px" }}>
              
              {/* SUMMARY TAB */}
              {activeTab === "summary" && (
                <div style={{ fontSize: "14px", lineHeight: "1.7", color: "var(--text-primary)" }}>
                  <h4 className="serif" style={{ fontSize: "20px", color: "var(--text-primary)", marginBottom: "12px" }}>Executive Summary</h4>
                  <div style={{ whiteSpace: "pre-line" }}>{result.corrections_summary}</div>
                </div>
              )}

              {/* CORRECTED TAB */}
              {activeTab === "corrected" && (
                <div>
                  <h4 className="serif" style={{ fontSize: "20px", color: "var(--text-primary)", marginBottom: "12px" }}>Full corrected manuscript preview</h4>
                  {correctedTextLoading ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "20px 0" }}>
                      <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                      <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Fetching corrected text preview…</span>
                    </div>
                  ) : result.corrected_text ? (
                    <pre style={{
                      whiteSpace: "pre-wrap", background: "var(--void)", border: "1px solid var(--border-mid)",
                      padding: "16px", borderRadius: "10px", fontSize: "12px", fontFamily: "inherit",
                      maxHeight: "400px", overflowY: "auto", color: "var(--text-primary)"
                    }}>{result.corrected_text}</pre>
                  ) : (
                    <p style={{ color: "var(--text-tertiary)", fontSize: "12px" }}>Manuscript preview not available. Please use the downloads above.</p>
                  )}
                </div>
              )}

              {/* LIST DETAILS TABS */}
              {["grammar", "punctuation", "style"].includes(activeTab) && (() => {
                const type = activeTab === "grammar" ? "grammar_details" : activeTab === "punctuation" ? "punctuation_details" : "style_details";
                const list = result[type] || [];
                if (list.length === 0) {
                  return <p style={{ color: "var(--text-tertiary)", fontSize: "13px", padding: "16px 0" }}>No issues found in this category.</p>;
                }
                const colorTheme = activeTab === "grammar" ? "var(--violet)" : activeTab === "punctuation" ? "var(--amber)" : "var(--sapphire)";

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {list.map((err, i) => {
                      const key = `${activeTab}-${i}`;
                      const isExpanded = expandedErrors.has(key);
                      return (
                        <div key={i} style={{ border: `1.5px solid var(--border-mid)`, borderRadius: "12px", overflow: "hidden" }}>
                          {/* Header toggle */}
                          <div onClick={() => toggleError(key)} style={{
                            display: "flex", alignItems: "center", gap: "14px",
                            padding: "14px 18px", background: "var(--void)", cursor: "pointer"
                          }}>
                            <span style={{ fontSize: "12px", fontWeight: "700", color: colorTheme, border: `1px solid ${colorTheme}`, padding: "2px 8px", borderRadius: "4px" }}>
                              Issue {i + 1}
                            </span>
                            <span style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              Original: &ldquo;{err.original}&rdquo;
                            </span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>

                          {/* Details panel */}
                          {isExpanded && (
                            <div style={{ padding: "18px", borderTop: "1.5px solid var(--border-mid)", background: "var(--onyx)", display: "flex", flexDirection: "column", gap: "12px" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                                <div style={{ background: "rgba(239, 68, 68, 0.03)", border: "1px solid rgba(239, 68, 68, 0.15)", padding: "12px", borderRadius: "8px" }}>
                                  <span style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", color: "var(--crimson)" }}>Original Text</span>
                                  <p style={{ fontSize: "13px", color: "var(--text-primary)", marginTop: "4px" }}>{err.original}</p>
                                </div>
                                <div style={{ background: "rgba(16, 185, 129, 0.03)", border: "1px solid rgba(16, 185, 129, 0.15)", padding: "12px", borderRadius: "8px" }}>
                                  <span style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", color: "var(--emerald)" }}>Corrected Text</span>
                                  <p style={{ fontSize: "13px", color: "var(--text-primary)", marginTop: "4px" }}>{err.corrected}</p>
                                </div>
                              </div>
                              <div>
                                <span className="field-label" style={{ fontSize: "10px" }}>AI Rationale</span>
                                <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5 }}>{err.explanation}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Clear button */}
            <button onClick={() => { setResult(null); setFile(null); setError("");
        setActiveJobId(null); }}
              className="btn-outline" style={{ marginTop: "24px" }}>
              ← Proofread another file
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
