"use client";
import { useState, useRef, useEffect } from "react";
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

interface CoverStatus {
    job_id: string;
    stage: string;
    pct: number;
    message: string;
    result?: CoverResult;
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
        const { job_id } = await res.json();
        return await new Promise<CoverResult>((resolve, reject) => {
            let consecutiveErrors = 0;
            const poll = async () => {
                try {
                    const statusRes = await fetch(`${API_BASE}/design-cover/${job_id}/status`);
                    if (!statusRes.ok) {
                        const err = await statusRes.json().catch(() => ({ detail: `HTTP ${statusRes.status}` }));
                        throw new Error(err.detail || `HTTP ${statusRes.status}`);
                    }
                    consecutiveErrors = 0;
                    const status: CoverStatus = await statusRes.json();
                    if (status.stage === "done" && status.result) {
                        resolve(status.result);
                        return;
                    }
                    if (status.stage === "error") {
                        reject(new Error(status.message || "Cover design failed."));
                        return;
                    }
                    setTimeout(poll, 3000);
                } catch (err) {
                    consecutiveErrors += 1;
                    if (consecutiveErrors >= 10) {
                        reject(err instanceof Error ? err : new Error("Lost connection to cover job."));
                        return;
                    }
                    setTimeout(poll, Math.min(3000 * consecutiveErrors, 15000));
                }
            };
            setTimeout(poll, 1500);
        });
    } finally {
        clearTimeout(timer);
    }
}

