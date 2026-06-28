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
    collecting: { label: "Extracting", icon: "◈" },
    transcribing: { label: "Transcribing", icon: "✍" },
    healing: { label: "Healing", icon: "🩹" },
    structuring: { label: "Structuring", icon: "⚙" },
    assembling: { label: "Assembling", icon: "📐" },
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
        <div style={{ minHeight: "100vh", background: "#f7f2e4", fontFamily: "'DM Sans', sans-serif", color: "#2b2b2b" }}>

            {/* ── Nav ── */}
            <nav style={{
                borderBottom: "1px solid #efefcf",
                padding: "0 40px", height: "60px",
                display: "flex", alignItems: "center", gap: "16px",
                position: "sticky", top: 0,
                background: "#ffffff", zIndex: 50,
            }}>
                <button onClick={() => router.push("/dashboard")}
                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", color: "#2b2b2b", fontSize: "13px", fontWeight: "500", cursor: "pointer", transition: "opacity 0.2s" }}
                    onMouseOver={e => (e.currentTarget.style.opacity = "0.6")}
                    onMouseOut={e => (e.currentTarget.style.opacity = "1")}>
                    <ArrowLeft size={14} /> Back to Dashboard
                </button>
                <span style={{ color: "#e8e8e4" }}>|</span>
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <div style={{ width: "30px", height: "30px", background: "#1a1a1a", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ScanLine size={14} color="#ffffff" />
                    </div>
                    <span style={{ fontWeight: "600", fontSize: "14px", color: "#2b2b2b" }}>Handwritten Scanner</span>
                    <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", color: "#2563eb", background: "#ffffff", border: "1px solid #2563eb", borderRadius: "5px", padding: "2px 8px" }}>NEW</span>
                </div>
            </nav>

            <main style={{ maxWidth: "900px", margin: "0 auto", padding: "52px 40px 80px" }}>

                {/* ── Header ── */}
                <div style={{ marginBottom: "44px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#ffffff", border: "1px solid #2563eb", borderRadius: "20px", padding: "3px 12px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", color: "#2563eb", marginBottom: "16px" }}>
                        <Sparkles size={10} /> AI HANDWRITING RECOGNITION
                    </div>
                    <h1 style={{ fontSize: "36px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'Playfair Display', serif", marginBottom: "10px", color: "#2b2b2b" }}>
                        Handwritten Book Scanner
                    </h1>
                    <p style={{ color: "#2b2b2b", fontSize: "15px", lineHeight: "1.6", maxWidth: "580px", opacity: 0.7 }}>
                        Upload photos of handwritten pages, a PDF scan, or a ZIP of images — in any language.
                        AI reads, transcribes, and exports a clean, formatted book.
                    </p>

                    {/* Capability chips */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
                        {[
                            { icon: "🖼️", text: "Up to 400 photos" },
                            { icon: "🌏", text: "Any language" },
                            { icon: "📄", text: "PDF / DOCX / ZIP" },
                            { icon: "📚", text: "Auto chapter detection" },
                            { icon: "⬇️", text: "PDF + DOCX export" },
                        ].map(c => (
                            <span key={c.text} style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#2b2b2b", background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "20px", padding: "4px 12px", fontWeight: "500" }}>
                                {c.icon} {c.text}
                            </span>
                        ))}
                    </div>
                </div>

                {!result ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>

                        {/* ── Left: Upload ── */}
                        <div>
                            {/* Drop zone */}
                            <div
                                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => files.length === 0 && fileInputRef.current?.click()}
                                style={{
                                    border: `2px dashed ${dragging ? "#2563eb" : files.length > 0 ? "#2563eb80" : "#d0d0cc"}`,
                                    borderRadius: "16px", padding: "36px 24px",
                                    textAlign: "center",
                                    cursor: files.length > 0 ? "default" : "pointer",
                                    background: dragging ? "#f0f4ff" : files.length > 0 ? "#f7f9ff" : "#ffffff",
                                    transition: "all 0.2s", marginBottom: "14px",
                                }}
                            >
                                <input ref={fileInputRef} type="file"
                                    accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif,.pdf,.docx,.zip"
                                    multiple
                                    style={{ display: "none" }}
                                    onChange={e => e.target.files && addFiles(e.target.files)}
                                />
                                {files.length === 0 ? (
                                    <>
                                        <div style={{ width: "52px", height: "52px", background: "#f7f2e4", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                                            <Upload size={22} color="#2563eb" />
                                        </div>
                                        <p style={{ fontWeight: "600", fontSize: "14px", marginBottom: "6px", color: "#2b2b2b" }}>Drop handwritten pages here</p>
                                        <p style={{ color: "#2b2b2b", fontSize: "12px", lineHeight: "1.6", opacity: 0.6 }}>
                                            Images (JPG, PNG, WEBP…) · PDF scan · DOCX with images · ZIP archive
                                            <br />Up to 400 pages · Any language
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <div style={{ width: "48px", height: "48px", background: "#f7f2e4", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                                            {isImageOnly ? <Layers size={20} color="#2563eb" /> : <Archive size={20} color="#2563eb" />}
                                        </div>
                                        <p style={{ fontWeight: "600", fontSize: "14px", color: "#2b2b2b" }}>
                                            {fileCount} file{fileCount !== 1 ? "s" : ""} selected
                                        </p>
                                        <p style={{ color: "#2b2b2b", fontSize: "12px", marginTop: "4px", opacity: 0.6 }}>
                                            {isImageOnly ? `${fileCount} page image${fileCount !== 1 ? "s" : ""}` : "Mixed document input"}
                                        </p>
                                        <button
                                            onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                                            style={{ marginTop: "10px", background: "#f7f2e4", border: "1px solid #e8e8e4", borderRadius: "7px", padding: "6px 14px", color: "#2563eb", fontSize: "12px", fontWeight: "600", cursor: "pointer", transition: "all 0.15s" }}
                                        >
                                            + Add more pages
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* File list */}
                            {files.length > 0 && (
                                <div style={{ maxHeight: "220px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "5px", marginBottom: "14px", paddingRight: "2px" }}>
                                    {files.map((f, idx) => {
                                        const ext = f.name.split(".").pop()?.toUpperCase() || "?";
                                        const isImg = ["JPG", "JPEG", "PNG", "WEBP", "BMP", "TIFF", "TIF", "GIF"].includes(ext);
                                        return (
                                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "10px", background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "8px", padding: "8px 10px" }}>
                                                <div style={{ width: "28px", height: "28px", background: "#f7f2e4", border: "1px solid #e8e8e4", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                                    {isImg ? <ImageIcon size={12} color="#2563eb" /> : <FileText size={12} color="#2b2b2b" />}
                                                </div>
                                                <span style={{ flex: 1, fontSize: "12px", color: "#2b2b2b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                                                <span style={{ fontSize: "10px", color: "#2b2b2b", opacity: 0.5, flexShrink: 0 }}>{(f.size / 1024).toFixed(0)}KB</span>
                                                <button onClick={() => removeFile(idx)}
                                                    style={{ background: "#fff0f0", border: "none", color: "#dc2626", cursor: "pointer", display: "flex", padding: "3px", borderRadius: "4px", transition: "background 0.15s" }}
                                                    onMouseOver={e => (e.currentTarget.style.background = "#fecaca")}
                                                    onMouseOut={e => (e.currentTarget.style.background = "#fff0f0")}>
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {error && (
                                <div style={{ background: "#fff0f0", border: "1px solid #fecaca", borderRadius: "9px", padding: "10px 14px", color: "#dc2626", fontSize: "13px", marginBottom: "14px" }}>
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* ── Right: Config + progress ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            {/* Book title */}
                            <div>
                                <label style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#0c43bb", display: "block", marginBottom: "8px" }}>
                                    Book Title <span style={{ color: "#2b2b2b", fontWeight: "400", textTransform: "none", fontSize: "10px", opacity: 0.5 }}>(optional — AI will infer)</span>
                                </label>
                                <input type="text" value={bookTitle} onChange={e => setBookTitle(e.target.value)}
                                    placeholder="e.g. My Grandfather's Diary"
                                    style={{ width: "100%", background: "#f7f2e4", border: "1px solid #e8e8e4", borderRadius: "10px", padding: "12px 14px", fontSize: "14px", color: "#2b2b2b", outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
                                    onFocus={e => e.target.style.borderColor = "#2563eb"}
                                    onBlur={e => e.target.style.borderColor = "#e8e8e4"}
                                />
                            </div>

                            {/* Info card */}
                            <div style={{ background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "12px", padding: "16px" }}>
                                <p style={{ fontSize: "12px", color: "#2b2b2b", lineHeight: "1.7", margin: 0, opacity: 0.8 }}>
                                    <span style={{ color: "#2563eb", fontWeight: "600" }}>How it works:</span> Each page photo is fed to GPT-4o vision which reads the handwriting verbatim. The AI then structures the text into chapters and exports a clean, professionally-formatted book in PDF and DOCX.
                                </p>
                            </div>

                            {/* Tips */}
                            <div style={{ background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "12px", padding: "16px" }}>
                                <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#0c43bb", marginBottom: "10px" }}>Tips for best results</p>
                                {["Good lighting, minimal shadows", "Keep pages flat — avoid curled edges", "Higher image resolution = better accuracy", "Include one page per image for multi-page books", "Any language works — including mixed-language text"].map(tip => (
                                    <div key={tip} style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "7px" }}>
                                        <span style={{ color: "#2563eb", fontSize: "12px", lineHeight: "1.4", flexShrink: 0 }}>✓</span>
                                        <span style={{ fontSize: "12px", color: "#2b2b2b", lineHeight: "1.4", opacity: 0.75 }}>{tip}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Progress panel */}
                            {isLoading && (
                                <div style={{ background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "12px", padding: "16px", animation: "fadeInUp 0.3s ease" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                                        <Loader size={15} style={{ color: "#2563eb", animation: "spin 1.2s linear infinite", flexShrink: 0 }} />
                                        <div style={{ flex: 1 }}>
                                            <p style={{ fontSize: "13px", fontWeight: "600", color: "#2b2b2b" }}>{stageMeta.label}</p>
                                            <p style={{ fontSize: "11px", color: "#2b2b2b", marginTop: "2px", opacity: 0.55 }}>{progress.message}</p>
                                        </div>
                                        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "20px", fontWeight: "800", color: "#2b2b2b", letterSpacing: "-0.02em" }}>{progress.pct}%</span>
                                    </div>
                                    <div style={{ height: "3px", background: "#e8e8e4", borderRadius: "3px", overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${progress.pct}%`, background: "#1a1a1a", borderRadius: "3px", transition: "width 0.8s ease" }} />
                                    </div>
                                    <p style={{ fontSize: "11px", color: "#2b2b2b", marginTop: "10px", opacity: 0.5 }}>
                                        Large batches can take several minutes — please keep this tab open.
                                    </p>
                                </div>
                            )}

                            {/* Submit button */}
                            <button onClick={handleSubmit} disabled={files.length === 0 || isLoading}
                                style={{
                                    background: files.length === 0 || isLoading ? "#e8e8e4" : "#1a1a1a",
                                    border: "none", borderRadius: "12px", padding: "14px 24px",
                                    color: files.length === 0 || isLoading ? "#2b2b2b" : "#ffffff",
                                    fontSize: "14px", fontWeight: "700",
                                    cursor: files.length === 0 || isLoading ? "not-allowed" : "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                                    boxShadow: files.length > 0 && !isLoading ? "0 4px 20px rgba(0,0,0,0.12)" : "none",
                                    transition: "all 0.2s", letterSpacing: "0.01em",
                                    opacity: files.length === 0 || isLoading ? 0.6 : 1,
                                }}
                                onMouseOver={e => { if (files.length > 0 && !isLoading) e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,0.18)"; }}
                                onMouseOut={e => { e.currentTarget.style.boxShadow = files.length > 0 && !isLoading ? "0 4px 20px rgba(0,0,0,0.12)" : "none"; }}
                            >
                                {isLoading ? (
                                    <><Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> Processing…</>
                                ) : (
                                    <><ScanLine size={16} /> Scan & Transcribe</>
                                )}
                            </button>
                        </div>
                    </div>

                ) : (
                    /* ── Results ── */
                    <div style={{ animation: "fadeInUp 0.4s ease" }}>
                        {/* Success banner */}
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "14px", padding: "18px 22px", marginBottom: "28px" }}>
                            <div style={{ width: "44px", height: "44px", background: "#f7f2e4", borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <CheckCircle size={22} color="#2563eb" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <p style={{ fontWeight: "700", fontSize: "16px", letterSpacing: "-0.01em", color: "#2b2b2b", fontFamily: "'Playfair Display', serif" }}>{result.title}</p>
                                <p style={{ color: "#2b2b2b", fontSize: "12px", marginTop: "3px", opacity: 0.6 }}>
                                    Transcription complete · {result.content_pages} of {result.total_pages} pages contain text
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                                <a href={`${API_BASE}/scan-handwritten/${result.job_id}/download/pdf`} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "#1a1a1a", border: "1px solid #1a1a1a", borderRadius: "9px", padding: "9px 16px", color: "#ffffff", fontSize: "13px", fontWeight: "600", textDecoration: "none", transition: "all 0.15s" }}
                                    onMouseOver={e => { e.currentTarget.style.background = "#2d2d2d"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "#1a1a1a"; }}>
                                    <Download size={13} /> PDF
                                </a>
                                <a href={`${API_BASE}/scan-handwritten/${result.job_id}/download/docx`} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "#ffffff", border: "1px solid #2b2b2b", borderRadius: "9px", padding: "9px 16px", color: "#2b2b2b", fontSize: "13px", fontWeight: "600", textDecoration: "none", transition: "all 0.15s" }}
                                    onMouseOver={e => { e.currentTarget.style.background = "#f7f2e4"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "#ffffff"; }}>
                                    <Download size={13} /> DOCX
                                </a>
                            </div>
                        </div>

                        {/* Stats grid */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
                            {[
                                { icon: <Languages size={16} color="#2563eb" />, label: "Language", value: result.language },
                                { icon: <Hash size={16} color="#2563eb" />, label: "Pages Scanned", value: `${result.content_pages}/${result.total_pages}` },
                                { icon: <AlignLeft size={16} color="#2563eb" />, label: "Words", value: result.total_words.toLocaleString() },
                                { icon: <BookOpen size={16} color="#2563eb" />, label: "Chapters", value: result.chapters.toString() },
                            ].map(s => (
                                <div key={s.label} style={{ background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "12px", padding: "16px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "8px" }}>
                                        {s.icon}
                                        <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.07em", textTransform: "uppercase", color: "#0c43bb" }}>{s.label}</span>
                                    </div>
                                    <div style={{ fontSize: "18px", fontWeight: "800", color: "#2b2b2b", letterSpacing: "-0.02em", fontFamily: "'Playfair Display', serif" }}>
                                        {s.value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Chapter list */}
                        {result.chapter_titles.length > 0 && (
                            <div style={{ background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "14px", padding: "20px", marginBottom: "24px" }}>
                                <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#0c43bb", marginBottom: "14px" }}>
                                    Detected Chapters ({result.chapters})
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    {result.chapter_titles.map((title, i) => (
                                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "#f7f2e4", border: "1px solid #e8e8e4", borderRadius: "8px" }}>
                                            <span style={{ width: "24px", height: "24px", borderRadius: "6px", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#ffffff", flexShrink: 0 }}>
                                                {i + 1}
                                            </span>
                                            <span style={{ fontSize: "13px", color: "#2b2b2b", flex: 1 }}>{title}</span>
                                            <ChevronRight size={13} color="#2b2b2b" style={{ opacity: 0.4 }} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* New scan button */}
                        <button onClick={() => { setResult(null); setFiles([]); setBookTitle(""); setError(""); setProgress({ stage: "idle", pct: 0, message: "" }); }}
                            style={{ background: "#ffffff", border: "1px solid #e8e8e4", borderRadius: "10px", padding: "10px 20px", color: "#2b2b2b", fontSize: "13px", fontWeight: "500", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseOver={e => { e.currentTarget.style.background = "#f7f2e4"; }}
                            onMouseOut={e => { e.currentTarget.style.background = "#ffffff"; }}>
                            ← Scan another book
                        </button>
                    </div>
                )}
            </main>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes fadeInUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                input::placeholder { color: #2b2b2b; opacity: 0.4; }
                ::-webkit-scrollbar { width:3px; }
                ::-webkit-scrollbar-thumb { background: #e8e8e4; border-radius:2px; }
            `}</style>
        </div>
    );
}