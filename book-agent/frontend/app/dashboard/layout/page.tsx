"use client";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Upload,
    Loader,
    CheckCircle,
    Download,
    Sparkles,
    LayoutTemplate,
    X,
    FileText,
    Archive,
    BookMarked,
    ChevronDown,
    ChevronUp,
    Ruler,
    Paintbrush,
    MessageSquare,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Preset page sizes ───────────────────────────────────────────────────────
const PAGE_PRESETS = [
    { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
    { label: "A5 (148 × 210 mm)", w: 148, h: 210 },
    { label: "US Letter (216 × 279 mm)", w: 216, h: 279 },
    { label: "US Trade 6×9 (152 × 229 mm)", w: 152, h: 229 },
    { label: "Pocket 4×6 (102 × 152 mm)", w: 102, h: 152 },
    { label: "Square (210 × 210 mm)", w: 210, h: 210 },
    { label: "Custom", w: 0, h: 0 },
];

// ─── Style suggestions for the chatbox ──────────────────────────────────────
const STYLE_SUGGESTIONS = [
    "Classic cream pages with serif fonts and drop caps",
    "Modern minimalist with clean sans-serif typography",
    "Luxury dark theme with gold accents and wide margins",
    "Academic style with structured headers and footnote rules",
    "Fantasy parchment feel with ornate chapter ornaments",
    "Thriller — high contrast, dark grey pages, sharp layout",
    "Romance — blush tones, italic serif, floral ornaments",
    "Children's book — large fonts, pastel colours, playful spacing",
    "Sci-Fi — dark background, monospace headings, neon accents",
    "Retro vintage — warm sepia, diagonal motifs, old-style fonts",
];

interface LayoutConcept {
    style_name: string;
    page_bg: string;
    text_color: string;
    chapter_title_color: string;
    accent_color: string;
    body_font: string;
    body_font_size: number;
    line_spacing: number;
    first_para_indent_mm?: number;
    margin_top_mm: number;
    margin_bottom_mm: number;
    margin_left_mm: number;
    margin_right_mm: number;
    chapter_font: string;
    chapter_font_size: number;
    chapter_prefix: string;
    show_drop_cap: boolean;
    ornament: string;
    header_text: string;
    show_page_numbers: boolean;
}

interface LayoutResult {
    job_id: string;
    title: string;
    style_name: string;
    concept: LayoutConcept;
    chapter_count: number;
    chapter_titles: string[];
    pdf_url: string;
    docx_url: string;
}

// ─── Page size mini-preview ──────────────────────────────────────────────────
function PagePreview({
    w, h, concept,
}: {
    w: number; h: number; concept: LayoutConcept;
}) {
    const MAX_PREVIEW_W = 110;
    const MAX_PREVIEW_H = 150;
    const aspect = h / w;
    const pw = aspect >= 1 ? MAX_PREVIEW_W : MAX_PREVIEW_H / aspect;
    const ph = aspect >= 1 ? MAX_PREVIEW_W * aspect : MAX_PREVIEW_H;
    const scale = pw / w;

    const ml = (concept.margin_left_mm ?? 22) * scale;
    const mr = (concept.margin_right_mm ?? 22) * scale;
    const mt = (concept.margin_top_mm ?? 20) * scale;
    const mb = (concept.margin_bottom_mm ?? 20) * scale;

    return (
        <div
            style={{
                width: pw,
                height: ph,
                background: concept.page_bg || "#fff",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "3px",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
                flexShrink: 0,
            }}
        >
            {/* Header rule */}
            <div style={{
                position: "absolute",
                top: mt * 0.6,
                left: ml, right: mr,
                height: "1px",
                background: concept.accent_color,
                opacity: 0.6,
            }} />
            {/* Chapter heading bar */}
            <div style={{
                position: "absolute",
                top: mt + 4,
                left: ml,
                right: mr,
                height: Math.max(5, concept.chapter_font_size * scale * 0.85),
                background: concept.chapter_title_color,
                borderRadius: "1px",
                opacity: 0.85,
            }} />
            {/* Accent rule under chapter */}
            <div style={{
                position: "absolute",
                top: mt + 4 + Math.max(5, concept.chapter_font_size * scale * 0.85) + 3,
                left: ml,
                width: (pw - ml - mr) * 0.35,
                height: "1.5px",
                background: concept.accent_color,
            }} />
            {/* Body lines */}
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{
                    position: "absolute",
                    top: mt + 4 + Math.max(5, concept.chapter_font_size * scale * 0.85) + 14 + i * (concept.body_font_size * scale * concept.line_spacing),
                    left: ml + (i === 0 ? 0 : (concept.first_para_indent_mm ?? 6) * scale),
                    right: mr,
                    height: Math.max(2, concept.body_font_size * scale * 0.7),
                    background: concept.text_color,
                    borderRadius: "1px",
                    opacity: i === 0 ? 0.75 : 0.35 + Math.random() * 0.15,
                }} />
            ))}
            {/* Page number dot */}
            {concept.show_page_numbers && (
                <div style={{
                    position: "absolute",
                    bottom: mb * 0.55,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 6, height: 6,
                    borderRadius: "50%",
                    background: concept.accent_color,
                    opacity: 0.7,
                }} />
            )}
        </div>
    );
}

