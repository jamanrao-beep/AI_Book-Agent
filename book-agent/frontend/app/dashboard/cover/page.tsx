"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { parseFriendlyError } from "@/lib/api";
import {
    ArrowLeft,
    Upload,
    Loader,
    CheckCircle,
    Download,
    Sparkles,
    Palette,
    X,
    BookMarked,
    Archive,
    FileText,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface CoverConcept {
    title: string;
    subtitle: string;
    tagline: string;
    author_line: string;
    palette: {
        bg_primary: string;
        bg_secondary: string;
        panel_color: string;
        accent: string;
        accent2: string;
        title_color: string;
        subtitle_color: string;
        tagline_color: string;
        bg_top: string;
        bg_bottom: string;
    };
    style: string;
    motif: string;
    illustration_shape: string;
    layout_template: string;
    image_treatment: string;
    accent_elements: string[];
    genre_label: string;
    design_rationale?: string;
    _nb_failed?: boolean;
    _nb_note?: string;
}

interface CoverResult {
    job_id: string;
    mode: "single" | "zip_bundle";
    original_filename: string;
    download_url: string;
    concept?: CoverConcept;
    files_processed?: number;
    files?: Array<{
        source_filename: string;
        concept: CoverConcept;
    }>;
    image_generation_warning?: string | null;
}

async function designCover(
    file: File,
    bookTitle: string,
    description: string,
    designStyle: string,
    coverImage?: File,
): Promise<CoverResult> {
    const form = new FormData();
    form.append("file", file);
    form.append("book_title", bookTitle);
    form.append("description", description);
    form.append("design_style", designStyle);
    if (coverImage) form.append("cover_image", coverImage);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);

    try {
        const res = await fetch(`${API_BASE}/design-cover`, {
            method: "POST",
            body: form,
            signal: controller.signal,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Unknown error" }));
            throw new Error(err.detail || `Server error ${res.status}`);
        }
        return res.json();
    } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
            throw new Error(
                "Cover design timed out after 5 minutes. " +
                "The Nano Banana image cluster may be busy — please try again."
            );
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function CoverPreview({ concept }: { concept: CoverConcept }) {
    const pal = concept.palette;
    const titleLines = concept.title.split("\n");

    return (
        <div
            style={{
                width: "220px",
                height: "310px",
                borderRadius: "6px",
                background: `linear-gradient(160deg, ${pal.bg_primary ?? pal.bg_top} 0%, ${pal.bg_secondary ?? pal.bg_bottom} 100%)`,
                position: "relative",
                overflow: "hidden",
                flexShrink: 0,
                boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
            }}
        >
            <div style={{ position: "absolute", left: 0, top: 0, width: "5px", height: "100%", background: pal.accent }} />
            {concept.genre_label && (
                <div
                    style={{
                        position: "absolute", top: "16px", left: "18px",
                        fontSize: "7px", fontWeight: "800", letterSpacing: "0.12em",
                        color: pal.accent, background: `${pal.accent}22`,
                        border: `1px solid ${pal.accent}44`, borderRadius: "3px", padding: "2px 6px",
                    }}
                >
                    {concept.genre_label}
                </div>
            )}
            <div style={{ position: "absolute", right: "-10px", bottom: "60px", width: "100px", height: "100px", borderRadius: "50%", border: `1px solid ${pal.accent}33` }} />
            <div style={{ position: "absolute", right: "10px", bottom: "40px", width: "60px", height: "60px", borderRadius: "50%", border: `1px solid ${pal.accent}44` }} />
            <div style={{ position: "absolute", left: "18px", top: "80px", right: "12px" }}>
                {titleLines.map((line, i) => (
                    <div
                        key={i}
                        style={{
                            fontSize: line.length > 18 ? "14px" : "18px",
                            fontWeight: "800",
                            color: pal.title_color,
                            lineHeight: 1.2,
                            fontFamily: "'Playfair Display', Georgia, serif",
                        }}
                    >
                        {line.trim()}
                    </div>
                ))}
                <div style={{ width: "32px", height: "2.5px", background: pal.accent, margin: "8px 0" }} />
                {concept.subtitle && (
                    <div style={{ fontSize: "8px", color: pal.subtitle_color, lineHeight: 1.4, marginBottom: "6px" }}>
                        {concept.subtitle}
                    </div>
                )}
                {concept.tagline && (
                    <div style={{ fontSize: "7px", fontStyle: "italic", color: pal.tagline_color, lineHeight: 1.5 }}>
                        {concept.tagline.length > 70 ? concept.tagline.slice(0, 70) + "…" : concept.tagline}
                    </div>
                )}
            </div>
            <div
                style={{
                    position: "absolute", bottom: 0, left: 0, right: 0, height: "36px",
                    background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center",
                    padding: "0 18px", justifyContent: "space-between",
                }}
            >
                {concept.author_line && (
                    <span style={{ fontSize: "7px", color: "rgba(255,255,255,0.7)" }}>{concept.author_line}</span>
                )}
                <span style={{ fontSize: "6px", fontWeight: "700", color: pal.accent, marginLeft: "auto", letterSpacing: "0.1em" }}>
                    NANO BANANA AI 🍌
                </span>
            </div>
        </div>
    );
}

export default function CoverDesignerPage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);
    const [bookTitle, setBookTitle] = useState("");
    const [description, setDescription] = useState("");
    const [designStyle, setDesignStyle] = useState("");
    const [customStyle, setCustomStyle] = useState("");
    const [dragging, setDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<CoverResult | null>(null);
    const [error, setError] = useState("");
    const [nbWarning, setNbWarning] = useState<string | null>(null);
    const [coverImage, setCoverImage] = useState<File | null>(null);

    const handleFile = (f: File) => {
        const ext = f.name.split(".").pop()?.toLowerCase();
        if (!["pdf", "docx", "zip"].includes(ext || "")) {
            setError("Please upload a .pdf, .docx, or .zip file.");
            return;
        }
        if (f.size > 150 * 1024 * 1024) {
            setError("File must be under 150 MB.");
            return;
        }
        setError("");
        setFile(f);
        setResult(null);
        if (!bookTitle && ext !== "zip") {
            const guessed = f.name
                .replace(/\.(pdf|docx)$/i, "")
                .replace(/[_-]/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
            setBookTitle(guessed);
        }
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
        setNbWarning(null);
        try {
            const effectiveStyle = designStyle === "other" ? customStyle.trim() : designStyle;
            const res = await designCover(file, bookTitle, description, effectiveStyle, coverImage ?? undefined);
            setResult(res);
            if (res.image_generation_warning) {
                setNbWarning(res.image_generation_warning);
            }
        } catch (err: unknown) {
            setError(parseFriendlyError(err));
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = () => {
        if (!result) return;
        const url = `${API_BASE}${result.download_url}`;
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
        a.click();
    };

    const concept = result?.mode === "single" ? result?.concept : undefined;
    const isZipBundle = result?.mode === "zip_bundle";

    // ─── Shared input style ───────────────────────────────────────────────
    const inputStyle: React.CSSProperties = {
        width: "100%",
        background: "#ffffff",
        border: "1px solid #e8e8e4",
        borderRadius: "10px",
        padding: "12px 14px",
        fontSize: "14px",
        color: "#2b2b2b",
        outline: "none",
        transition: "border-color 0.2s",
        boxSizing: "border-box",
    };

    const labelStyle: React.CSSProperties = {
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "#0c43bb",
        display: "block",
        marginBottom: "8px",
    };

    const panelStyle: React.CSSProperties = {
        background: "#ffffff",
        border: "1px solid #e8e8e4",
        borderRadius: "12px",
        padding: "18px 20px",
        marginBottom: "24px",
    };

    return (
        <div style={{ minHeight: "100vh", background: "#f7f2e4", fontFamily: "'DM Sans', sans-serif", color: "#2b2b2b" }}>

            {/* ── Navbar ── */}
            <nav
                style={{
                    borderBottom: "1px solid #efefcf",
                    padding: "0 40px",
                    height: "60px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    position: "sticky",
                    top: 0,
                    background: "#ffffff",
                    zIndex: 50,
                }}
            >
                <button
                    onClick={() => router.push("/dashboard")}
                    style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        background: "none", border: "none", color: "#6b7280",
                        fontSize: "13px", cursor: "pointer", padding: "6px 0", transition: "color 0.2s",
                    }}
                    onMouseOver={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#2b2b2b")}
                    onMouseOut={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#6b7280")}
                >
                    <ArrowLeft size={14} /> Back to Dashboard
                </button>
                <span style={{ color: "#e8e8e4" }}>|</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                        style={{
                            width: "28px", height: "28px", background: "#f7f2e4",
                            border: "1px solid #e8e8e4", borderRadius: "8px",
                            display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                    >
                        <Palette size={14} color="#2563eb" />
                    </div>
                    <span style={{ fontWeight: "600", fontSize: "14px", color: "#2b2b2b" }}>Cover Designer</span>
                </div>
            </nav>

            <main style={{ maxWidth: "860px", margin: "0 auto", padding: "52px 40px" }}>

                {/* ── Page header ── */}
                <div style={{ marginBottom: "40px" }}>
                    <div
                        style={{
                            display: "inline-flex", alignItems: "center", gap: "6px",
                            background: "#ffffff", border: "1px solid #e8e8e4",
                            borderRadius: "999px", padding: "4px 14px",
                            fontSize: "11px", fontWeight: "600", color: "#2563eb",
                            letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "18px",
                        }}
                    >
                        <Sparkles size={11} color="#2563eb" />
                        Nano Banana AI · Cover Designer
                    </div>
                    <h1
                        style={{
                            fontSize: "36px", fontWeight: "800", letterSpacing: "-0.03em",
                            fontFamily: "'Playfair Display', serif", marginBottom: "10px",
                            color: "#2b2b2b", lineHeight: 1.15,
                        }}
                    >
                        AI Book Cover Designer — Nano Banana 🍌
                    </h1>
                    <p style={{ color: "#6b7280", fontSize: "15px", lineHeight: "1.6", maxWidth: "640px" }}>
                        Upload your .pdf or .docx manuscript — or a .zip containing multiple files.
                        Nano Banana (Gemini) generates a full-bleed cover page for each and attaches it — zero design skills needed.
                    </p>
                </div>

                {!result ? (
                    <>
                        {/* ── Drop zone ── */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => !file && fileInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${dragging ? "#2563eb" : file ? "#2563eb88" : "#d0d0cc"}`,
                                borderRadius: "16px",
                                padding: "40px 32px",
                                textAlign: "center",
                                cursor: file ? "default" : "pointer",
                                background: dragging ? "rgba(37,99,235,0.04)" : file ? "rgba(37,99,235,0.02)" : "#ffffff",
                                transition: "all 0.2s",
                                marginBottom: "24px",
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.docx,.zip"
                                style={{ display: "none" }}
                                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                            />
                            {file ? (
                                <div>
                                    <div
                                        style={{
                                            width: "52px", height: "52px", background: "#f7f2e4",
                                            border: "1px solid #e8e8e4", borderRadius: "12px",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            margin: "0 auto 12px",
                                        }}
                                    >
                                        {file.name.split(".").pop()?.toLowerCase() === "zip"
                                            ? <Archive size={22} color="#2563eb" />
                                            : <BookMarked size={22} color="#2563eb" />
                                        }
                                    </div>
                                    <p style={{ fontWeight: "600", fontSize: "14px", color: "#2b2b2b" }}>{file.name}</p>
                                    <p style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}>
                                        {(file.size / 1024).toFixed(1)} KB · {file.name.split(".").pop()?.toUpperCase()}
                                    </p>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setFile(null); setBookTitle(""); setError(""); }}
                                        style={{
                                            marginTop: "10px", background: "#fff0f0",
                                            border: "1px solid #fecaca", borderRadius: "6px",
                                            color: "#dc2626", cursor: "pointer", fontSize: "12px",
                                            padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: "4px",
                                        }}
                                    >
                                        <X size={12} /> Remove
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <div
                                        style={{
                                            width: "52px", height: "52px", background: "#f7f2e4",
                                            borderRadius: "12px", display: "flex", alignItems: "center",
                                            justifyContent: "center", margin: "0 auto 14px",
                                        }}
                                    >
                                        <Upload size={22} color="#6b7280" />
                                    </div>
                                    <p style={{ fontWeight: "500", fontSize: "14px", marginBottom: "6px", color: "#2b2b2b" }}>
                                        Drop your manuscript here
                                    </p>
                                    <p style={{ color: "#6b7280", fontSize: "12px" }}>
                                        .PDF or .DOCX · or .ZIP with multiple files · max 150 MB
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* ── Title & description ── */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                            <div>
                                <label style={labelStyle}>
                                    Book Title{" "}
                                    {file?.name.endsWith(".zip") && (
                                        <span style={{ color: "#9ca3af", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>
                                            (optional for ZIP — inferred per file)
                                        </span>
                                    )}
                                </label>
                                <input
                                    type="text"
                                    value={bookTitle}
                                    onChange={(e) => setBookTitle(e.target.value)}
                                    placeholder="e.g. The Art of Leadership"
                                    style={inputStyle}
                                    onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
                                    onBlur={(e) => (e.currentTarget.style.borderColor = "#e8e8e4")}
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>
                                    Brief Description{" "}
                                    <span style={{ color: "#9ca3af", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>
                                        (optional — helps AI design better)
                                    </span>
                                </label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="e.g. A business guide for modern managers"
                                    style={inputStyle}
                                    onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
                                    onBlur={(e) => (e.currentTarget.style.borderColor = "#e8e8e4")}
                                />
                            </div>
                        </div>

                        {/* ── Custom cover image ── */}
                        <div style={panelStyle}>
                            <label style={labelStyle}>
                                🖼️ Custom Cover Image{" "}
                                <span style={{ color: "#9ca3af", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>
                                    (optional — skips Nano Banana image generation)
                                </span>
                            </label>
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => setCoverImage(e.target.files?.[0] ?? null)}
                                style={{ fontSize: "13px", color: "#6b7280", cursor: "pointer", width: "100%" }}
                            />
                            {coverImage && (
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "12px" }}>
                                    <span style={{ color: "#16a34a", fontWeight: "500" }}>✅ {coverImage.name}</span>
                                    <button
                                        onClick={() => setCoverImage(null)}
                                        style={{
                                            background: "#fff0f0", border: "1px solid #fecaca",
                                            borderRadius: "5px", color: "#dc2626", cursor: "pointer",
                                            fontSize: "11px", padding: "2px 8px",
                                        }}
                                    >
                                        ✕ remove
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* ── Design style ── */}
                        <div style={panelStyle}>
                            <label style={labelStyle}>
                                Design Style{" "}
                                <span style={{ color: "#9ca3af", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>
                                    (default: Premium)
                                </span>
                            </label>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {[
                                    { value: "", label: "✦ Default", hint: "Premium" },
                                    { value: "normal", label: "📄 Normal", hint: "Clean & balanced" },
                                    { value: "premium", label: "💎 Premium", hint: "Luxury & elegant" },
                                    { value: "scifi", label: "🚀 Sci-Fi", hint: "Futuristic & neon" },
                                    { value: "minimalist", label: "◻ Minimalist", hint: "Sparse & modern" },
                                    { value: "fantasy", label: "🔮 Fantasy", hint: "Mystical & rich" },
                                    { value: "thriller", label: "⚡ Thriller", hint: "Dark & high contrast" },
                                    { value: "romance", label: "🌸 Romance", hint: "Warm & soft" },
                                    { value: "academic", label: "📚 Academic", hint: "Structured & muted" },
                                    { value: "vibrant", label: "🎨 Vibrant", hint: "Bold & energetic" },
                                    { value: "retro", label: "📻 Retro", hint: "Vintage warmth" },
                                    { value: "other", label: "✏️ Other", hint: "Describe your own style" },
                                ].map(({ value, label, hint }) => {
                                    const selected = designStyle === value;
                                    return (
                                        <button
                                            key={value}
                                            title={hint}
                                            onClick={() => setDesignStyle(value)}
                                            style={{
                                                background: selected ? "#2563eb" : "#f7f2e4",
                                                border: `1px solid ${selected ? "#2563eb" : "#e8e8e4"}`,
                                                borderRadius: "8px", padding: "7px 14px",
                                                fontSize: "12px", fontWeight: selected ? "700" : "500",
                                                color: selected ? "#ffffff" : "#2b2b2b",
                                                cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                                            }}
                                            onMouseOver={(e) => {
                                                if (!selected) {
                                                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#2563eb";
                                                    (e.currentTarget as HTMLButtonElement).style.color = "#2563eb";
                                                }
                                            }}
                                            onMouseOut={(e) => {
                                                if (!selected) {
                                                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#e8e8e4";
                                                    (e.currentTarget as HTMLButtonElement).style.color = "#2b2b2b";
                                                }
                                            }}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                            {designStyle === "other" && (
                                <div style={{ marginTop: "12px" }}>
                                    <input
                                        type="text"
                                        value={customStyle}
                                        onChange={(e) => setCustomStyle(e.target.value)}
                                        placeholder="e.g. brutalist, watercolour, cyberpunk noir, hand-drawn…"
                                        autoFocus
                                        style={{
                                            width: "100%", background: "#f7f2e4",
                                            border: "1px solid #2563eb66", borderRadius: "10px",
                                            padding: "11px 14px", fontSize: "13px", color: "#2b2b2b",
                                            outline: "none", transition: "border-color 0.2s", boxSizing: "border-box",
                                        }}
                                        onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
                                        onBlur={(e) => (e.currentTarget.style.borderColor = "#2563eb66")}
                                    />
                                    <p style={{ fontSize: "11px", color: "#6b7280", marginTop: "6px" }}>
                                        Describe any style you like — the AI will interpret it freely.
                                    </p>
                                </div>
                            )}
                            {designStyle && designStyle !== "other" && (
                                <p style={{ fontSize: "11px", color: "#6b7280", marginTop: "8px" }}>
                                    AI will design a{" "}
                                    <span style={{ color: "#2563eb", fontWeight: "600" }}>{designStyle}</span>{" "}
                                    themed cover. Hover a style to see a description.
                                </p>
                            )}
                        </div>

                        {/* ── Error banner ── */}
                        {error && (
                            <div
                                style={{
                                    background: "#fff0f0", border: "1px solid #fecaca",
                                    borderRadius: "10px", padding: "12px 16px",
                                    color: "#dc2626", fontSize: "13px", marginBottom: "20px",
                                }}
                            >
                                {error}
                            </div>
                        )}

                        {/* ── Nano Banana warning ── */}
                        {nbWarning && (
                            <div
                                style={{
                                    background: "#fffbeb", border: "1px solid #fde68a",
                                    borderRadius: "10px", padding: "12px 16px",
                                    color: "#92400e", fontSize: "13px", marginBottom: "20px",
                                    display: "flex", gap: "8px", alignItems: "flex-start",
                                }}
                            >
                                <span>🍌</span>
                                <span>
                                    <strong>Nano Banana note:</strong> Image generation was unavailable —
                                    cover uses a gradient background. Check that your GEMINI_API_KEY has image generation access.
                                </span>
                            </div>
                        )}

                        {/* ── Submit ── */}
                        <button
                            onClick={handleSubmit}
                            disabled={!file || loading}
                            style={{
                                width: "100%",
                                background: !file || loading ? "#e8e8e4" : "#1a1a1a",
                                color: !file || loading ? "#9ca3af" : "#ffffff",
                                border: "none", borderRadius: "12px", padding: "14px 24px",
                                fontSize: "14px", fontWeight: "700",
                                cursor: !file || loading ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                gap: "10px", transition: "opacity 0.2s",
                            }}
                        >
                            {loading ? (
                                <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Designing your cover...</>
                            ) : (
                                <><Sparkles size={18} /> 🍌 Design Cover with Nano Banana</>
                            )}
                        </button>

                        {loading && (
                            <p style={{ textAlign: "center", color: "#6b7280", fontSize: "12px", marginTop: "12px" }}>
                                AI is creating your cover concept and rendering the design… usually takes 15–30 seconds 🍌
                            </p>
                        )}
                    </>
                ) : (
                    /* ── Results ── */
                    <div style={{ animation: "fadeInUp 0.4s ease forwards" }}>

                        {/* Success banner */}
                        <div
                            style={{
                                display: "flex", alignItems: "center", gap: "12px",
                                background: "#ffffff", border: "1px solid #e8e8e4",
                                borderRadius: "12px", padding: "16px 20px", marginBottom: "28px",
                            }}
                        >
                            <CheckCircle size={20} color="#16a34a" />
                            <div>
                                <p style={{ fontWeight: "600", fontSize: "14px", color: "#2b2b2b" }}>
                                    {isZipBundle
                                        ? `${result!.files_processed} cover${result!.files_processed !== 1 ? "s" : ""} designed successfully`
                                        : "Cover designed successfully"
                                    }
                                </p>
                                <p style={{ color: "#6b7280", fontSize: "12px", marginTop: "2px" }}>
                                    {result!.original_filename}
                                    {isZipBundle && (
                                        <span style={{ marginLeft: "6px", color: "#2563eb", fontWeight: "500" }}>· ZIP bundle</span>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={handleDownload}
                                style={{
                                    marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px",
                                    background: "#1a1a1a", color: "#ffffff", border: "none",
                                    borderRadius: "8px", padding: "9px 18px", fontSize: "13px",
                                    fontWeight: "600", cursor: "pointer", whiteSpace: "nowrap", transition: "opacity 0.2s",
                                }}
                                onMouseOver={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.82")}
                                onMouseOut={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
                            >
                                <Download size={14} />
                                {isZipBundle ? "Download ZIP Bundle" : "Download with Cover"}
                            </button>
                        </div>

                        {/* ZIP bundle preview grid */}
                        {isZipBundle && result!.files && result!.files.length > 0 && (
                            <div>
                                <h2
                                    style={{
                                        fontSize: "18px", fontWeight: "800",
                                        fontFamily: "'Playfair Display', serif",
                                        marginBottom: "20px", color: "#2b2b2b", letterSpacing: "-0.02em",
                                    }}
                                >
                                    Covers Generated ({result!.files_processed})
                                </h2>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "24px" }}>
                                    {result!.files.map((f, idx) => (
                                        <div key={idx}>
                                            <CoverPreview concept={f.concept} />
                                            <div style={{ marginTop: "10px" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                                    <FileText size={12} color="#2563eb" />
                                                    <span
                                                        style={{
                                                            fontSize: "12px", fontWeight: "600", color: "#2b2b2b",
                                                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        {f.source_filename}
                                                    </span>
                                                </div>
                                                <p style={{ fontSize: "11px", color: "#6b7280", marginBottom: "2px" }}>
                                                    <span style={{ color: "#2b2b2b", fontWeight: "500" }}>Style:</span>{" "}
                                                    {f.concept.style} · {f.concept.genre_label}
                                                </p>
                                                <p style={{ fontSize: "11px", color: "#6b7280" }}>
                                                    <span style={{ color: "#2b2b2b", fontWeight: "500" }}>Motif:</span>{" "}
                                                    {f.concept.motif}
                                                </p>
                                                <div style={{ display: "flex", gap: "5px", marginTop: "6px", flexWrap: "wrap" }}>
                                                    {Object.entries(f.concept.palette).map(([key, val]) => (
                                                        <div
                                                            key={key}
                                                            title={`${key}: ${val}`}
                                                            style={{
                                                                width: "18px", height: "18px", borderRadius: "4px",
                                                                background: val, border: "1px solid rgba(0,0,0,0.08)", cursor: "help",
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Single file: preview + concept detail card */}
                        {!isZipBundle && concept && (
                            <div style={{ display: "flex", gap: "32px", alignItems: "flex-start" }}>
                                <CoverPreview concept={concept} />
                                <div style={{ flex: 1 }}>
                                    <h2
                                        style={{
                                            fontSize: "20px", fontWeight: "800",
                                            fontFamily: "'Playfair Display', serif",
                                            marginBottom: "20px", color: "#2b2b2b", letterSpacing: "-0.02em",
                                        }}
                                    >
                                        Nano Banana Design Concept 🍌
                                    </h2>
                                    <div
                                        style={{
                                            background: "#ffffff", border: "1px solid #e8e8e4",
                                            borderRadius: "12px", padding: "20px", display: "grid", gap: "16px",
                                        }}
                                    >
                                        {[
                                            { label: "Title", value: concept.title.replace("\n", " ") },
                                            { label: "Subtitle", value: concept.subtitle || "—" },
                                            { label: "Tagline", value: concept.tagline || "—" },
                                            { label: "Style", value: concept.style },
                                            { label: "Genre", value: concept.genre_label },
                                            { label: "Design Motif", value: concept.motif },
                                        ].map(({ label, value }) => (
                                            <div key={label}>
                                                <span
                                                    style={{
                                                        fontSize: "10px", fontWeight: "700",
                                                        letterSpacing: "0.08em", textTransform: "uppercase", color: "#0c43bb",
                                                    }}
                                                >
                                                    {label}
                                                </span>
                                                <p style={{ fontSize: "14px", color: "#2b2b2b", marginTop: "3px" }}>{value}</p>
                                            </div>
                                        ))}
                                        <div>
                                            <span
                                                style={{
                                                    fontSize: "10px", fontWeight: "700",
                                                    letterSpacing: "0.08em", textTransform: "uppercase",
                                                    color: "#0c43bb", display: "block", marginBottom: "8px",
                                                }}
                                            >
                                                Colour Palette
                                            </span>
                                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                                {Object.entries(concept.palette).map(([key, val]) => (
                                                    <div
                                                        key={key}
                                                        title={`${key}: ${val}`}
                                                        style={{
                                                            width: "28px", height: "28px", borderRadius: "6px",
                                                            background: val, border: "1px solid rgba(0,0,0,0.08)", cursor: "help",
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Design another */}
                        <button
                            onClick={() => {
                                setResult(null);
                                setFile(null);
                                setBookTitle("");
                                setDescription("");
                                setDesignStyle("");
                                setCustomStyle("");
                            }}
                            style={{
                                marginTop: "28px", background: "#f7f2e4",
                                border: "1px solid #e8e8e4", borderRadius: "10px",
                                padding: "10px 20px", color: "#2b2b2b", fontSize: "13px",
                                fontWeight: "500", cursor: "pointer", transition: "all 0.2s",
                            }}
                            onMouseOver={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "#efefcf";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "#d0d0cc";
                            }}
                            onMouseOut={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "#f7f2e4";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "#e8e8e4";
                            }}
                        >
                            ← Design another cover
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