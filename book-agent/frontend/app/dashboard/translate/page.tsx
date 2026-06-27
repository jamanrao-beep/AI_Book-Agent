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
    FileText,
    Languages,
    Hash,
    AlignLeft,
    BookOpen,
    ChevronDown,
    Globe,
    ArrowRight,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SUPPORTED_EXTS = ["pdf", "docx", "zip"];

// ── Language list ─────────────────────────────────────────────────────────────
const LANGUAGES = [
    "Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Azerbaijani",
    "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Catalan",
    "Cebuano", "Chinese (Simplified)", "Chinese (Traditional)", "Corsican",
    "Croatian", "Czech", "Danish", "Dutch", "English", "Esperanto", "Estonian",
    "Filipino", "Finnish", "French", "Frisian", "Galician", "Georgian", "German",
    "Greek", "Gujarati", "Haitian Creole", "Hausa", "Hawaiian", "Hebrew", "Hindi",
    "Hmong", "Hungarian", "Icelandic", "Igbo", "Indonesian", "Irish", "Italian",
    "Japanese", "Javanese", "Kannada", "Kazakh", "Khmer", "Kinyarwanda", "Korean",
    "Kurdish", "Kyrgyz", "Lao", "Latin", "Latvian", "Lithuanian", "Luxembourgish",
    "Macedonian", "Malagasy", "Malay", "Malayalam", "Maltese", "Maori", "Marathi",
    "Mongolian", "Myanmar (Burmese)", "Nepali", "Norwegian", "Nyanja (Chichewa)",
    "Odia (Oriya)", "Pashto", "Persian", "Polish", "Portuguese", "Punjabi",
    "Romanian", "Russian", "Samoan", "Scots Gaelic", "Serbian", "Sesotho",
    "Shona", "Sindhi", "Sinhala", "Slovak", "Slovenian", "Somali", "Spanish",
    "Sundanese", "Swahili", "Swedish", "Tagalog", "Tajik", "Tamil", "Tatar",
    "Telugu", "Thai", "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uyghur",
    "Uzbek", "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu",
];

interface TranslationResult {
    job_id: string;
    title: string;
    source_language: string;
    target_language: string;
    total_words: number;
    chapters: number;
    chapter_titles: string[];
    // pdf_url and docx_url are not used — downloads are constructed from job_id
}

interface ProgressState {
    stage: "idle" | "extracting" | "translating" | "structuring" | "assembling" | "done" | "error";
    pct: number;
    message: string;
}

const STAGE_META: Record<string, { label: string; color: string; icon: string }> = {
    idle: { label: "Ready", color: "#94a3b8", icon: "⊙" },
    extracting: { label: "Extracting", color: "#38bdf8", icon: "◈" },
    translating: { label: "Translating", color: "#818cf8", icon: "✦" },
    structuring: { label: "Structuring", color: "#f59e0b", icon: "⚙" },
    assembling: { label: "Assembling", color: "#fb923c", icon: "📐" },
    done: { label: "Complete", color: "#34d399", icon: "✓" },
    error: { label: "Error", color: "#f87171", icon: "✕" },
};