// ─── Concept detail row ───────────────────────────────────────────────────────
function ConceptRow({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{
                fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em",
                textTransform: "uppercase", color: "#475569",
            }}>
                {label}
            </span>
            <span style={{ fontSize: "13px", color: "#cbd5e1" }}>{value}</span>
        </div>
    );
}

// ─── Main page component ──────────────────────────────────────────────────────
export default function LayoutDesignerPage() {
    const router = useRouter();

    // Upload
    const [file, setFile] = useState<File | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Config
    const [bookTitle, setBookTitle] = useState("");
    const [presetIndex, setPresetIndex] = useState(0);
    const [customW, setCustomW] = useState(210);
    const [customH, setCustomH] = useState(297);
    const [designInstructions, setDesignInstructions] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Job state
    const [jobId, setJobId] = useState<string | null>(null);
    const [stage, setStage] = useState("");
    const [pct, setPct] = useState(0);
    const [statusMsg, setStatusMsg] = useState("");
    const [result, setResult] = useState<LayoutResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const preset = PAGE_PRESETS[presetIndex];
    const isCustom = preset.label === "Custom";
    const pageW = isCustom ? customW : preset.w;
    const pageH = isCustom ? customH : preset.h;

    // ── Drag & Drop ──────────────────────────────────────────────────────────
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) validateAndSetFile(f);
    }, []);

    function validateAndSetFile(f: File) {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        if (!["pdf", "docx", "zip"].includes(ext)) {
            setError("Only PDF, DOCX, or ZIP files are supported.");
            return;
        }
        if (f.size > 150 * 1024 * 1024) {
            setError("File is too large. Maximum 150 MB.");
            return;
        }
        setFile(f);
        setError(null);
        // Pre-fill title from filename
        if (!bookTitle) {
            setBookTitle(
                f.name.replace(/\.(pdf|docx|zip)$/i, "").replace(/[_-]/g, " ")
            );
        }
    }

    // ── Poll ─────────────────────────────────────────────────────────────────
    function startPolling(jid: string) {
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/layout/${jid}/status`);
                const data = await res.json();
                setStage(data.stage);
                setPct(data.pct);
                setStatusMsg(data.message);

                if (data.stage === "done" && data.result) {
                    clearInterval(interval);
                    setResult(data.result);
                    setLoading(false);
                } else if (data.stage === "error") {
                    clearInterval(interval);
                    setError(data.message || "Layout generation failed.");
                    setLoading(false);
                }
            } catch {
                // transient network error — keep polling
            }
        }, 1800);
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    async function handleSubmit() {
        if (!file) { setError("Please upload a book file first."); return; }
        setError(null);
        setLoading(true);
        setResult(null);
        setStage("queued");
        setPct(0);
        setStatusMsg("Uploading…");

        try {
            const form = new FormData();
            form.append("file", file);
            form.append("page_width_mm", String(pageW));
            form.append("page_height_mm", String(pageH));
            form.append("book_title", bookTitle.trim());
            form.append("design_instructions", designInstructions.trim());

            const res = await fetch(`${API_BASE}/design-layout`, {
                method: "POST",
                body: form,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Server error" }));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            const { job_id } = await res.json();
            setJobId(job_id);
            startPolling(job_id);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "An unexpected error occurred.");
            setLoading(false);
        }
    }

    // ── Stage label map ───────────────────────────────────────────────────────
    const STAGE_LABELS: Record<string, string> = {
        queued: "Queued",
        extracting: "Extracting text…",
        parsing: "Detecting chapters…",
        designing: "AI designing layout…",
        rendering: "Typesetting PDF…",
        rendering_docx: "Generating DOCX…",
        done: "Done!",
        error: "Error",
    };

    // ── Reset ─────────────────────────────────────────────────────────────────
    function reset() {
        setFile(null); setJobId(null); setResult(null);
        setError(null); setLoading(false);
        setStage(""); setPct(0); setStatusMsg("");
        setBookTitle(""); setDesignInstructions("");
    }

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div style={{
            minHeight: "100vh",
            background: "#0c0f1a",
            fontFamily: "'DM Sans', sans-serif",
            color: "#e2e8f0",
        }}>

            {/* ── Nav ── */}
            <nav style={{
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                padding: "0 40px",
                height: "60px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                position: "sticky", top: 0,
                background: "rgba(12,15,26,0.95)",
                backdropFilter: "blur(12px)",
                zIndex: 50,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                        width: "32px", height: "32px",
                        background: "linear-gradient(135deg,#f59e0b,#d97706)",
                        borderRadius: "8px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <LayoutTemplate size={16} color="white" />
                    </div>
                    <span style={{ fontWeight: "700", fontSize: "15px", letterSpacing: "-0.01em" }}>
                        Editorial AI
                    </span>
                </div>
                <button
                    onClick={() => router.push("/dashboard")}
                    style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        background: "none", border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px", padding: "6px 14px",
                        color: "#94a3b8", fontSize: "13px", cursor: "pointer",
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
                >
                    <ArrowLeft size={14} /> Dashboard
                </button>
            </nav>

            <main style={{ maxWidth: "860px", margin: "0 auto", padding: "52px 40px" }}>

                {/* ── Page header ── */}
                <div style={{ marginBottom: "44px" }}>
                    <div style={{
                        display: "inline-flex", alignItems: "center", gap: "6px",
                        background: "rgba(245,158,11,0.12)",
                        border: "1px solid rgba(245,158,11,0.3)",
                        borderRadius: "20px", padding: "4px 14px",
                        fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em",
                        color: "#fbbf24", marginBottom: "18px",
                    }}>
                        <Sparkles size={11} /> INTERNAL LAYOUT DESIGNER
                    </div>
                    <h1 style={{
                        fontSize: "38px", fontWeight: "800",
                        letterSpacing: "-0.03em",
                        fontFamily: "'Playfair Display', serif",
                        lineHeight: "1.1", marginBottom: "10px",
                    }}>
                        Beautiful Book Layouts
                    </h1>
                    <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6" }}>
                        Upload your manuscript, choose a page size, describe your vision —
                        AI will typeset every chapter into a print-ready PDF.
                    </p>
                </div>

                {/* ── Error banner ── */}
                {error && (
                    <div style={{
                        background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                        borderRadius: "10px", padding: "14px 18px", marginBottom: "28px",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        fontSize: "13px", color: "#fca5a5",
                    }}>
                        {error}
                        <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>
                            <X size={16} />
                        </button>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════════════ */}
                {/* RESULT VIEW                                                       */}
                {/* ══════════════════════════════════════════════════════════════════ */}
                {result && (
                    <div style={{
                        background: "rgba(245,158,11,0.05)",
                        border: "1px solid rgba(245,158,11,0.2)",
                        borderRadius: "16px", padding: "36px",
                        animation: "fadeInUp 0.4s ease",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" }}>
                            <CheckCircle size={22} color="#f59e0b" />
                            <h2 style={{ fontSize: "20px", fontWeight: "700", fontFamily: "'Playfair Display', serif" }}>
                                Layout Ready — {result.title}
                            </h2>
                        </div>

                        {/* Preview + details row */}
                        <div style={{ display: "flex", gap: "36px", alignItems: "flex-start", marginBottom: "32px" }}>
                            <PagePreview w={pageW} h={pageH} concept={result.concept} />

                            <div style={{ flex: 1, display: "grid", gap: "14px" }}>
                                <ConceptRow label="Style" value={result.concept.style_name} />
                                <ConceptRow label="Body Font" value={`${result.concept.body_font}, ${result.concept.body_font_size}pt`} />
                                <ConceptRow label="Chapter Font" value={`${result.concept.chapter_font}, ${result.concept.chapter_font_size}pt`} />
                                <ConceptRow label="Line Spacing" value={`${result.concept.line_spacing}×`} />
                                <ConceptRow label="Ornament" value={result.concept.ornament} />
                                <ConceptRow label="Chapters" value={`${result.chapter_count} detected`} />
                                <ConceptRow label="Page Size" value={`${pageW} × ${pageH} mm`} />

                                {/* Colour palette */}
                                <div>
                                    <span style={{
                                        fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em",
                                        textTransform: "uppercase", color: "#475569", display: "block", marginBottom: "8px",
                                    }}>
                                        Colour Palette
                                    </span>
                                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        {[
                                            result.concept.page_bg,
                                            result.concept.text_color,
                                            result.concept.chapter_title_color,
                                            result.concept.accent_color,
                                        ].map((col, i) => (
                                            <div key={i} title={col} style={{
                                                width: "26px", height: "26px", borderRadius: "6px",
                                                background: col,
                                                border: "1px solid rgba(255,255,255,0.12)",
                                                cursor: "help",
                                            }} />
                                        ))}
                                    </div>
                                </div>

                                {/* Chapter list */}
                                {result.chapter_titles.length > 0 && (
                                    <div>
                                        <span style={{
                                            fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em",
                                            textTransform: "uppercase", color: "#475569", display: "block", marginBottom: "6px",
                                        }}>
                                            Chapters Detected
                                        </span>
                                        <div style={{
                                            background: "rgba(0,0,0,0.25)", borderRadius: "8px",
                                            padding: "10px 14px", maxHeight: "110px", overflowY: "auto",
                                        }}>
                                            {result.chapter_titles.slice(0, 12).map((t, i) => (
                                                <div key={i} style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>
                                                    <span style={{ color: "#f59e0b" }}>{i + 1}.</span> {t}
                                                </div>
                                            ))}
                                            {result.chapter_titles.length > 12 && (
                                                <div style={{ fontSize: "11px", color: "#475569" }}>
                                                    +{result.chapter_titles.length - 12} more chapters
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Download buttons */}
                        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                            <a
                                href={`${API_BASE}${result.pdf_url}`}
                                download
                                style={{
                                    display: "inline-flex", alignItems: "center", gap: "8px",
                                    background: "#f59e0b", color: "#0c0f1a",
                                    borderRadius: "10px", padding: "11px 22px",
                                    fontSize: "13px", fontWeight: "700", textDecoration: "none",
                                    transition: "opacity 0.2s",
                                }}
                                onMouseOver={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "0.85")}
                                onMouseOut={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "1")}
                            >
                                <Download size={14} /> Download PDF
                            </a>
                            <a
                                href={`${API_BASE}${result.docx_url}`}
                                download
                                style={{
                                    display: "inline-flex", alignItems: "center", gap: "8px",
                                    background: "rgba(245,158,11,0.12)",
                                    border: "1px solid rgba(245,158,11,0.3)",
                                    color: "#fbbf24",
                                    borderRadius: "10px", padding: "11px 22px",
                                    fontSize: "13px", fontWeight: "600", textDecoration: "none",
                                    transition: "opacity 0.2s",
                                }}
                                onMouseOver={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "0.75")}
                                onMouseOut={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "1")}
                            >
                                <Download size={14} /> Download DOCX
                            </a>
                        </div>

                        <button
                            onClick={reset}
                            style={{
                                marginTop: "22px", background: "none",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "10px", padding: "9px 18px",
                                color: "#64748b", fontSize: "13px", cursor: "pointer",
                            }}
                            onMouseOver={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0")}
                            onMouseOut={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#64748b")}
                        >
                            ← Design another layout
                        </button>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════════════ */}
                {/* LOADING VIEW                                                      */}
                {/* ══════════════════════════════════════════════════════════════════ */}
                {loading && !result && (
                    <div style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "16px", padding: "48px 36px",
                        textAlign: "center",
                    }}>
                        <div style={{
                            width: "52px", height: "52px",
                            border: "3px solid rgba(245,158,11,0.2)",
                            borderTop: "3px solid #f59e0b",
                            borderRadius: "50%", margin: "0 auto 24px",
                            animation: "spin 1s linear infinite",
                        }} />
                        <p style={{ fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>
                            {STAGE_LABELS[stage] || "Processing…"}
                        </p>
                        <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>
                            {statusMsg}
                        </p>
                        {/* Progress bar */}
                        <div style={{
                            height: "4px", background: "rgba(255,255,255,0.07)",
                            borderRadius: "4px", overflow: "hidden",
                            maxWidth: "320px", margin: "0 auto",
                        }}>
                            <div style={{
                                height: "100%", background: "#f59e0b",
                                width: `${pct}%`, borderRadius: "4px",
                                transition: "width 0.6s ease",
                            }} />
                        </div>
                        <p style={{ color: "#475569", fontSize: "12px", marginTop: "8px" }}>
                            {pct}%
                        </p>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════════════ */}
                {/* FORM VIEW                                                         */}
                {/* ══════════════════════════════════════════════════════════════════ */}
                {!loading && !result && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

                        {/* ── 1. Upload ── */}
                        <section style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "14px", padding: "28px",
                        }}>
                            <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "18px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <Upload size={15} color="#f59e0b" /> Upload Manuscript
                            </h3>

                            {/* Drop zone */}
                            <div
                                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={onDrop}
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    border: `2px dashed ${dragging ? "#f59e0b" : file ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.1)"}`,
                                    borderRadius: "10px", padding: "32px 20px",
                                    textAlign: "center", cursor: "pointer",
                                    background: dragging ? "rgba(245,158,11,0.05)" : "transparent",
                                    transition: "all 0.2s",
                                }}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pdf,.docx,.zip"
                                    style={{ display: "none" }}
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) validateAndSetFile(f);
                                    }}
                                />
                                {file ? (
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                                        {file.name.endsWith(".zip") ? <Archive size={18} color="#f59e0b" /> :
                                            file.name.endsWith(".pdf") ? <FileText size={18} color="#f59e0b" /> :
                                                <BookMarked size={18} color="#f59e0b" />}
                                        <span style={{ fontSize: "14px", fontWeight: "600", color: "#fbbf24" }}>{file.name}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setFile(null); }}
                                            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", marginLeft: "4px" }}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <Upload size={28} color="#475569" style={{ marginBottom: "10px" }} />
                                        <p style={{ fontSize: "14px", color: "#64748b", marginBottom: "4px" }}>
                                            Drop your book here or <span style={{ color: "#f59e0b" }}>click to browse</span>
                                        </p>
                                        <p style={{ fontSize: "12px", color: "#334155" }}>PDF · DOCX · ZIP — up to 150 MB</p>
                                    </>
                                )}
                            </div>
                        </section>

                        {/* ── 2. Book title ── */}
                        <section style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "14px", padding: "28px",
                        }}>
                            <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "18px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <BookMarked size={15} color="#f59e0b" /> Book Title
                                <span style={{ fontSize: "11px", fontWeight: "400", color: "#475569", marginLeft: "4px" }}>(optional — auto-detected from filename)</span>
                            </h3>
                            <input
                                type="text"
                                value={bookTitle}
                                onChange={(e) => setBookTitle(e.target.value)}
                                placeholder="e.g. The Art of Thinking Clearly"
                                style={{
                                    width: "100%", background: "rgba(0,0,0,0.3)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: "8px", padding: "11px 14px",
                                    fontSize: "14px", color: "#e2e8f0",
                                    outline: "none", boxSizing: "border-box",
                                }}
                                onFocus={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = "rgba(245,158,11,0.5)")}
                                onBlur={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.1)")}
                            />
                        </section>

                        {/* ── 3. Page Size ── */}
                        <section style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "14px", padding: "28px",
                        }}>
                            <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "18px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <Ruler size={15} color="#f59e0b" /> Page Size
                            </h3>

                            {/* Preset grid */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: isCustom ? "18px" : "0" }}>
                                {PAGE_PRESETS.map((p, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setPresetIndex(i)}
                                        style={{
                                            background: presetIndex === i ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.2)",
                                            border: `1px solid ${presetIndex === i ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`,
                                            borderRadius: "8px", padding: "10px 12px",
                                            textAlign: "left", cursor: "pointer",
                                            color: presetIndex === i ? "#fbbf24" : "#94a3b8",
                                            fontSize: "12px", fontWeight: presetIndex === i ? "700" : "400",
                                            transition: "all 0.15s",
                                        }}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>

                            {/* Custom inputs */}
                            {isCustom && (
                                <div style={{ display: "flex", gap: "14px" }}>
                                    {[
                                        { label: "Width (mm)", val: customW, set: setCustomW },
                                        { label: "Height (mm)", val: customH, set: setCustomH },
                                    ].map(({ label, val, set }) => (
                                        <div key={label} style={{ flex: 1 }}>
                                            <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "6px" }}>
                                                {label}
                                            </label>
                                            <input
                                                type="number"
                                                min={50} max={600}
                                                value={val}
                                                onChange={(e) => set(Number(e.target.value))}
                                                style={{
                                                    width: "100%", background: "rgba(0,0,0,0.3)",
                                                    border: "1px solid rgba(255,255,255,0.1)",
                                                    borderRadius: "8px", padding: "10px 12px",
                                                    fontSize: "14px", color: "#e2e8f0",
                                                    outline: "none", boxSizing: "border-box",
                                                }}
                                                onFocus={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = "rgba(245,158,11,0.5)")}
                                                onBlur={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.1)")}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Size indicator */}
                            <p style={{ fontSize: "12px", color: "#475569", marginTop: "12px" }}>
                                Current size: <span style={{ color: "#94a3b8" }}>{pageW} × {pageH} mm</span>
                            </p>
                        </section>

                        {/* ── 4. Design Instructions ── */}
                        <section style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "14px", padding: "28px",
                        }}>
                            <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <MessageSquare size={15} color="#f59e0b" /> Design Instructions
                                <span style={{ fontSize: "11px", fontWeight: "400", color: "#475569", marginLeft: "4px" }}>(optional)</span>
                            </h3>
                            <p style={{ fontSize: "12px", color: "#475569", marginBottom: "14px" }}>
                                Describe the look you want or leave blank for an AI-chosen style.
                            </p>

                            <textarea
                                value={designInstructions}
                                onChange={(e) => setDesignInstructions(e.target.value)}
                                placeholder="e.g. Classic cream pages with Garamond-style serif fonts, generous margins, drop caps, and subtle ornamental dividers…"
                                rows={4}
                                style={{
                                    width: "100%", background: "rgba(0,0,0,0.3)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: "8px", padding: "12px 14px",
                                    fontSize: "13px", color: "#e2e8f0", resize: "vertical",
                                    outline: "none", boxSizing: "border-box",
                                    lineHeight: "1.55", fontFamily: "inherit",
                                }}
                                onFocus={(e) => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = "rgba(245,158,11,0.5)")}
                                onBlur={(e) => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = "rgba(255,255,255,0.1)")}
                            />

                            {/* Suggestions dropdown */}
                            <div style={{ marginTop: "10px" }}>
                                <button
                                    onClick={() => setShowSuggestions(!showSuggestions)}
                                    style={{
                                        display: "inline-flex", alignItems: "center", gap: "6px",
                                        background: "none", border: "none",
                                        color: "#f59e0b", fontSize: "12px", cursor: "pointer",
                                        fontWeight: "600",
                                    }}
                                >
                                    <Paintbrush size={12} />
                                    Style suggestions
                                    {showSuggestions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>

                                {showSuggestions && (
                                    <div style={{
                                        marginTop: "10px",
                                        background: "rgba(0,0,0,0.3)",
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        borderRadius: "8px", overflow: "hidden",
                                    }}>
                                        {STYLE_SUGGESTIONS.map((s, i) => (
                                            <button
                                                key={i}
                                                onClick={() => { setDesignInstructions(s); setShowSuggestions(false); }}
                                                style={{
                                                    display: "block", width: "100%", textAlign: "left",
                                                    padding: "10px 14px", background: "none", border: "none",
                                                    borderBottom: i < STYLE_SUGGESTIONS.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                                                    color: "#94a3b8", fontSize: "12px", cursor: "pointer",
                                                    transition: "background 0.15s",
                                                }}
                                                onMouseOver={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.08)")}
                                                onMouseOut={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "none")}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* ── Submit ── */}
                        <button
                            onClick={handleSubmit}
                            disabled={!file}
                            style={{
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                                background: file ? "#f59e0b" : "rgba(245,158,11,0.3)",
                                color: file ? "#0c0f1a" : "#64748b",
                                border: "none", borderRadius: "12px",
                                padding: "15px 32px", fontSize: "15px", fontWeight: "700",
                                cursor: file ? "pointer" : "not-allowed",
                                transition: "opacity 0.2s",
                                width: "100%",
                            }}
                            onMouseOver={(e) => { if (file) (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
                            onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                        >
                            <LayoutTemplate size={17} />
                            Generate Layout
                        </button>

                        <p style={{ textAlign: "center", fontSize: "12px", color: "#334155" }}>
                            Powered by GPT-4o · Typeset with ReportLab · PDF + DOCX output
                        </p>
                    </div>
                )}
            </main>

            <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
      `}</style>
        </div>
    );
}