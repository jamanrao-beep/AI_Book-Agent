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
    X,
    FileText,
    Languages,
    Hash,
    AlignLeft,
    BookOpen,
    ChevronDown,
    Globe,
    ChevronRight,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SUPPORTED_EXTS = ["pdf", "docx", "zip"];

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
}

interface ProgressState {
    stage: "idle" | "extracting" | "translating" | "structuring" | "assembling" | "done" | "error";
    pct: number;
    message: string;
}

const STAGE_META: Record<string, { label: string; color: string; icon: string }> = {
    idle: { label: "Ready", color: "var(--mist)", icon: "⊙" },
    extracting: { label: "Extracting Files", color: "var(--violet)", icon: "◈" },
    translating: { label: "Translating Content", color: "var(--sapphire)", icon: "✦" },
    structuring: { label: "Structuring Index", color: "var(--amber)", icon: "⚙" },
    assembling: { label: "Assembling Book", color: "var(--emerald)", icon: "📐" },
    done: { label: "Complete", color: "var(--emerald)", icon: "✓" },
    error: { label: "Error", color: "var(--crimson)", icon: "✕" },
};

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
            <label className="field-label" style={{ color: accent, marginBottom: "8px" }}>
                {label}
            </label>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: open ? "var(--void)" : "var(--onyx)",
                    border: `1.5px solid ${open ? accent : "var(--border-mid)"}`,
                    borderRadius: "10px", padding: "11px 16px",
                    color: value ? "var(--text-primary)" : "var(--ash)",
                    fontSize: "13px", fontWeight: value ? "600" : "400",
                    cursor: "pointer", transition: "all 0.2s",
                    fontFamily: "inherit",
                    boxShadow: open ? `0 0 0 3px rgba(37,99,235,0.08)` : "none",
                }}
            >
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Globe size={14} color={value ? accent : "var(--ash)"} />
                    {value || "Select language…"}
                </span>
                <ChevronDown
                    size={14}
                    color="var(--ash)"
                    style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                />
            </button>

            {open && (
                <div className="card" style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 100,
                    background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
                    borderRadius: "12px", overflow: "hidden",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
                }}>
                    <div style={{ padding: "8px 8px 4px" }}>
                        <input
                            autoFocus
                            placeholder="Search languages…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="input-field"
                            style={{
                                padding: "8px 12px", fontSize: "12px", borderRadius: "8px"
                            }}
                        />
                    </div>
                    <div style={{ maxHeight: "200px", overflowY: "auto", padding: "4px" }}>
                        {filtered.map(lang => (
                            <div
                                key={lang}
                                onClick={() => { onChange(lang); setOpen(false); setSearch(""); }}
                                style={{
                                    padding: "8px 12px", fontSize: "13px", cursor: "pointer",
                                    color: lang === value ? accent : "var(--text-primary)",
                                    background: lang === value ? "var(--sapphire-dim)" : "transparent",
                                    fontWeight: lang === value ? "700" : "500",
                                    borderRadius: "6px",
                                    transition: "all 0.15s",
                                }}
                                onMouseOver={e => { if (lang !== value) e.currentTarget.style.background = "var(--surface-hover)"; }}
                                onMouseOut={e => { if (lang !== value) e.currentTarget.style.background = "transparent"; }}
                            >
                                {lang}
                            </div>
                        ))}
                        {filtered.length === 0 && (
                            <div style={{ padding: "16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "12px" }}>
                                No languages match "{search}"
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function TranslatePage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [file, setFile] = useState<File | null>(null);
    const [elapsedSecs, setElapsedSecs] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [sourceLang, setSourceLang] = useState("");
    const [targetLang, setTargetLang] = useState("");
    const [progress, setProgress] = useState<ProgressState>({ stage: "idle", pct: 0, message: "" });
    const [result, setResult] = useState<TranslationResult | null>(null);
    const [error, setError] = useState("");

    const ACCENT = "var(--sapphire)";

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
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 20_000);
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
                    const msg = parseFriendlyError(e);
                    setError(`Lost connection after ${MAX_ERRORS} retries: ${msg}`);
                    setProgress(p => ({ ...p, stage: "error" }));
                }
            }
        }, 3000);
    };

    const handleSubmit = async () => {
        if (!file || !targetLang) return;
        setError("");
        setResult(null);
        setProgress({ stage: "extracting", pct: 2, message: "Reading manuscript sections…" });
        setElapsedSecs(0);

        elapsedRef.current = setInterval(() => {
            setElapsedSecs(s => s + 1);
        }, 1000);

        try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("target_language", targetLang);
            if (sourceLang) fd.append("source_language", sourceLang);

            const res = await fetch(`${API_BASE}/translate`, { method: "POST", body: fd });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || "Translation request rejected.");
            }
            const data = await res.json();
            poll(data.job_id);
        } catch (e: unknown) {
            setError(parseFriendlyError(e));
            setProgress({ stage: "error", pct: 0, message: "" });
            if (elapsedRef.current) clearInterval(elapsedRef.current);
        }
    };

    const clearSession = () => {
        setResult(null);
        setFile(null);
        setSourceLang("");
        setTargetLang("");
        setError("");
        setProgress({ stage: "idle", pct: 0, message: "" });
        if (pollRef.current) clearInterval(pollRef.current);
        if (elapsedRef.current) clearInterval(elapsedRef.current);
    };

    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
            if (elapsedRef.current) clearInterval(elapsedRef.current);
        };
    }, []);

    const stageMeta = STAGE_META[progress.stage] || STAGE_META.idle;
    const formatTime = (totalSeconds: number) => {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    };

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
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <div style={{ width: "28px", height: "28px", background: "var(--text-primary)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Languages size={14} color="var(--void)" />
                    </div>
                    <span style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>Book Translator</span>
                </div>
            </nav>

            <main style={{ maxWidth: "880px", margin: "0 auto", padding: "64px 32px 96px", position: "relative", zIndex: 2 }}>
                
                {/* Header */}
                <div style={{ marginBottom: "40px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "20px", padding: "4px 14px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", color: "var(--sapphire)", marginBottom: "16px", boxShadow: "0 4px 10px rgba(0,0,0,0.02)" }}>
                        <Sparkles size={10} /> MULTILINGUAL TRANSLATION AGENT
                    </div>
                    <h1 className="serif" style={{ fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em", marginBottom: "10px", color: "var(--text-primary)" }}>
                        Translate Your Book
                    </h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.6" }}>
                        Preserve full document layouts, markdown styles, and chapter structures automatically. AI translates manuscripts into 100+ languages sequentially.
                    </p>
                </div>

                {!result ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "28px", alignItems: "start" }}>
                        
                        {/* Left panel: upload */}
                        <div>
                            <div
                                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => !file && fileInputRef.current?.click()}
                                style={{
                                    border: `2px dashed ${dragging ? "var(--sapphire)" : file ? "rgba(37,99,235,0.4)" : "var(--border-strong)"}`,
                                    borderRadius: "20px", padding: "48px 32px",
                                    background: dragging ? "rgba(37, 99, 235, 0.05)" : file ? "rgba(37, 99, 235, 0.02)" : "var(--onyx)",
                                    cursor: file ? "default" : "pointer", textAlign: "center",
                                    transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)", marginBottom: "20px",
                                }}
                            >
                                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.zip" style={{ display: "none" }}
                                    onChange={e => e.target.files?.[0] && addFile(e.target.files[0])} />

                                {file ? (
                                    <div>
                                        <div style={{ width: "56px", height: "56px", margin: "0 auto 16px", background: "var(--void)", border: "1.5px solid var(--border-mid)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <FileText size={22} color="var(--sapphire)" />
                                        </div>
                                        <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "4px", color: "var(--text-primary)" }}>{file.name}</p>
                                        <p style={{ color: "var(--text-tertiary)", fontSize: "12px", marginBottom: "12px" }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                        <button onClick={e => { e.stopPropagation(); setFile(null); }} className="btn-ghost" style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "8px", background: "rgba(239,68,68,0.05)", color: "var(--crimson)", border: "none" }}>
                                            Remove file
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{ width: "56px", height: "56px", margin: "0 auto 16px", background: "var(--void)", border: "1.5px solid var(--border-mid)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <Upload size={22} color="var(--sapphire)" />
                                        </div>
                                        <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "6px", color: "var(--text-primary)" }}>Drop book file here</p>
                                        <p style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>PDF, DOCX, ZIP · max 150 MB</p>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: "10px", padding: "12px 16px", color: "var(--crimson)", fontSize: "13px", marginBottom: "16px" }}>
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* Right panel: options + progress */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            <LanguageSelect label="Source Language (Optional)" value={sourceLang} onChange={setSourceLang} accent={ACCENT} />
                            <LanguageSelect label="Target Language" value={targetLang} onChange={setTargetLang} accent={ACCENT} />

                            {isLoading && (
                                <div className="card pulse-glow" style={{ background: "var(--onyx)", border: "1.5px solid rgba(37,99,235,0.25)", borderRadius: "14px", padding: "20px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                                        <Loader size={16} style={{ color: "var(--sapphire)", animation: "spin 1.2s linear infinite" }} />
                                        <div style={{ flex: 1 }}>
                                            <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>{stageMeta.label}</span>
                                            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>{progress.message}</p>
                                        </div>
                                        <span className="serif" style={{ fontSize: "22px", color: "var(--text-primary)" }}>{progress.pct}%</span>
                                    </div>
                                    <div className="progress-bar">
                                        <div className="progress-fill" style={{ width: `${progress.pct}%`, background: "var(--sapphire)" }} />
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px", fontSize: "11px", color: "var(--text-tertiary)" }}>
                                        <span>Elapsed: {formatTime(elapsedSecs)}</span>
                                        <span>Processing blocks...</span>
                                    </div>
                                </div>
                            )}

                            <button onClick={handleSubmit} disabled={!file || !targetLang || isLoading} className="btn-dark" style={{
                                justifyContent: "center", padding: "13px 24px", fontSize: "14px", borderRadius: "12px",
                                background: !file || !targetLang || isLoading ? "rgba(0,0,0,0.04)" : "var(--text-primary)",
                                color: !file || !targetLang || isLoading ? "var(--ash)" : "var(--void)", border: "none",
                                opacity: !file || !targetLang || isLoading ? 0.6 : 1,
                            }}>
                                {isLoading ? (
                                    <><Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> Translating manuscript…</>
                                ) : (
                                    <><Languages size={16} /> Translate Document</>
                                )}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Results panel */
                    <div style={{ animation: "fadeInUp 0.4s ease" }}>
                        <div className="card" style={{ display: "flex", alignItems: "center", gap: "16px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "20px 24px", marginBottom: "28px" }}>
                            <div style={{ width: "44px", height: "44px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <CheckCircle size={22} color="var(--emerald)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <h3 className="serif" style={{ fontSize: "20px", color: "var(--text-primary)" }}>{result.title}</h3>
                                <p style={{ color: "var(--text-secondary)", fontSize: "12px", marginTop: "4px" }}>
                                    Translated successfully from {result.source_language || "Detect"} into {result.target_language}
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                                <a href={`${API_BASE}/translate/${result.job_id}/download/pdf`} target="_blank" rel="noopener noreferrer" className="btn-dark" style={{ padding: "10px 18px", fontSize: "13px", borderRadius: "10px", textDecoration: "none" }}>
                                    <Download size={13} /> PDF
                                </a>
                                <a href={`${API_BASE}/translate/${result.job_id}/download/docx`} target="_blank" rel="noopener noreferrer" className="btn-outline" style={{ padding: "9px 18px", fontSize: "13px", borderRadius: "10px", textDecoration: "none" }}>
                                    <Download size={13} /> DOCX
                                </a>
                            </div>
                        </div>

                        {/* Stats grid */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "32px" }}>
                            {[
                                { icon: <Languages size={16} color="var(--sapphire)" />, label: "Languages", value: `${result.source_language || "Detect"} → ${result.target_language}` },
                                { icon: <AlignLeft size={16} color="var(--sapphire)" />, label: "Translated Words", value: result.total_words.toLocaleString() },
                                { icon: <BookOpen size={16} color="var(--sapphire)" />, label: "Total Chapters", value: result.chapters.toString() },
                            ].map(s => (
                                <div key={s.label} className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", padding: "20px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                                        {s.icon}
                                        <span className="field-label" style={{ margin: 0 }}>{s.label}</span>
                                    </div>
                                    <div className="serif" style={{ fontSize: "22px", color: "var(--text-primary)" }}>{s.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Chapters list */}
                        {result.chapter_titles.length > 0 && (
                            <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", padding: "24px", marginBottom: "32px" }}>
                                <p className="field-label" style={{ color: "var(--sapphire)", marginBottom: "16px" }}>Translated Chapters ({result.chapters})</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {result.chapter_titles.map((title, i) => (
                                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", background: "var(--void)", border: "1px solid var(--border-mid)", borderRadius: "10px" }}>
                                            <span style={{ width: "24px", height: "24px", borderRadius: "6px", background: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "var(--void)", flexShrink: 0 }}>{i + 1}</span>
                                            <span style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: "600", flex: 1 }}>{title}</span>
                                            <ChevronRight size={13} color="var(--text-tertiary)" style={{ opacity: 0.6 }} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button onClick={clearSession} className="btn-outline" style={{ padding: "10px 20px", fontSize: "13px" }}>
                            ← Translate another book
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}
