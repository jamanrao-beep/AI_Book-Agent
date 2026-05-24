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
  AlertCircle,
  Sparkles,
  X,
} from "lucide-react";
import { proofreadDocument, downloadProofreadDoc } from "@/lib/api";

interface ProofResult {
  job_id: string;
  original_filename: string;
  corrections_summary: string;
  grammar_fixes: number;
  punctuation_fixes: number;
  style_suggestions: number;
  corrected_text: string;
}

export default function ProofreadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"summary" | "corrected">(
    "summary",
  );

  const handleFile = (f: File) => {
    const allowed = [
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (
      !allowed.includes(f.type) &&
      !f.name.endsWith(".txt") &&
      !f.name.endsWith(".docx")
    ) {
      setError("Please upload a .txt or .docx file.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
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
    setError("");
    try {
      const res = await proofreadDocument(file);
      setResult(res.data);
      setActiveTab("summary");
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Proofreading failed. Make sure the backend is running.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const statCards = result
    ? [
        {
          label: "Grammar Fixes",
          value: result.grammar_fixes,
          color: "#6366f1",
          icon: "✦",
        },
        {
          label: "Punctuation Fixes",
          value: result.punctuation_fixes,
          color: "#f59e0b",
          icon: "✎",
        },
        {
          label: "Style Suggestions",
          value: result.style_suggestions,
          color: "#10b981",
          icon: "◈",
        },
      ]
    : [];

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
        style={{ maxWidth: "780px", margin: "0 auto", padding: "52px 40px" }}
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
            Upload a .txt or .docx file. AI will correct grammar, punctuation,
            and suggest style improvements.
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
              accept=".txt,.docx"
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
                  <FileText size={26} color="#10b981" />
                </div>
                <p
                  style={{
                    fontWeight: "600",
                    fontSize: "15px",
                    marginBottom: "4px",
                  }}
                >
                  {file.name}
                </p>
                <p
                  style={{
                    color: "#64748b",
                    fontSize: "13px",
                    marginBottom: "16px",
                  }}
                >
                  {(file.size / 1024).toFixed(1)} KB · ready to proofread
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    color: "#94a3b8",
                    cursor: "pointer",
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
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                  }}
                >
                  <Upload size={24} color="#64748b" />
                </div>
                <p
                  style={{
                    fontWeight: "600",
                    fontSize: "15px",
                    marginBottom: "6px",
                  }}
                >
                  Drop your document here
                </p>
                <p style={{ color: "#64748b", fontSize: "13px" }}>
                  or click to browse · .txt or .docx · max 10 MB
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "10px",
              padding: "14px 18px",
              fontSize: "13px",
              color: "#f87171",
              marginBottom: "20px",
            }}
          >
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Submit button */}
        {file && !result && (
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: "100%",
              background: loading ? "rgba(16,185,129,0.4)" : "#10b981",
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
              marginBottom: "32px",
            }}
          >
            {loading ? (
              <>
                <Loader
                  size={18}
                  style={{ animation: "spin 1s linear infinite" }}
                />
                Analysing document...
              </>
            ) : (
              <>
                <Sparkles size={18} /> Run AI Proofreader
              </>
            )}
          </button>
        )}

        {/* Results */}
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
                <p
                  style={{
                    color: "#64748b",
                    fontSize: "12px",
                    marginTop: "2px",
                  }}
                >
                  {result.original_filename}
                </p>
              </div>
              <button
                onClick={() =>
                  downloadProofreadDoc(result.job_id, result.original_filename)
                }
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#10b981",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                <Download size={14} /> Download Corrected
              </button>
            </div>

            {/* Stat cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "12px",
                marginBottom: "24px",
              }}
            >
              {statCards.map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: `${s.color}10`,
                    border: `1px solid ${s.color}25`,
                    borderRadius: "12px",
                    padding: "20px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "28px", marginBottom: "4px" }}>
                    {s.icon}
                  </div>
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
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div
              style={{
                display: "flex",
                gap: "4px",
                background: "rgba(255,255,255,0.04)",
                borderRadius: "10px",
                padding: "4px",
                marginBottom: "16px",
                width: "fit-content",
              }}
            >
              {(["summary", "corrected"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "600",
                    background:
                      activeTab === tab
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                    color: activeTab === tab ? "#e2e8f0" : "#64748b",
                    transition: "all 0.15s",
                    textTransform: "capitalize",
                  }}
                >
                  {tab === "summary" ? "AI Summary" : "Corrected Text"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              {activeTab === "summary" ? (
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "#94a3b8",
                      lineHeight: "1.8",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {result.corrections_summary}
                  </p>
                </div>
              ) : (
                <div>
                  <pre
                    style={{
                      fontSize: "13px",
                      color: "#cbd5e1",
                      lineHeight: "1.9",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "'DM Mono', monospace",
                      maxHeight: "400px",
                      overflowY: "auto",
                    }}
                  >
                    {result.corrected_text}
                  </pre>
                </div>
              )}
            </div>

            {/* New upload */}
            <button
              onClick={() => {
                setResult(null);
                setFile(null);
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