// ── Language Selector ─────────────────────────────────────────────────────────
function LanguageSelect({
    value,
    onChange,
    label,
    accent,
}: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    accent: string;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const filtered = LANGUAGES.filter(l => l.toLowerCase().includes(search.toLowerCase()));
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
                setSearch("");
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    return (
        <div ref={wrapRef} style={{ position: "relative" }}>
            <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", marginBottom: "8px" }}>
                {label}
            </p>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: open ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${open ? accent + "55" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: "10px", padding: "11px 14px",
                    color: value ? "#e2e8f0" : "#475569", fontSize: "13px", fontWeight: value ? "600" : "400",
                    cursor: "pointer", transition: "all 0.2s",
                    boxShadow: open ? `0 0 0 3px ${accent}18` : "none",
                }}
            >
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Globe size={14} color={value ? accent : "#475569"} />
                    {value || "Select language…"}
                </span>
                <ChevronDown size={14} color="#475569" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>

            {open && (
                <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 100,
                    background: "#13172a", border: `1px solid ${accent}33`,
                    borderRadius: "12px", overflow: "hidden",
                    boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px ${accent}22`,
                }}>
                    <div style={{ padding: "10px 10px 6px" }}>
                        <input
                            autoFocus
                            placeholder="Search languages…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{
                                width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "8px", padding: "8px 12px", color: "#e2e8f0", fontSize: "12px",
                                outline: "none", boxSizing: "border-box",
                            }}
                        />
                    </div>
                    <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                        {filtered.map(lang => (
                            <div
                                key={lang}
                                onClick={() => { onChange(lang); setOpen(false); setSearch(""); }}
                                style={{
                                    padding: "9px 14px", fontSize: "13px", cursor: "pointer",
                                    color: lang === value ? accent : "#94a3b8",
                                    background: lang === value ? `${accent}12` : "transparent",
                                    fontWeight: lang === value ? "600" : "400",
                                    transition: "all 0.1s",
                                }}
                                onMouseOver={e => { if (lang !== value) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"; }}
                                onMouseOut={e => { if (lang !== value) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                            >
                                {lang}
                            </div>
                        ))}
                        {filtered.length === 0 && (
                            <div style={{ padding: "16px", textAlign: "center", color: "#334155", fontSize: "12px" }}>
                                No languages match "{search}"
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TranslatePage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [file, setFile] = useState<File | null>(null);
    const [elapsedSecs, setElapsedSecs] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [sourceLang, setSourceLang] = useState(""); // empty = auto-detect
    const [targetLang, setTargetLang] = useState("");
    const [progress, setProgress] = useState<ProgressState>({ stage: "idle", pct: 0, message: "" });
    const [result, setResult] = useState<TranslationResult | null>(null);
    const [error, setError] = useState("");

    const ACCENT = "#38bdf8";      // sky-400 — distinct from other features

    const isLoading = ["extracting", "translating", "structuring", "assembling"].includes(progress.stage);

    const addFile = (f: File) => {
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        if (!SUPPORTED_EXTS.includes(ext)) {
            setError("Unsupported file type. Please upload a PDF, DOCX, or ZIP.");
            return;
        }
        setError("");
        setFile(f);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files[0]) addFile(e.dataTransfer.files[0]);
    };

    const poll = (jobId: string) => {
        let consecutiveErrors = 0;
        const MAX_ERRORS = 8;
        pollRef.current = setInterval(async () => {
            // T-10: per-poll AbortController so a dropped Railway response
            // doesn't create accumulating inflight requests over time.
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 20_000); // 20s per poll
            try {
                const r = await fetch(`${API_BASE}/translate/${jobId}/status`, { signal: ctrl.signal });
                clearTimeout(timer);
                if (!r.ok) return;
                consecutiveErrors = 0;
                const data = await r.json();
                setProgress({ stage: data.stage, pct: data.pct, message: data.message });
                if (data.stage === "done") {
                    clearInterval(pollRef.current!);
                    if (elapsedRef.current) clearInterval(elapsedRef.current);
                    setResult(data.result);
                }
                if (data.stage === "error") {
                    clearInterval(pollRef.current!);
                    if (elapsedRef.current) clearInterval(elapsedRef.current);
                    setError(data.message || "Translation failed.");
                }
            } catch (e: unknown) {
                clearTimeout(timer);
                consecutiveErrors++;
                if (consecutiveErrors >= MAX_ERRORS) {
                    clearInterval(pollRef.current!);
                    const msg = e instanceof Error ? e.message : "Network error";
                    setError(`Lost connection after ${MAX_ERRORS} retries: ${msg}`);
                    setProgress(p => ({ ...p, stage: "error" }));
                }
                // else: transient drop — keep polling
            }
        }, 3000); // 3s interval (was 1.5s — reduces request accumulation)
    };

    const handleSubmit = async () => {
        if (!file || !targetLang) return;
        setError("");
        setResult(null);
        setProgress({ stage: "extracting", pct: 5, message: "Uploading file…" });

        // TR-11: AbortController on the upload POST — Railway can silently drop
        // the response for large files; without a timeout fetch hangs forever.
        const uploadCtrl = new AbortController();
        const uploadTimer = setTimeout(() => uploadCtrl.abort(), 120_000); // 2 min upload limit
        try {
            const form = new FormData();
            form.append("file", file);
            form.append("target_language", targetLang);
            if (sourceLang) form.append("source_language", sourceLang);

            const res = await fetch(`${API_BASE}/translate`, {
                method: "POST",
                body: form,
                signal: uploadCtrl.signal,
            });
            clearTimeout(uploadTimer);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `Server error ${res.status}`);
            }
            const data = await res.json();
            // F-10: set initial state from what backend reports; poll will drive stage changes
            setProgress({ stage: "extracting", pct: 5, message: "Translation pipeline started…" });
            // F-11: start elapsed time counter
            setElapsedSecs(0);
            if (elapsedRef.current) clearInterval(elapsedRef.current);
            elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
            poll(data.job_id);
        } catch (e: unknown) {
            clearTimeout(uploadTimer);
            const msg = e instanceof Error ? e.message : "Unknown error";
            setError(msg);
            setProgress({ stage: "error", pct: 0, message: msg });
        }
    };

    const reset = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        if (elapsedRef.current) clearInterval(elapsedRef.current);
        setElapsedSecs(0);
        setFile(null);
        setSourceLang("");
        setTargetLang("");
        setResult(null);
        setError("");
        setProgress({ stage: "idle", pct: 0, message: "" });
    };

    const stageMeta = STAGE_META[progress.stage] || STAGE_META.idle;

    return (
        <div style={{ minHeight: "100vh", background: "#0c0f1a", fontFamily: "'DM Sans', sans-serif", color: "#e2e8f0" }}>

            {/* Nav */}
            <nav style={{
                borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 40px", height: "60px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                position: "sticky", top: 0, background: "rgba(12,15,26,0.95)", backdropFilter: "blur(12px)", zIndex: 50,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <FileText size={16} color="white" />
                    </div>
                    <span style={{ fontWeight: "700", fontSize: "15px", letterSpacing: "-0.01em" }}>Publixo AI</span>
                </div>
                <button
                    onClick={() => router.push("/dashboard")}
                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 14px", color: "#94a3b8", fontSize: "13px", cursor: "pointer", transition: "all 0.2s" }}
                    onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.2)"; }}
                    onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)"; }}
                >
                    <ArrowLeft size={14} /> Dashboard
                </button>
            </nav>

            <main style={{ maxWidth: "780px", margin: "0 auto", padding: "56px 40px" }}>

                {/* Header */}
                <div style={{ marginBottom: "44px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)", borderRadius: "20px", padding: "4px 14px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: ACCENT, marginBottom: "18px" }}>
                        <Sparkles size={11} /> AI TRANSLATOR
                    </div>
                    <h1 style={{ fontSize: "38px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'Playfair Display', serif", lineHeight: "1.1", marginBottom: "10px" }}>
                        Book Translator
                    </h1>
                    <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6" }}>
                        Upload any book in PDF, DOCX, or ZIP — AI translates every chapter and delivers a clean, structured export in your target language.
                    </p>
                </div>

                {!result ? (
                    /* ── Upload & Config panel ── */
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

                        {/* Drop zone */}
                        <div
                            onDragOver={e => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => !file && fileInputRef.current?.click()}
                            style={{
                                background: dragging ? "rgba(56,189,248,0.06)" : "rgba(255,255,255,0.02)",
                                border: `1.5px dashed ${dragging ? ACCENT : file ? ACCENT + "66" : "rgba(255,255,255,0.1)"}`,
                                borderRadius: "16px", padding: file ? "20px 24px" : "48px 24px",
                                cursor: file ? "default" : "pointer",
                                transition: "all 0.2s",
                                boxShadow: dragging ? `0 0 0 4px ${ACCENT}14` : "none",
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.docx,.zip"
                                style={{ display: "none" }}
                                onChange={e => { if (e.target.files?.[0]) addFile(e.target.files[0]); }}
                            />

                            {!file ? (
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ width: "52px", height: "52px", background: `${ACCENT}14`, border: `1px solid ${ACCENT}33`, borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                                        <Upload size={22} color={ACCENT} />
                                    </div>
                                    <p style={{ fontSize: "14px", fontWeight: "600", marginBottom: "6px" }}>
                                        Drop your book here, or <span style={{ color: ACCENT }}>browse</span>
                                    </p>
                                    <p style={{ fontSize: "12px", color: "#475569" }}>PDF · DOCX · ZIP — up to 150 MB</p>
                                </div>
                            ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                                    <div style={{ width: "44px", height: "44px", background: `${ACCENT}14`, border: `1px solid ${ACCENT}33`, borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                        <BookOpen size={20} color={ACCENT} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ fontWeight: "600", fontSize: "13px", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</p>
                                        <p style={{ fontSize: "11px", color: "#475569" }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); setFile(null); setError(""); }}
                                        style={{ width: "28px", height: "28px", borderRadius: "7px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                                        <X size={13} color="#f87171" />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Language selectors */}
                        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", padding: "24px" }}>
                            <p style={{ fontSize: "13px", fontWeight: "600", marginBottom: "20px", color: "#94a3b8" }}>Translation Settings</p>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "16px", alignItems: "end" }}>
                                <LanguageSelect value={sourceLang} onChange={setSourceLang} label="From (leave blank to auto-detect)" accent={ACCENT} />
                                <div style={{ paddingBottom: "2px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: `${ACCENT}14`, border: `1px solid ${ACCENT}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        <ArrowRight size={16} color={ACCENT} />
                                    </div>
                                </div>
                                <LanguageSelect value={targetLang} onChange={setTargetLang} label="To (required)" accent={ACCENT} />
                            </div>

                            {sourceLang && targetLang && (
                                <div style={{ marginTop: "16px", padding: "10px 14px", background: `${ACCENT}0c`, border: `1px solid ${ACCENT}22`, borderRadius: "9px", fontSize: "12px", color: ACCENT, display: "flex", alignItems: "center", gap: "8px" }}>
                                    <Languages size={13} />
                                    Translating <strong>{sourceLang}</strong> → <strong>{targetLang}</strong>
                                </div>
                            )}
                            {!sourceLang && targetLang && (
                                <div style={{ marginTop: "16px", padding: "10px 14px", background: `${ACCENT}0c`, border: `1px solid ${ACCENT}22`, borderRadius: "9px", fontSize: "12px", color: ACCENT, display: "flex", alignItems: "center", gap: "8px" }}>
                                    <Sparkles size={13} />
                                    Source language will be <strong>auto-detected</strong> → <strong>{targetLang}</strong>
                                </div>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "10px", padding: "12px 16px", fontSize: "13px", color: "#f87171", display: "flex", alignItems: "flex-start", gap: "10px" }}>
                                <X size={15} style={{ flexShrink: 0, marginTop: "1px" }} /> {error}
                            </div>
                        )}

                        {/* Progress bar */}
                        {isLoading && (
                            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "18px 20px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                                    <Loader size={15} style={{ color: stageMeta.color, animation: "spin 1.2s linear infinite", flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: "13px", fontWeight: "600", color: stageMeta.color }}>{stageMeta.label}</p>
                                        <p style={{ fontSize: "11px", color: "#334155", marginTop: "2px" }}>{progress.message}</p>
                                    </div>
                                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "20px", fontWeight: "700", color: stageMeta.color }}>{progress.pct}%</span>
                                </div>
                                <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "3px", overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${progress.pct}%`, background: `linear-gradient(90deg, #38bdf8, ${stageMeta.color})`, borderRadius: "3px", transition: "width 0.8s ease", boxShadow: `0 0 8px ${stageMeta.color}66` }} />
                                </div>
                                <p style={{ fontSize: "11px", color: "#334155", marginTop: "10px" }}>
                                    {elapsedSecs > 0
                                        ? `${elapsedSecs >= 60 ? `${Math.floor(elapsedSecs / 60)}m ${elapsedSecs % 60}s` : `${elapsedSecs}s`} elapsed — large books take 10–40 min, please keep this tab open.`
                                        : "Large books can take 10–40 min — please keep this tab open."}
                                </p>
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            onClick={handleSubmit}
                            disabled={!file || !targetLang || isLoading}
                            style={{
                                background: !file || !targetLang || isLoading ? "rgba(56,189,248,0.2)" : `linear-gradient(135deg, #0ea5e9, #38bdf8)`,
                                border: "none", borderRadius: "12px", padding: "14px 24px",
                                color: !file || !targetLang || isLoading ? "rgba(56,189,248,0.5)" : "white",
                                fontSize: "14px", fontWeight: "700",
                                cursor: !file || !targetLang || isLoading ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                                boxShadow: file && targetLang && !isLoading ? "0 4px 20px rgba(56,189,248,0.35)" : "none",
                                transition: "all 0.2s", letterSpacing: "0.01em",
                            }}
                        >
                            {isLoading ? (
                                <><Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> Translating…</>
                            ) : (
                                <><Languages size={16} /> Translate Book</>
                            )}
                        </button>
                    </div>

                ) : (
                    /* ── Results ── */
                    <div style={{ animation: "fadeInUp 0.4s ease" }}>

                        {/* Success banner */}
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)", borderRadius: "14px", padding: "18px 22px", marginBottom: "28px" }}>
                            <div style={{ width: "44px", height: "44px", background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <CheckCircle size={22} color={ACCENT} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <p style={{ fontWeight: "700", fontSize: "16px", letterSpacing: "-0.01em" }}>{result.title}</p>
                                <p style={{ color: "#64748b", fontSize: "12px", marginTop: "3px" }}>
                                    Translation complete · {result.source_language} → {result.target_language}
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                                <a
                                    href={`${API_BASE}/translate/${result.job_id}/download/pdf`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "9px", padding: "9px 16px", color: "#f87171", fontSize: "13px", fontWeight: "600", textDecoration: "none", transition: "all 0.15s" }}
                                    onMouseOver={e => { e.currentTarget.style.background = "rgba(248,113,113,0.22)"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "rgba(248,113,113,0.12)"; }}
                                >
                                    <Download size={13} /> PDF
                                </a>
                                <a
                                    href={`${API_BASE}/translate/${result.job_id}/download/docx`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: "9px", padding: "9px 16px", color: "#60a5fa", fontSize: "13px", fontWeight: "600", textDecoration: "none", transition: "all 0.15s" }}
                                    onMouseOver={e => { e.currentTarget.style.background = "rgba(96,165,250,0.22)"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "rgba(96,165,250,0.12)"; }}
                                >
                                    <Download size={13} /> DOCX
                                </a>
                            </div>
                        </div>

                        {/* Stats */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
                            {[
                                { icon: <Globe size={16} color={ACCENT} />, label: "Source", value: result.source_language, color: ACCENT, bg: "rgba(56,189,248,0.08)" },
                                { icon: <Languages size={16} color="#818cf8" />, label: "Target", value: result.target_language, color: "#818cf8", bg: "rgba(99,102,241,0.08)" },
                                { icon: <AlignLeft size={16} color="#34d399" />, label: "Words", value: result.total_words.toLocaleString(), color: "#34d399", bg: "rgba(52,211,153,0.08)" },
                                { icon: <BookOpen size={16} color="#f59e0b" />, label: "Chapters", value: result.chapters.toString(), color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
                            ].map(s => (
                                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.color}25`, borderRadius: "12px", padding: "16px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "8px" }}>
                                        {s.icon}
                                        <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.07em", textTransform: "uppercase", color: "#334155" }}>{s.label}</span>
                                    </div>
                                    <div style={{ fontSize: "16px", fontWeight: "700", color: s.color, letterSpacing: "-0.01em", fontFamily: "'Playfair Display', serif" }}>
                                        {s.value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Chapter list */}
                        {result.chapter_titles.length > 0 && (
                            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "20px", marginBottom: "24px" }}>
                                <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#334155", marginBottom: "14px" }}>
                                    Translated Chapters ({result.chapters})
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    {result.chapter_titles.map((title, i) => (
                                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                                            <span style={{ width: "24px", height: "24px", borderRadius: "6px", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: ACCENT, flexShrink: 0 }}>
                                                {i + 1}
                                            </span>
                                            <span style={{ fontSize: "13px", color: "#94a3b8", flex: 1 }}>{title}</span>
                                            <Hash size={12} color="#334155" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={reset}
                            style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "10px 20px", color: "#64748b", fontSize: "13px", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseOver={e => (e.currentTarget.style.color = "#e2e8f0")}
                            onMouseOut={e => (e.currentTarget.style.color = "#64748b")}
                        >
                            ← Translate another book
                        </button>
                    </div>
                )}
            </main>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes fadeInUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                input::placeholder { color: #334155; }
                ::-webkit-scrollbar { width: 3px; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
            `}</style>
        </div>
    );
}