function CoverPreview({ concept }: { concept: CoverConcept }) {
    const pal = concept.palette;
    const titleLines = concept.title.split("\n");
    const coverRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!coverRef.current) return;
        const cover = coverRef.current;
        const rect = cover.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const xc = rect.width / 2;
        const yc = rect.height / 2;
        const angleY = (x - xc) / 6; // Y rotation (tilt side to side)
        const angleX = (yc - y) / 12; // X rotation (tilt up and down)
        cover.style.transform = `perspective(1000px) rotateY(${angleY}deg) rotateX(${angleX}deg) scale(1.06)`;
        cover.style.boxShadow = `${-angleY - 18}px 25px 45px rgba(0, 0, 0, 0.26)`;
    };

    const handleMouseLeave = () => {
        if (!coverRef.current) return;
        const cover = coverRef.current;
        cover.style.transform = "perspective(1000px) rotateY(-12deg) rotateX(4deg) scale(1)";
        cover.style.boxShadow = "-15px 20px 40px rgba(0,0,0,0.18)";
    };

    return (
        <div style={{ perspective: "1000px", padding: "10px 0" }}>
            <div
                ref={coverRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                style={{
                    width: "220px",
                    height: "310px",
                    borderRadius: "4px 10px 10px 4px",
                    background: `linear-gradient(160deg, ${pal.bg_primary ?? pal.bg_top} 0%, ${pal.bg_secondary ?? pal.bg_bottom} 100%)`,
                    position: "relative",
                    overflow: "hidden",
                    flexShrink: 0,
                    transform: "perspective(1000px) rotateY(-12deg) rotateX(4deg)",
                    transformStyle: "preserve-3d",
                    transition: "transform 0.15s ease-out, box-shadow 0.15s ease",
                    boxShadow: "-15px 20px 40px rgba(0,0,0,0.18)",
                    border: "1px solid rgba(0,0,0,0.06)",
                    cursor: "pointer",
                }}
            >
                {/* Spine Edge Shadow */}
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "10px", background: "linear-gradient(90deg, rgba(0,0,0,0.22) 0%, transparent 100%)", zIndex: 10 }} />
                
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
            a.download = result.original_filename;
        } else {
            a.download = `cover_${result.original_filename}`;
        }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const isZipBundle = result?.mode === "zip_bundle";
    const concept = result?.concept;

    return (
        <div style={{ minHeight: "100vh", background: "var(--void)", fontFamily: "'DM Sans', sans-serif", color: "var(--text-primary)", position: "relative" }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "28px", height: "28px", background: "var(--text-primary)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Palette size={14} color="var(--void)" />
                    </div>
                    <span style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>Cover Designer</span>
                </div>
            </nav>

            <main style={{ maxWidth: "920px", margin: "0 auto", padding: "64px 32px 96px", position: "relative", zIndex: 2 }}>
                
                {/* Page header */}
                <div style={{ marginBottom: "40px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "20px", padding: "4px 14px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", color: "var(--sapphire)", marginBottom: "16px", boxShadow: "0 4px 10px rgba(0,0,0,0.02)" }}>
                        <Sparkles size={11} color="var(--sapphire)" />
                        Nano Banana AI · Cover Designer
                    </div>
                    <h1 className="serif" style={{ fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em", marginBottom: "10px", color: "var(--text-primary)", lineHeight: 1.15 }}>
                        AI Book Cover Designer
                    </h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.6" }}>
                        Upload your PDF or DOCX manuscript. The model generates a full-bleed cover page, sets matching typography, and attaches it as the first page of your book.
                    </p>
                </div>

                {!result ? (
                    <>
                        {/* Drop zone */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => !file && fileInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${dragging ? "var(--sapphire)" : file ? "rgba(37,99,235,0.4)" : "var(--border-strong)"}`,
                                borderRadius: "20px", padding: "48px 32px",
                                background: dragging ? "rgba(37,99,235,0.05)" : file ? "rgba(37,99,235,0.02)" : "var(--onyx)",
                                cursor: file ? "default" : "pointer", textAlign: "center",
                                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)", marginBottom: "24px",
                                boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.02)",
                            }}
                        >
                            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.zip" style={{ display: "none" }}
                                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />

                            {file ? (
                                <div>
                                    <div style={{ width: "56px", height: "56px", background: "var(--void)", border: "1.5px solid var(--border-mid)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                                        {file.name.split(".").pop()?.toLowerCase() === "zip"
                                            ? <Archive size={22} color="var(--sapphire)" />
                                            : <BookMarked size={22} color="var(--sapphire)" />
                                        }
                                    </div>
                                    <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "4px", color: "var(--text-primary)" }}>{file.name}</p>
                                    <p style={{ color: "var(--text-tertiary)", fontSize: "12px", marginBottom: "14px" }}>
                                        {(file.size / 1024).toFixed(1)} KB · {file.name.split(".").pop()?.toUpperCase()}
                                    </p>
                                    <button onClick={(e) => { e.stopPropagation(); setFile(null); setBookTitle(""); setError(""); }} className="btn-ghost" style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.05)", color: "var(--crimson)", border: "none" }}>
                                        <X size={12} /> Remove
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <div style={{ width: "56px", height: "56px", background: "var(--void)", border: "1.5px solid var(--border-mid)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                                        <Upload size={22} color="var(--sapphire)" />
                                    </div>
                                    <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "6px", color: "var(--text-primary)" }}>Drop book file here</p>
                                    <p style={{ color: "var(--text-tertiary)", fontSize: "12px" }}>.PDF or .DOCX · or .ZIP containing multiple books · max 150 MB</p>
                                </div>
                            )}
                        </div>

                        {/* Title & description */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                            <div>
                                <label className="field-label">
                                    Book Title {file?.name.endsWith(".zip") && <span style={{ color: "var(--text-tertiary)", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>(optional for ZIP)</span>}
                                </label>
                                <input type="text" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="e.g. Rise of the Astrals" className="input-field" />
                            </div>
                            <div>
                                <label className="field-label">
                                    Brief Description <span style={{ color: "var(--text-tertiary)", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>(optional — helps AI design)</span>
                                </label>
                                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. A space opera with deep philosophical undertones" className="input-field" />
                            </div>
                        </div>

                        {/* Custom cover image */}
                        <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "14px", padding: "20px", marginBottom: "24px" }}>
                            <label className="field-label" style={{ marginBottom: "10px" }}>
                                🖼️ Custom Cover Background <span style={{ color: "var(--text-tertiary)", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>(optional — skips AI text-to-image)</span>
                            </label>
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setCoverImage(e.target.files?.[0] ?? null)} style={{ fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer", width: "100%" }} />
                            {coverImage && (
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "12px" }}>
                                    <span style={{ color: "var(--emerald)", fontWeight: "600" }}>✅ {coverImage.name}</span>
                                    <button onClick={() => setCoverImage(null)} className="btn-ghost" style={{ padding: "3px 10px", fontSize: "11px", borderRadius: "6px", background: "rgba(239, 68, 68, 0.05)", color: "var(--crimson)", border: "none" }}>✕ remove</button>
                                </div>
                            )}
                        </div>

                        {/* Design Style Selection */}
                        <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "14px", padding: "20px", marginBottom: "24px" }}>
                            <label className="field-label" style={{ marginBottom: "12px" }}>Design Style Preset</label>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {[
                                    { value: "", label: "✦ Default", hint: "Premium" },
                                    { value: "premium", label: "💎 Premium", hint: "Luxury & elegant" },
                                    { value: "scifi", label: "🚀 Sci-Fi", hint: "Futuristic & neon" },
                                    { value: "minimalist", label: "◻ Minimalist", hint: "Sparse & modern" },
                                    { value: "fantasy", label: "🔮 Fantasy", hint: "Mystical & rich" },
                                    { value: "thriller", label: "⚡ Thriller", hint: "Dark & high contrast" },
                                    { value: "romance", label: "🌸 Romance", hint: "Warm & soft" },
                                    { value: "academic", label: "📚 Academic", hint: "Structured & formal" },
                                    { value: "retro", label: "📻 Retro", hint: "Vintage warmth" },
                                    { value: "other", label: "✍️ Other", hint: "Describe your own style" },
                                ].map(({ value, label, hint }) => {
                                    const selected = designStyle === value;
                                    return (
                                        <button
                                            key={value} title={hint} type="button" onClick={() => setDesignStyle(value)}
                                            style={{
                                                background: selected ? "var(--sapphire)" : "var(--void)",
                                                border: `1.5px solid ${selected ? "var(--sapphire)" : "var(--border-mid)"}`,
                                                borderRadius: "8px", padding: "8px 16px",
                                                fontSize: "12px", fontWeight: selected ? "700" : "500",
                                                color: selected ? "var(--void)" : "var(--text-primary)",
                                                cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                                            }}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>

                            {designStyle === "other" && (
                                <div style={{ marginTop: "14px" }}>
                                    <input type="text" value={customStyle} onChange={(e) => setCustomStyle(e.target.value)} placeholder="e.g. brutalist, watercolor portrait, retro synthwave..." className="input-field" />
                                    <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "6px" }}>Describe any style concept — the model will generate art to match.</p>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: "10px", padding: "12px 16px", color: "var(--crimson)", fontSize: "13px", marginBottom: "20px" }}>
                                {error}
                            </div>
                        )}

                        {nbWarning && (
                            <div style={{ background: "rgba(245,158,11,0.06)", border: "1.5px solid rgba(245,158,11,0.18)", borderRadius: "10px", padding: "12px 16px", color: "var(--amber)", fontSize: "13px", marginBottom: "20px" }}>
                                <strong>Nano Banana warning:</strong> Image cluster unavailable — cover defaults to styles gradient.
                            </div>
                        )}

                        <button onClick={handleSubmit} disabled={!file || loading} className="btn-dark" style={{ width: "100%", justifyContent: "center", padding: "14px", borderRadius: "12px" }}>
                            {loading ? (
                                <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Designing Cover Layout...</>
                            ) : (
                                <><Sparkles size={18} /> Design Cover with AI</>
                            )}
                        </button>
                    </>
                ) : (
                    /* Results panel */
                    <div style={{ animation: "fadeInUp 0.4s ease forwards" }}>
                        <div className="card" style={{ display: "flex", alignItems: "center", gap: "16px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "20px 24px", marginBottom: "28px" }}>
                            <div style={{ width: "44px", height: "44px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <CheckCircle size={22} color="var(--emerald)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <h3 className="serif" style={{ fontSize: "20px", color: "var(--text-primary)" }}>
                                    {isZipBundle
                                        ? `${result!.files_processed} covers designed successfully`
                                        : "Cover designed successfully"
                                    }
                                </h3>
                                <p style={{ color: "var(--text-secondary)", fontSize: "12px", marginTop: "3px" }}>
                                    {result!.original_filename}
                                </p>
                            </div>
                            <button onClick={handleDownload} className="btn-dark" style={{ padding: "10px 18px", fontSize: "13px", borderRadius: "10px" }}>
                                <Download size={14} />
                                {isZipBundle ? "Download ZIP Bundle" : "Download with Cover"}
                            </button>
                        </div>

                        {/* ZIP multiple preview grid */}
                        {isZipBundle && result!.files && result!.files.length > 0 && (
                            <div>
                                <h3 className="serif" style={{ fontSize: "22px", marginBottom: "20px", color: "var(--text-primary)" }}>Covers Generated</h3>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "24px" }}>
                                    {result!.files.map((f, idx) => (
                                        <div key={idx} className="card" style={{ padding: "16px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "12px" }}>
                                            <CoverPreview concept={f.concept} />
                                            <div style={{ marginTop: "14px" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                                                    <FileText size={12} color="var(--sapphire)" />
                                                    <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {f.source_filename}
                                                    </span>
                                                </div>
                                                <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "2px" }}>Style: {f.concept.style}</p>
                                                <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Motif: {f.concept.motif}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Single Cover preview details */}
                        {!isZipBundle && concept && (
                            <div style={{ display: "flex", gap: "36px", alignItems: "flex-start", marginTop: "16px" }}>
                                <CoverPreview concept={concept} />
                                <div style={{ flex: 1 }}>
                                    <h3 className="serif" style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text-primary)" }}>Nano Banana Design Concept</h3>
                                    
                                    <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "24px", display: "grid", gap: "16px" }}>
                                        {[
                                            { label: "Title", value: concept.title.replace("\n", " ") },
                                            { label: "Subtitle", value: concept.subtitle || "—" },
                                            { label: "Tagline", value: concept.tagline || "—" },
                                            { label: "Style Preset", value: concept.style },
                                            { label: "Genre Label", value: concept.genre_label },
                                            { label: "Motif", value: concept.motif },
                                        ].map(({ label, value }) => (
                                            <div key={label}>
                                                <span className="field-label" style={{ fontSize: "10px", margin: 0, color: "var(--sapphire)" }}>{label}</span>
                                                <p style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: "600", marginTop: "3px" }}>{value}</p>
                                            </div>
                                        ))}
                                        <div>
                                            <span className="field-label" style={{ fontSize: "10px", margin: "0 0 8px", color: "var(--sapphire)" }}>Color Palette Colors</span>
                                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                                {Object.entries(concept.palette).map(([key, val]) => (
                                                    <div key={key} title={`${key}: ${val}`} style={{ width: "24px", height: "24px", borderRadius: "5px", background: val, border: "1px solid rgba(0,0,0,0.1)", cursor: "help" }} />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button onClick={() => { setResult(null); setFile(null); setBookTitle(""); setDescription(""); setDesignStyle(""); setCustomStyle(""); }} className="btn-outline" style={{ marginTop: "32px" }}>
                            ← Design another cover
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}
