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

const STAGE_META: Record<string, { label: string; color: string; icon: string }> = {
    idle: { label: "Ready", color: "#94a3b8", icon: "⊙" },
    collecting: { label: "Extracting", color: "#a78bfa", icon: "◈" },
    transcribing: { label: "Transcribing", color: "#60a5fa", icon: "✍" },
    healing: { label: "Healing", color: "#f472b6", icon: "🩹" },
    structuring: { label: "Structuring", color: "#f59e0b", icon: "⚙" },
    assembling: { label: "Assembling", color: "#fb923c", icon: "📐" },
    done: { label: "Complete", color: "#34d399", icon: "✓" },
    error: { label: "Error", color: "#f87171", icon: "✕" },
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
            // Deduplicate by name+size
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

        // AbortController for the upload itself (5 min timeout)
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

    // ── Cleanup on unmount — prevent WS/interval leaks if user navigates away ──
    useEffect(() => {
        return () => {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            if (wsRef.current) { try { wsRef.current.close(); } catch (_) { } wsRef.current = null; }
        };
    }, []);

    // ── Real-time progress via WebSocket with polling fallback ──
    const startProgressTracking = (jobId: string) => {
        // Try WebSocket first
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

        // Polling fallback (used if WS unavailable or as safety net)
        const startPolling = () => {
            if (pollInterval) return;
            pollInterval = setInterval(async () => {
                try {
                    const r = await fetch(`${API_BASE}/scan-handwritten/${jobId}/status`);
                    if (!r.ok) return;
                    const data = await r.json();
                    applyUpdate({ stage: data.stage, pct: data.pct, message: data.message, result: data.result, error: data.error });
                } catch (_) { /* network blip — keep polling */ }
            }, 3000);
            // M5 FIX: assign ref immediately after creation so stopAll() can always clear it,
            // even if WS "complete" fires synchronously before the outer function returns.
            pollRef.current = pollInterval;
        };

        try {
            const wsUrl = API_BASE.replace(/^http/, "ws") + `/ws/status/${jobId}`;
            // L2 FIX: assign wsRef.current atomically with ws creation so a fast
            // unmount between new WebSocket() and wsRef.current = ws can't miss it.
            wsRef.current = ws = new WebSocket(wsUrl);

            ws.onopen = () => { wsConnected = true; };
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === "progress") applyUpdate({ stage: msg.stage, pct: msg.progress, message: msg.message });
                    // H6 FIX: msg.result is already the correct shape {job_id, title, ...}
                    // The old msg.result?.result ?? msg.result double-unwrap was accidental.
                    else if (msg.type === "complete") applyUpdate({ stage: "done", pct: 100, result: msg.result });
                    else if (msg.type === "error") applyUpdate({ stage: "error", error: msg.message });
                } catch (_) { }
            };
            ws.onerror = () => { if (!wsConnected) startPolling(); };
            ws.onclose = () => { if (!wsConnected) startPolling(); };

            // Always run polling alongside WS as a safety net for missed messages
            startPolling();
        } catch (_) {
            startPolling();
        }
    };

    return (
        <div style={{ minHeight: "100vh", background: "#0a0c18", fontFamily: "'DM Sans', sans-serif", color: "#e2e8f0" }}>

            {/* ── Nav ── */}
            <nav style={{
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                padding: "0 40px", height: "60px",
                display: "flex", alignItems: "center", gap: "16px",
                position: "sticky", top: 0,
                background: "rgba(10,12,24,0.95)", backdropFilter: "blur(14px)", zIndex: 50,
            }}>
                <button onClick={() => router.push("/dashboard")}
                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", color: "#64748b", fontSize: "13px", cursor: "pointer", transition: "color 0.2s" }}
                    onMouseOver={e => (e.currentTarget.style.color = "#e2e8f0")}
                    onMouseOut={e => (e.currentTarget.style.color = "#64748b")}>
                    <ArrowLeft size={14} /> Back to Dashboard
                </button>
                <span style={{ color: "rgba(255,255,255,0.08)" }}>|</span>
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <div style={{ width: "30px", height: "30px", background: "rgba(124,58,237,0.18)", border: "1px solid rgba(124,58,237,0.35)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ScanLine size={14} color="#a78bfa" />
                    </div>
                    <span style={{ fontWeight: "600", fontSize: "14px" }}>Handwritten Scanner</span>
                    <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", color: "#7c3aed", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: "5px", padding: "2px 8px" }}>NEW</span>
                </div>
            </nav>

            <main style={{ maxWidth: "900px", margin: "0 auto", padding: "52px 40px 80px" }}>

                {/* ── Header ── */}
                <div style={{ marginBottom: "44px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: "20px", padding: "3px 12px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", color: "#a78bfa", marginBottom: "16px" }}>
                        <Sparkles size={10} /> AI HANDWRITING RECOGNITION
                    </div>
                    <h1 style={{ fontSize: "36px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'Playfair Display', serif", marginBottom: "10px", background: "linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                        Handwritten Book Scanner
                    </h1>
                    <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6", maxWidth: "580px" }}>
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
                            <span key={c.text} style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#64748b", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "20px", padding: "4px 12px" }}>
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
                                    border: `2px dashed ${dragging ? "#7c3aed" : files.length > 0 ? "rgba(124,58,237,0.45)" : "rgba(255,255,255,0.1)"}`,
                                    borderRadius: "16px", padding: "36px 24px",
                                    textAlign: "center",
                                    cursor: files.length > 0 ? "default" : "pointer",
                                    background: dragging ? "rgba(124,58,237,0.07)" : files.length > 0 ? "rgba(124,58,237,0.04)" : "rgba(255,255,255,0.02)",
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
                                        <div style={{ width: "52px", height: "52px", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                                            <Upload size={22} color="#a78bfa" />
                                        </div>
                                        <p style={{ fontWeight: "600", fontSize: "14px", marginBottom: "6px" }}>Drop handwritten pages here</p>
                                        <p style={{ color: "#475569", fontSize: "12px", lineHeight: "1.6" }}>
                                            Images (JPG, PNG, WEBP…) · PDF scan · DOCX with images · ZIP archive
                                            <br />Up to 400 pages · Any language
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <div style={{ width: "48px", height: "48px", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                                            {isImageOnly ? <Layers size={20} color="#a78bfa" /> : <Archive size={20} color="#a78bfa" />}
                                        </div>
                                        <p style={{ fontWeight: "600", fontSize: "14px" }}>
                                            {fileCount} file{fileCount !== 1 ? "s" : ""} selected
                                        </p>
                                        <p style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>
                                            {isImageOnly ? `${fileCount} page image${fileCount !== 1 ? "s" : ""}` : "Mixed document input"}
                                        </p>
                                        <button
                                            onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                                            style={{ marginTop: "10px", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: "7px", padding: "6px 14px", color: "#a78bfa", fontSize: "12px", cursor: "pointer", transition: "all 0.15s" }}
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
                                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "8px 10px" }}>
                                                <div style={{ width: "28px", height: "28px", background: isImg ? "rgba(124,58,237,0.12)" : "rgba(255,255,255,0.05)", border: `1px solid ${isImg ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.08)"}`, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                                    {isImg ? <ImageIcon size={12} color="#a78bfa" /> : <FileText size={12} color="#64748b" />}
                                                </div>
                                                <span style={{ flex: 1, fontSize: "12px", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                                                <span style={{ fontSize: "10px", color: "#334155", flexShrink: 0 }}>{(f.size / 1024).toFixed(0)}KB</span>
                                                <button onClick={() => removeFile(idx)} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", display: "flex", padding: "2px" }}>
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {error && (
                                <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "9px", padding: "10px 14px", color: "#f87171", fontSize: "13px", marginBottom: "14px" }}>
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* ── Right: Config + progress ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            {/* Book title */}
                            <div>
                                <label style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", display: "block", marginBottom: "8px" }}>
                                    Book Title <span style={{ color: "#1e293b", fontWeight: "400", textTransform: "none", fontSize: "10px" }}>(optional — AI will infer)</span>
                                </label>
                                <input type="text" value={bookTitle} onChange={e => setBookTitle(e.target.value)}
                                    placeholder="e.g. My Grandfather's Diary"
                                    style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "12px 14px", fontSize: "14px", color: "#e2e8f0", outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
                                    onFocus={e => e.target.style.borderColor = "#7c3aed"}
                                    onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                                />
                            </div>

                            {/* Info card */}
                            <div style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "12px", padding: "16px" }}>
                                <p style={{ fontSize: "12px", color: "#64748b", lineHeight: "1.7", margin: 0 }}>
                                    <span style={{ color: "#a78bfa", fontWeight: "600" }}>How it works:</span> Each page photo is fed to GPT-4o vision which reads the handwriting verbatim. The AI then structures the text into chapters and exports a clean, professionally-formatted book in PDF and DOCX.
                                </p>
                            </div>

                            {/* Tips */}
                            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
                                <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#334155", marginBottom: "10px" }}>Tips for best results</p>
                                {["Good lighting, minimal shadows", "Keep pages flat — avoid curled edges", "Higher image resolution = better accuracy", "Include one page per image for multi-page books", "Any language works — including mixed-language text"].map(tip => (
                                    <div key={tip} style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "7px" }}>
                                        <span style={{ color: "#7c3aed", fontSize: "12px", lineHeight: "1.4", flexShrink: 0 }}>✓</span>
                                        <span style={{ fontSize: "12px", color: "#475569", lineHeight: "1.4" }}>{tip}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Progress bar (visible when loading) */}
                            {isLoading && (
                                <div style={{ background: "rgba(124,58,237,0.06)", border: `1px solid rgba(124,58,237,0.2)`, borderRadius: "12px", padding: "16px", animation: "fadeInUp 0.3s ease" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                                        <Loader size={15} style={{ color: stageMeta.color, animation: "spin 1.2s linear infinite", flexShrink: 0 }} />
                                        <div style={{ flex: 1 }}>
                                            <p style={{ fontSize: "13px", fontWeight: "600", color: stageMeta.color }}>{stageMeta.label}</p>
                                            <p style={{ fontSize: "11px", color: "#334155", marginTop: "2px" }}>{progress.message}</p>
                                        </div>
                                        <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "20px", fontWeight: "700", color: stageMeta.color }}>{progress.pct}%</span>
                                    </div>
                                    <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "3px", overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${progress.pct}%`, background: `linear-gradient(90deg, #7c3aed, ${stageMeta.color})`, borderRadius: "3px", transition: "width 0.8s ease", boxShadow: `0 0 8px ${stageMeta.color}66` }} />
                                    </div>
                                    <p style={{ fontSize: "11px", color: "#1e293b", marginTop: "10px" }}>
                                        Large batches can take several minutes — please keep this tab open.
                                    </p>
                                </div>
                            )}

                            {/* Submit button */}
                            <button onClick={handleSubmit} disabled={files.length === 0 || isLoading}
                                style={{
                                    background: files.length === 0 || isLoading ? "rgba(124,58,237,0.3)" : "linear-gradient(135deg, #7c3aed, #a855f7)",
                                    border: "none", borderRadius: "12px", padding: "14px 24px",
                                    color: "white", fontSize: "14px", fontWeight: "700",
                                    cursor: files.length === 0 || isLoading ? "not-allowed" : "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                                    boxShadow: files.length > 0 && !isLoading ? "0 4px 20px rgba(124,58,237,0.4)" : "none",
                                    transition: "all 0.2s", letterSpacing: "0.01em",
                                }}
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
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: "14px", padding: "18px 22px", marginBottom: "28px" }}>
                            <div style={{ width: "44px", height: "44px", background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <CheckCircle size={22} color="#a78bfa" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <p style={{ fontWeight: "700", fontSize: "16px", letterSpacing: "-0.01em" }}>{result.title}</p>
                                <p style={{ color: "#64748b", fontSize: "12px", marginTop: "3px" }}>
                                    Transcription complete · {result.content_pages} of {result.total_pages} pages contain text
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                                <a href={`${API_BASE}/scan-handwritten/${result.job_id}/download/pdf`} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "9px", padding: "9px 16px", color: "#f87171", fontSize: "13px", fontWeight: "600", textDecoration: "none", transition: "all 0.15s" }}
                                    onMouseOver={e => { e.currentTarget.style.background = "rgba(248,113,113,0.2)"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "rgba(248,113,113,0.12)"; }}>
                                    <Download size={13} /> PDF
                                </a>
                                <a href={`${API_BASE}/scan-handwritten/${result.job_id}/download/docx`} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: "9px", padding: "9px 16px", color: "#60a5fa", fontSize: "13px", fontWeight: "600", textDecoration: "none", transition: "all 0.15s" }}
                                    onMouseOver={e => { e.currentTarget.style.background = "rgba(96,165,250,0.2)"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "rgba(96,165,250,0.12)"; }}>
                                    <Download size={13} /> DOCX
                                </a>
                            </div>
                        </div>

                        {/* Stats grid */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
                            {[
                                { icon: <Languages size={16} color="#a78bfa" />, label: "Language", value: result.language, color: "#a78bfa", bg: "rgba(124,58,237,0.08)" },
                                { icon: <Hash size={16} color="#60a5fa" />, label: "Pages Scanned", value: `${result.content_pages}/${result.total_pages}`, color: "#60a5fa", bg: "rgba(96,165,250,0.08)" },
                                { icon: <AlignLeft size={16} color="#34d399" />, label: "Words", value: result.total_words.toLocaleString(), color: "#34d399", bg: "rgba(52,211,153,0.08)" },
                                { icon: <BookOpen size={16} color="#f59e0b" />, label: "Chapters", value: result.chapters.toString(), color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
                            ].map(s => (
                                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.color}25`, borderRadius: "12px", padding: "16px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "8px" }}>
                                        {s.icon}
                                        <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.07em", textTransform: "uppercase", color: "#334155" }}>{s.label}</span>
                                    </div>
                                    <div style={{ fontSize: "18px", fontWeight: "700", color: s.color, letterSpacing: "-0.01em", fontFamily: "'Playfair Display', serif" }}>
                                        {s.value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Chapter list */}
                        {result.chapter_titles.length > 0 && (
                            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "20px", marginBottom: "24px" }}>
                                <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#334155", marginBottom: "14px" }}>
                                    Detected Chapters ({result.chapters})
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    {result.chapter_titles.map((title, i) => (
                                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                                            <span style={{ width: "24px", height: "24px", borderRadius: "6px", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "#a78bfa", flexShrink: 0 }}>
                                                {i + 1}
                                            </span>
                                            <span style={{ fontSize: "13px", color: "#94a3b8", flex: 1 }}>{title}</span>
                                            <ChevronRight size={13} color="#334155" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* New scan button */}
                        <button onClick={() => { setResult(null); setFiles([]); setBookTitle(""); setError(""); setProgress({ stage: "idle", pct: 0, message: "" }); }}
                            style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 20px", color: "#64748b", fontSize: "13px", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseOver={e => (e.currentTarget.style.color = "#e2e8f0")}
                            onMouseOut={e => (e.currentTarget.style.color = "#64748b")}>
                            ← Scan another book
                        </button>
                    </div>
                )}
            </main>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes fadeInUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                input::placeholder { color: #334155; }
                ::-webkit-scrollbar { width:3px; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius:2px; }
            `}</style>
        </div>
    );
}