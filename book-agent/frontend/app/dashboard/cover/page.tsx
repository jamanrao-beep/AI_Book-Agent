"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
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
        bg_top: string;
        bg_bottom: string;
        accent: string;
        title_color: string;
        subtitle_color: string;
        tagline_color: string;
    };
    style: string;
    motif: string;
    genre_label: string;
}

interface CoverResult {
    job_id: string;
    mode: "single" | "zip_bundle";
    original_filename: string;
    concept?: CoverConcept;           // present for mode === "single"
    download_url: string;
    // zip_bundle extras
    files_processed?: number;
    files?: Array<{
        source_filename: string;
        concept: CoverConcept;
    }>;
}

async function designCover(
    file: File,
    bookTitle: string,
    description: string,
    designStyle: string,
): Promise<CoverResult> {
    const form = new FormData();
    form.append("file", file);
    form.append("book_title", bookTitle);
    form.append("description", description);
    form.append("design_style", designStyle);

    const res = await fetch(`${API_BASE}/design-cover`, {
        method: "POST",
        body: form,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `Server error ${res.status}`);
    }
    return res.json();
}

// Mini cover preview rendered in-browser from concept data
function CoverPreview({ concept }: { concept: CoverConcept }) {
    const pal = concept.palette;
    const titleLines = concept.title.split("\n");

    return (
        <div
            style={{
                width: "220px",
                height: "310px",
                borderRadius: "6px",
                background: `linear-gradient(160deg, ${pal.bg_top} 0%, ${pal.bg_bottom} 100%)`,
                position: "relative",
                overflow: "hidden",
                flexShrink: 0,
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
        >
            {/* Left accent bar */}
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "5px",
                    height: "100%",
                    background: pal.accent,
                }}
            />

            {/* Genre label */}
            {concept.genre_label && (
                <div
                    style={{
                        position: "absolute",
                        top: "16px",
                        left: "18px",
                        fontSize: "7px",
                        fontWeight: "800",
                        letterSpacing: "0.12em",
                        color: pal.accent,
                        background: `${pal.accent}22`,
                        border: `1px solid ${pal.accent}44`,
                        borderRadius: "3px",
                        padding: "2px 6px",
                    }}
                >
                    {concept.genre_label}
                </div>
            )}

            {/* Decorative motif dots */}
            <div
                style={{
                    position: "absolute",
                    right: "-10px",
                    bottom: "60px",
                    width: "100px",
                    height: "100px",
                    borderRadius: "50%",
                    border: `1px solid ${pal.accent}33`,
                }}
            />
            <div
                style={{
                    position: "absolute",
                    right: "10px",
                    bottom: "40px",
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    border: `1px solid ${pal.accent}44`,
                }}
            />

            {/* Title */}
            <div
                style={{
                    position: "absolute",
                    left: "18px",
                    top: "80px",
                    right: "12px",
                }}
            >
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

                {/* Rule */}
                <div
                    style={{
                        width: "32px",
                        height: "2.5px",
                        background: pal.accent,
                        margin: "8px 0",
                    }}
                />

                {/* Subtitle */}
                {concept.subtitle && (
                    <div
                        style={{
                            fontSize: "8px",
                            color: pal.subtitle_color,
                            lineHeight: 1.4,
                            marginBottom: "6px",
                        }}
                    >
                        {concept.subtitle}
                    </div>
                )}

                {/* Tagline */}
                {concept.tagline && (
                    <div
                        style={{
                            fontSize: "7px",
                            fontStyle: "italic",
                            color: pal.tagline_color,
                            lineHeight: 1.5,
                        }}
                    >
                        {concept.tagline.length > 70
                            ? concept.tagline.slice(0, 70) + "…"
                            : concept.tagline}
                    </div>
                )}
            </div>

            {/* Bottom band */}
            <div
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: "36px",
                    background: "rgba(0,0,0,0.4)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 18px",
                    justifyContent: "space-between",
                }}
            >
                {concept.author_line && (
                    <span
                        style={{ fontSize: "7px", color: "rgba(255,255,255,0.55)" }}
                    >
                        {concept.author_line}
                    </span>
                )}
                <span
                    style={{
                        fontSize: "6px",
                        fontWeight: "700",
                        color: pal.accent,
                        marginLeft: "auto",
                        letterSpacing: "0.1em",
                    }}
                >
                    EDITORIAL AI
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
        // Auto-fill title from filename (skip for zip — multiple books inside)
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
        try {
            const effectiveStyle = designStyle === "other" ? customStyle.trim() : designStyle;
            const res = await designCover(file, bookTitle, description, effectiveStyle);
            setResult(res);
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Cover design failed. Make sure the backend is running.",
            );
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
                            background: "rgba(251,146,60,0.15)",
                            border: "1px solid rgba(251,146,60,0.3)",
                            borderRadius: "8px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Palette size={14} color="#fb923c" />
                    </div>
                    <span style={{ fontWeight: "600", fontSize: "14px" }}>
                        Cover Designer
                    </span>
                </div>
            </nav>

            <main
                style={{ maxWidth: "860px", margin: "0 auto", padding: "52px 40px" }}
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
                        AI Book Cover Designer
                    </h1>
                    <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6" }}>
                        Upload your .pdf or .docx manuscript — or a .zip containing multiple files.
                        AI generates a full-bleed cover page for each and attaches it — zero design skills needed.
                    </p>
                </div>

                {!result ? (
                    <>
                        {/* Upload zone */}
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => !file && fileInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${dragging ? "#fb923c" : file ? "rgba(251,146,60,0.4)" : "rgba(255,255,255,0.1)"}`,
                                borderRadius: "16px",
                                padding: "40px 32px",
                                textAlign: "center",
                                cursor: file ? "default" : "pointer",
                                background: dragging
                                    ? "rgba(251,146,60,0.06)"
                                    : file
                                        ? "rgba(251,146,60,0.04)"
                                        : "rgba(255,255,255,0.02)",
                                transition: "all 0.2s",
                                marginBottom: "24px",
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.docx,.zip"
                                style={{ display: "none" }}
                                onChange={(e) =>
                                    e.target.files?.[0] && handleFile(e.target.files[0])
                                }
                            />

                            {file ? (
                                <div>
                                    <div
                                        style={{
                                            width: "52px",
                                            height: "52px",
                                            background: "rgba(251,146,60,0.12)",
                                            border: "1px solid rgba(251,146,60,0.3)",
                                            borderRadius: "12px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            margin: "0 auto 12px",
                                        }}
                                    >
                                        {file.name.split(".").pop()?.toLowerCase() === "zip"
                                            ? <Archive size={22} color="#fb923c" />
                                            : <BookMarked size={22} color="#fb923c" />
                                        }
                                    </div>
                                    <p style={{ fontWeight: "600", fontSize: "14px" }}>
                                        {file.name}
                                    </p>
                                    <p style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>
                                        {(file.size / 1024).toFixed(1)} KB ·{" "}
                                        {file.name.split(".").pop()?.toUpperCase()}
                                    </p>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setFile(null);
                                            setBookTitle("");
                                            setError("");
                                        }}
                                        style={{
                                            marginTop: "10px",
                                            background: "none",
                                            border: "none",
                                            color: "#64748b",
                                            cursor: "pointer",
                                            fontSize: "12px",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "4px",
                                        }}
                                    >
                                        <X size={12} /> Remove
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <div
                                        style={{
                                            width: "52px",
                                            height: "52px",
                                            background: "rgba(255,255,255,0.05)",
                                            borderRadius: "12px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            margin: "0 auto 14px",
                                        }}
                                    >
                                        <Upload size={22} color="#64748b" />
                                    </div>
                                    <p style={{ fontWeight: "500", fontSize: "14px", marginBottom: "6px" }}>
                                        Drop your manuscript here
                                    </p>
                                    <p style={{ color: "#475569", fontSize: "12px" }}>
                                        .PDF or .DOCX · or .ZIP with multiple files · max 150 MB
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Book title + description fields */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                            <div>
                                <label
                                    style={{
                                        fontSize: "11px",
                                        fontWeight: "700",
                                        letterSpacing: "0.08em",
                                        textTransform: "uppercase",
                                        color: "#64748b",
                                        display: "block",
                                        marginBottom: "8px",
                                    }}
                                >
                                    Book Title{" "}
                                    {file?.name.endsWith(".zip") && (
                                        <span style={{ color: "#334155", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>
                                            (optional for ZIP — inferred per file)
                                        </span>
                                    )}
                                </label>
                                <input
                                    type="text"
                                    value={bookTitle}
                                    onChange={(e) => setBookTitle(e.target.value)}
                                    placeholder="e.g. The Art of Leadership"
                                    style={{
                                        width: "100%",
                                        background: "rgba(255,255,255,0.05)",
                                        border: "1px solid rgba(255,255,255,0.1)",
                                        borderRadius: "10px",
                                        padding: "12px 14px",
                                        fontSize: "14px",
                                        color: "#e2e8f0",
                                        outline: "none",
                                        transition: "border-color 0.2s",
                                    }}
                                    onFocus={(e) =>
                                        (e.currentTarget.style.borderColor = "#fb923c")
                                    }
                                    onBlur={(e) =>
                                        (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")
                                    }
                                />
                            </div>
                            <div>
                                <label
                                    style={{
                                        fontSize: "11px",
                                        fontWeight: "700",
                                        letterSpacing: "0.08em",
                                        textTransform: "uppercase",
                                        color: "#64748b",
                                        display: "block",
                                        marginBottom: "8px",
                                    }}
                                >
                                    Brief Description{" "}
                                    <span style={{ color: "#334155", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>
                                        (optional — helps AI design better)
                                    </span>
                                </label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="e.g. A business guide for modern managers"
                                    style={{
                                        width: "100%",
                                        background: "rgba(255,255,255,0.05)",
                                        border: "1px solid rgba(255,255,255,0.1)",
                                        borderRadius: "10px",
                                        padding: "12px 14px",
                                        fontSize: "14px",
                                        color: "#e2e8f0",
                                        outline: "none",
                                        transition: "border-color 0.2s",
                                    }}
                                    onFocus={(e) =>
                                        (e.currentTarget.style.borderColor = "#fb923c")
                                    }
                                    onBlur={(e) =>
                                        (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")
                                    }
                                />
                            </div>
                        </div>

                        {/* Design style selector */}
                        <div style={{ marginBottom: "24px" }}>
                            <label
                                style={{
                                    fontSize: "11px",
                                    fontWeight: "700",
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    color: "#64748b",
                                    display: "block",
                                    marginBottom: "10px",
                                }}
                            >
                                Design Style{" "}
                                <span style={{ color: "#334155", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>
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
                                                background: selected
                                                    ? "rgba(251,146,60,0.18)"
                                                    : "rgba(255,255,255,0.04)",
                                                border: `1px solid ${selected ? "#fb923c" : "rgba(255,255,255,0.1)"}`,
                                                borderRadius: "8px",
                                                padding: "7px 14px",
                                                fontSize: "12px",
                                                fontWeight: selected ? "700" : "500",
                                                color: selected ? "#fb923c" : "#94a3b8",
                                                cursor: "pointer",
                                                transition: "all 0.15s",
                                                whiteSpace: "nowrap",
                                            }}
                                            onMouseOver={(e) => {
                                                if (!selected) {
                                                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(251,146,60,0.4)";
                                                    (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0";
                                                }
                                            }}
                                            onMouseOut={(e) => {
                                                if (!selected) {
                                                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
                                                    (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
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
                                            width: "100%",
                                            background: "rgba(251,146,60,0.06)",
                                            border: "1px solid rgba(251,146,60,0.4)",
                                            borderRadius: "10px",
                                            padding: "11px 14px",
                                            fontSize: "13px",
                                            color: "#e2e8f0",
                                            outline: "none",
                                            transition: "border-color 0.2s",
                                            boxSizing: "border-box",
                                        }}
                                        onFocus={(e) =>
                                            (e.currentTarget.style.borderColor = "#fb923c")
                                        }
                                        onBlur={(e) =>
                                            (e.currentTarget.style.borderColor = "rgba(251,146,60,0.4)")
                                        }
                                    />
                                    <p style={{ fontSize: "11px", color: "#475569", marginTop: "6px" }}>
                                        Describe any style you like — the AI will interpret it freely.
                                    </p>
                                </div>
                            )}
                            {designStyle && designStyle !== "other" && (
                                <p style={{ fontSize: "11px", color: "#475569", marginTop: "8px" }}>
                                    AI will design a{" "}
                                    <span style={{ color: "#fb923c", fontWeight: "600" }}>
                                        {designStyle}
                                    </span>{" "}
                                    themed cover. Hover a style to see a description.
                                </p>
                            )}
                        </div>

                        {error && (
                            <div
                                style={{
                                    background: "rgba(239,68,68,0.1)",
                                    border: "1px solid rgba(239,68,68,0.2)",
                                    borderRadius: "10px",
                                    padding: "12px 16px",
                                    color: "#f87171",
                                    fontSize: "13px",
                                    marginBottom: "20px",
                                }}
                            >
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleSubmit}
                            disabled={!file || loading}
                            style={{
                                width: "100%",
                                background:
                                    !file || loading
                                        ? "rgba(251,146,60,0.3)"
                                        : "linear-gradient(135deg, #fb923c, #f97316)",
                                color: "white",
                                border: "none",
                                borderRadius: "12px",
                                padding: "14px 24px",
                                fontSize: "14px",
                                fontWeight: "700",
                                cursor: !file || loading ? "not-allowed" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "10px",
                                transition: "opacity 0.2s",
                            }}
                        >
                            {loading ? (
                                <>
                                    <Loader
                                        size={18}
                                        style={{ animation: "spin 1s linear infinite" }}
                                    />
                                    Designing your cover...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={18} /> Design Cover with AI
                                </>
                            )}
                        </button>

                        {loading && (
                            <p
                                style={{
                                    textAlign: "center",
                                    color: "#475569",
                                    fontSize: "12px",
                                    marginTop: "12px",
                                }}
                            >
                                AI is creating your cover concept and rendering the design…
                                usually takes 15–30 seconds
                            </p>
                        )}
                    </>
                ) : (
                    /* ── Results ─────────────────────────────────────────────────────── */
                    <div style={{ animation: "fadeInUp 0.4s ease forwards" }}>
                        {/* Success banner */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                background: "rgba(251,146,60,0.1)",
                                border: "1px solid rgba(251,146,60,0.25)",
                                borderRadius: "12px",
                                padding: "16px 20px",
                                marginBottom: "28px",
                            }}
                        >
                            <CheckCircle size={20} color="#fb923c" />
                            <div>
                                <p style={{ fontWeight: "600", fontSize: "14px" }}>
                                    {isZipBundle
                                        ? `${result!.files_processed} cover${result!.files_processed !== 1 ? "s" : ""} designed successfully`
                                        : "Cover designed successfully"
                                    }
                                </p>
                                <p style={{ color: "#64748b", fontSize: "12px", marginTop: "2px" }}>
                                    {result!.original_filename}
                                    {isZipBundle && (
                                        <span style={{ marginLeft: "6px", color: "#fb923c" }}>
                                            · ZIP bundle
                                        </span>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={handleDownload}
                                style={{
                                    marginLeft: "auto",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    background: "linear-gradient(135deg, #fb923c, #f97316)",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "8px",
                                    padding: "9px 18px",
                                    fontSize: "13px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                <Download size={14} />
                                {isZipBundle ? "Download ZIP Bundle" : "Download with Cover"}
                            </button>
                        </div>

                        {/* ── ZIP bundle: show per-file preview grid ── */}
                        {isZipBundle && result!.files && result!.files.length > 0 && (
                            <div>
                                <h2
                                    style={{
                                        fontSize: "18px",
                                        fontWeight: "700",
                                        fontFamily: "'Playfair Display', serif",
                                        marginBottom: "20px",
                                    }}
                                >
                                    Covers Generated ({result!.files_processed})
                                </h2>
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                                        gap: "24px",
                                    }}
                                >
                                    {result!.files.map((f, idx) => (
                                        <div key={idx}>
                                            <CoverPreview concept={f.concept} />
                                            <div style={{ marginTop: "10px" }}>
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "6px",
                                                        marginBottom: "4px",
                                                    }}
                                                >
                                                    <FileText size={12} color="#fb923c" />
                                                    <span
                                                        style={{
                                                            fontSize: "12px",
                                                            fontWeight: "600",
                                                            color: "#cbd5e1",
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap",
                                                        }}
                                                    >
                                                        {f.source_filename}
                                                    </span>
                                                </div>
                                                <p
                                                    style={{
                                                        fontSize: "11px",
                                                        color: "#475569",
                                                        marginBottom: "2px",
                                                    }}
                                                >
                                                    <span style={{ color: "#64748b" }}>Style:</span>{" "}
                                                    {f.concept.style} · {f.concept.genre_label}
                                                </p>
                                                <p style={{ fontSize: "11px", color: "#475569" }}>
                                                    <span style={{ color: "#64748b" }}>Motif:</span>{" "}
                                                    {f.concept.motif}
                                                </p>
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        gap: "5px",
                                                        marginTop: "6px",
                                                        flexWrap: "wrap",
                                                    }}
                                                >
                                                    {Object.entries(f.concept.palette).map(([key, val]) => (
                                                        <div
                                                            key={key}
                                                            title={`${key}: ${val}`}
                                                            style={{
                                                                width: "18px",
                                                                height: "18px",
                                                                borderRadius: "4px",
                                                                background: val,
                                                                border: "1px solid rgba(255,255,255,0.1)",
                                                                cursor: "help",
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

                        {/* ── Single file: preview + concept details ── */}
                        {!isZipBundle && concept && (
                            <div
                                style={{
                                    display: "flex",
                                    gap: "32px",
                                    alignItems: "flex-start",
                                }}
                            >
                                {/* Cover preview */}
                                <CoverPreview concept={concept} />

                                {/* Concept details */}
                                <div style={{ flex: 1 }}>
                                    <h2
                                        style={{
                                            fontSize: "20px",
                                            fontWeight: "700",
                                            fontFamily: "'Playfair Display', serif",
                                            marginBottom: "20px",
                                        }}
                                    >
                                        AI Design Concept
                                    </h2>

                                    <div style={{ display: "grid", gap: "14px" }}>
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
                                                        fontSize: "10px",
                                                        fontWeight: "700",
                                                        letterSpacing: "0.08em",
                                                        textTransform: "uppercase",
                                                        color: "#475569",
                                                    }}
                                                >
                                                    {label}
                                                </span>
                                                <p
                                                    style={{
                                                        fontSize: "14px",
                                                        color: "#cbd5e1",
                                                        marginTop: "3px",
                                                    }}
                                                >
                                                    {value}
                                                </p>
                                            </div>
                                        ))}

                                        {/* Palette swatches */}
                                        <div>
                                            <span
                                                style={{
                                                    fontSize: "10px",
                                                    fontWeight: "700",
                                                    letterSpacing: "0.08em",
                                                    textTransform: "uppercase",
                                                    color: "#475569",
                                                    display: "block",
                                                    marginBottom: "8px",
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
                                                            width: "28px",
                                                            height: "28px",
                                                            borderRadius: "6px",
                                                            background: val,
                                                            border: "1px solid rgba(255,255,255,0.1)",
                                                            cursor: "help",
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* New design button */}
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
                                marginTop: "28px",
                                background: "none",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "10px",
                                padding: "10px 20px",
                                color: "#64748b",
                                fontSize: "13px",
                                cursor: "pointer",
                                transition: "all 0.2s",
                            }}
                            onMouseOver={(e) =>
                                ((e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0")
                            }
                            onMouseOut={(e) =>
                                ((e.currentTarget as HTMLButtonElement).style.color = "#64748b")
                            }
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