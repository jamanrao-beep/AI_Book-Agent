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
    ArrowRight,
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
    idle: { label: "Ready", color: "#888", icon: "⊙" },
    extracting: { label: "Extracting", color: "#0369a1", icon: "◈" },
    translating: { label: "Translating", color: "#2563eb", icon: "✦" },
    structuring: { label: "Structuring", color: "#92400e", icon: "⚙" },
    assembling: { label: "Assembling", color: "#c2410c", icon: "📐" },
    done: { label: "Complete", color: "#047857", icon: "✓" },
    error: { label: "Error", color: "#b91c1c", icon: "✕" },
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
            <p style={{
                fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em",
                textTransform: "uppercase", color: "#0c43bb", marginBottom: "8px",
            }}>
                {label}
            </p>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: open ? "#f7f2e4" : "white",
                    border: `1px solid ${open ? accent : "#e8e8e4"}`,
                    borderRadius: "8px", padding: "11px 14px",
                    color: value ? "#2b2b2b" : "#888",
                    fontSize: "13px", fontWeight: value ? "600" : "400",
                    cursor: "pointer", transition: "all 0.15s",
                    fontFamily: "'DM Sans', sans-serif",
                    boxShadow: open ? `0 0 0 3px ${accent}18` : "none",
                }}
            >
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Globe size={14} color={value ? accent : "#888"} />
                    {value || "Select language…"}
                </span>
                <ChevronDown
                    size={14}
                    color="#888"
                    style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                />
            </button>

            {open && (
                <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 100,
                    background: "white", border: "1px solid #e8e8e4",
                    borderRadius: "10px", overflow: "hidden",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                }}>
                    <div style={{ padding: "10px 10px 6px" }}>
                        <input
                            autoFocus
                            placeholder="Search languages…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{
                                width: "100%", background: "#f7f2e4", border: "1px solid #e8e8e4",
                                borderRadius: "7px", padding: "8px 12px", color: "#2b2b2b", fontSize: "12px",
                                outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif",
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
                                    color: lang === value ? accent : "#2b2b2b",
                                    background: lang === value ? `${accent}12` : "transparent",
                                    fontWeight: lang === value ? "600" : "400",
                                    transition: "all 0.1s",
                                }}
                                onMouseOver={e => { if (lang !== value) (e.currentTarget as HTMLDivElement).style.background = "#f7f2e4"; }}
                                onMouseOut={e => { if (lang !== value) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                            >
                                {lang}
                            </div>
                        ))}
                        {filtered.length === 0 && (
                            <div style={{ padding: "16px", textAlign: "center", color: "#888", fontSize: "12px" }}>
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

    const ACCENT = "#2563eb";

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
        setProgress({ stage: "extracting", pct: 5, message: "Uploading file…" });

        const uploadCtrl = new AbortController();
        const uploadTimer = setTimeout(() => uploadCtrl.abort(), 120_000);
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
            setProgress({ stage: "extracting", pct: 5, message: "Translation pipeline started…" });
            setElapsedSecs(0);
            if (elapsedRef.current) clearInterval(elapsedRef.current);
            elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
            poll(data.job_id);
        } catch (e: unknown) {
            clearTimeout(uploadTimer);
            const msg = parseFriendlyError(e);
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
        <div style={{
            minHeight: "100vh",
            background: "#f7f2e4",
            fontFamily: "'DM Sans', sans-serif",
            color: "#2b2b2b",
        }}>

            {/* Nav */}
            <nav style={{
                borderBottom: "1px solid #efefcf",
                padding: "0 40px", height: "56px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                position: "sticky", top: 0, background: "white", zIndex: 50,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                        width: "28px", height: "28px", background: "#1a1a1a",
                        borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <FileText size={14} color="white" />
                    </div>
                    <span style={{ fontWeight: "700", fontSize: "15px", color: "#2a2929", letterSpacing: "-0.01em" }}>
                        Publixo AI
                    </span>
                </div>
                <button
                    onClick={() => router.push("/dashboard")}
                    style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        background: "none", border: "1px solid #e8e8e4",
                        borderRadius: "7px", padding: "6px 14px",
                        color: "#555", fontSize: "13px", cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif", fontWeight: "500",
                        transition: "all 0.15s",
                    }}
                    onMouseOver={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = "#f7f2e4";
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "#d0d0cc";
                    }}
                    onMouseOut={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = "none";
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "#e8e8e4";
                    }}
                >
                    <ArrowLeft size={14} /> Dashboard
                </button>
            </nav>

            <main style={{ maxWidth: "780px", margin: "0 auto", padding: "56px 40px" }}>

                {/* Header */}
                <div style={{ marginBottom: "44px" }}>
                    <div style={{
                        display: "inline-flex", alignItems: "center", gap: "6px",
                        background: "white", border: "1px solid #e8e8e4",
                        borderRadius: "20px", padding: "4px 14px",
                        fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em",
                        color: ACCENT, marginBottom: "18px",
                    }}>
                        <Sparkles size={11} /> AI TRANSLATOR
                    </div>
                    <h1 style={{
                        fontSize: "42px", fontWeight: "800", letterSpacing: "-0.03em",
                        fontFamily: "'Playfair Display', serif", lineHeight: "1.1",
                        marginBottom: "10px", color: "#2d2c2c",
                    }}>
                        Book Translator
                    </h1>
                    <p style={{ color: "#666", fontSize: "15px", lineHeight: "1.6" }}>
                        Upload any book in PDF, DOCX, or ZIP — AI translates every chapter and delivers a clean, structured export in your target language.
                    </p>
                </div>

                {!result ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

                        {/* Drop zone */}
                        <div
                            onDragOver={e => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => !file && fileInputRef.current?.click()}
                            style={{
                                background: dragging ? `${ACCENT}08` : "white",
                                border: `1.5px dashed ${dragging ? ACCENT : file ? ACCENT + "66" : "#d0d0cc"}`,
                                borderRadius: "12px",
                                padding: file ? "20px 24px" : "48px 24px",
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
                                    <div style={{
                                        width: "48px", height: "48px",
                                        background: "#f7f2e4", border: "1px solid #e8e8e4",
                                        borderRadius: "12px", display: "flex", alignItems: "center",
                                        justifyContent: "center", margin: "0 auto 16px",
                                    }}>
                                        <Upload size={20} color={ACCENT} />
                                    </div>
                                    <p style={{ fontSize: "14px", fontWeight: "600", marginBottom: "6px", color: "#2b2b2b" }}>
                                        Drop your book here, or <span style={{ color: ACCENT }}>browse</span>
                                    </p>
                                    <p style={{ fontSize: "12px", color: "#888" }}>PDF · DOCX · ZIP — up to 150 MB</p>
                                </div>
                            ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                                    <div style={{
                                        width: "44px", height: "44px", background: "#f7f2e4",
                                        border: "1px solid #e8e8e4", borderRadius: "10px",
                                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                                    }}>
                                        <BookOpen size={20} color={ACCENT} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ fontWeight: "600", fontSize: "13px", marginBottom: "2px", color: "#2b2b2b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {file.name}
                                        </p>
                                        <p style={{ fontSize: "11px", color: "#888" }}>
                                            {(file.size / 1024 / 1024).toFixed(2)} MB
                                        </p>
                                    </div>
                                    <button
                                        onClick={e => { e.stopPropagation(); setFile(null); setError(""); }}
                                        style={{
                                            width: "28px", height: "28px", borderRadius: "7px",
                                            background: "#fff0f0", border: "1px solid #fcd5d5",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            cursor: "pointer", flexShrink: 0,
                                        }}
                                    >
                                        <X size={13} color="#b91c1c" />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Language selectors */}
                        <div style={{
                            background: "white", border: "1px solid #e8e8e4",
                            borderRadius: "12px", padding: "24px",
                        }}>
                            <p style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", color: "#0c43bb", marginBottom: "20px" }}>
                                Translation Settings
                            </p>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "16px", alignItems: "end" }}>
                                <LanguageSelect value={sourceLang} onChange={setSourceLang} label="From (leave blank to auto-detect)" accent={ACCENT} />
                                <div style={{ paddingBottom: "2px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                                    <div style={{
                                        width: "36px", height: "36px", borderRadius: "50%",
                                        background: "#f7f2e4", border: "1px solid #e8e8e4",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <ArrowRight size={16} color={ACCENT} />
                                    </div>
                                </div>
                                <LanguageSelect value={targetLang} onChange={setTargetLang} label="To (required)" accent={ACCENT} />
                            </div>

                            {sourceLang && targetLang && (
                                <div style={{
                                    marginTop: "16px", padding: "10px 14px",
                                    background: `${ACCENT}08`, border: `1px solid ${ACCENT}25`,
                                    borderRadius: "8px", fontSize: "12px", color: ACCENT,
                                    display: "flex", alignItems: "center", gap: "8px",
                                }}>
                                    <Languages size={13} />
                                    Translating <strong>{sourceLang}</strong> → <strong>{targetLang}</strong>
                                </div>
                            )}
                            {!sourceLang && targetLang && (
                                <div style={{
                                    marginTop: "16px", padding: "10px 14px",
                                    background: `${ACCENT}08`, border: `1px solid ${ACCENT}25`,
                                    borderRadius: "8px", fontSize: "12px", color: ACCENT,
                                    display: "flex", alignItems: "center", gap: "8px",
                                }}>
                                    <Sparkles size={13} />
                                    Source language will be <strong>auto-detected</strong> → <strong>{targetLang}</strong>
                                </div>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{
                                background: "#fff0f0", border: "1px solid #fcd5d5",
                                borderRadius: "10px", padding: "12px 16px",
                                fontSize: "13px", color: "#b91c1c",
                                display: "flex", alignItems: "flex-start", gap: "10px",
                            }}>
                                <X size={15} style={{ flexShrink: 0, marginTop: "1px" }} /> {error}
                            </div>
                        )}

                        {/* Progress */}
                        {isLoading && (
                            <div style={{
                                background: "white", border: "1px solid #e8e8e4",
                                borderRadius: "12px", padding: "18px 20px",
                            }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                                    <Loader size={15} style={{ color: stageMeta.color, animation: "spin 1.2s linear infinite", flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: "13px", fontWeight: "600", color: stageMeta.color }}>{stageMeta.label}</p>
                                        <p style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>{progress.message}</p>
                                    </div>
                                    <span style={{
                                        fontFamily: "'Playfair Display', serif",
                                        fontSize: "22px", fontWeight: "800",
                                        color: "#2b2b2b", letterSpacing: "-0.02em",
                                    }}>
                                        {progress.pct}%
                                    </span>
                                </div>
                                <div style={{ height: "3px", background: "#e8e8e4", borderRadius: "3px", overflow: "hidden" }}>
                                    <div style={{
                                        height: "100%", width: `${progress.pct}%`,
                                        background: `linear-gradient(90deg, ${ACCENT}, ${stageMeta.color})`,
                                        borderRadius: "3px", transition: "width 0.8s ease",
                                    }} />
                                </div>
                                <p style={{ fontSize: "11px", color: "#888", marginTop: "10px" }}>
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
                                background: !file || !targetLang || isLoading ? "#e8e8e4" : "#1a1a1a",
                                border: "none", borderRadius: "10px", padding: "14px 24px",
                                color: !file || !targetLang || isLoading ? "#aaa" : "white",
                                fontSize: "14px", fontWeight: "700",
                                cursor: !file || !targetLang || isLoading ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                                transition: "all 0.2s", letterSpacing: "0.01em",
                                fontFamily: "'DM Sans', sans-serif",
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
                    /* Results */
                    <div style={{ animation: "fadeInUp 0.4s ease" }}>

                        {/* Success banner */}
                        <div style={{
                            display: "flex", alignItems: "center", gap: "14px",
                            background: "white", border: "1px solid #e8e8e4",
                            borderRadius: "12px", padding: "18px 22px", marginBottom: "16px",
                        }}>
                            <div style={{
                                width: "44px", height: "44px", background: "#f7f2e4",
                                border: "1px solid #e8e8e4", borderRadius: "10px",
                                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            }}>
                                <CheckCircle size={22} color="#047857" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <p style={{
                                    fontWeight: "800", fontSize: "16px", letterSpacing: "-0.02em",
                                    color: "#2b2b2b", fontFamily: "'Playfair Display', serif",
                                }}>
                                    {result.title}
                                </p>
                                <p style={{ color: "#888", fontSize: "12px", marginTop: "3px" }}>
                                    Translation complete · {result.source_language} → {result.target_language}
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                                <a
                                    href={`${API_BASE}/translate/${result.job_id}/download/pdf`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{
                                        display: "flex", alignItems: "center", gap: "6px",
                                        background: "#1a1a1a", border: "none",
                                        borderRadius: "8px", padding: "9px 16px",
                                        color: "white", fontSize: "13px", fontWeight: "600",
                                        textDecoration: "none", transition: "all 0.15s",
                                    }}
                                    onMouseOver={e => { e.currentTarget.style.background = "#333"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "#1a1a1a"; }}
                                >
                                    <Download size={13} /> PDF
                                </a>
                                <a
                                    href={`${API_BASE}/translate/${result.job_id}/download/docx`}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{
                                        display: "flex", alignItems: "center", gap: "6px",
                                        background: "white", border: "1px solid #e8e8e4",
                                        borderRadius: "8px", padding: "9px 16px",
                                        color: "#2b2b2b", fontSize: "13px", fontWeight: "600",
                                        textDecoration: "none", transition: "all 0.15s",
                                    }}
                                    onMouseOver={e => { e.currentTarget.style.background = "#f7f2e4"; e.currentTarget.style.borderColor = "#d0d0cc"; }}
                                    onMouseOut={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "#e8e8e4"; }}
                                >
                                    <Download size={13} /> DOCX
                                </a>
                            </div>
                        </div>

                        {/* Stats */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
                            {[
                                { icon: <Globe size={16} color={ACCENT} />, label: "SOURCE", value: result.source_language },
                                { icon: <Languages size={16} color={ACCENT} />, label: "TARGET", value: result.target_language },
                                { icon: <AlignLeft size={16} color={ACCENT} />, label: "WORDS", value: result.total_words.toLocaleString() },
                                { icon: <BookOpen size={16} color={ACCENT} />, label: "CHAPTERS", value: result.chapters.toString() },
                            ].map(s => (
                                <div key={s.label} style={{
                                    background: "white", border: "1px solid #e8e8e4",
                                    borderRadius: "10px", padding: "16px",
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                                        {s.icon}
                                        <span style={{ fontSize: "9px", fontWeight: "700", letterSpacing: "0.1em", color: "#0c43bb" }}>{s.label}</span>
                                    </div>
                                    <div style={{
                                        fontSize: "15px", fontWeight: "800", color: "#2b2b2b",
                                        letterSpacing: "-0.02em", fontFamily: "'Playfair Display', serif",
                                    }}>
                                        {s.value}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Chapter list */}
                        {result.chapter_titles.length > 0 && (
                            <div style={{
                                background: "white", border: "1px solid #e8e8e4",
                                borderRadius: "12px", padding: "20px", marginBottom: "20px",
                            }}>
                                <p style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", color: "#0c43bb", marginBottom: "14px" }}>
                                    Translated Chapters ({result.chapters})
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    {result.chapter_titles.map((title, i) => (
                                        <div key={i} style={{
                                            display: "flex", alignItems: "center", gap: "10px",
                                            padding: "8px 12px", background: "#f7f2e4",
                                            border: "1px solid #e8e8e4", borderRadius: "8px",
                                        }}>
                                            <span style={{
                                                width: "24px", height: "24px", borderRadius: "6px",
                                                background: "#1a1a1a",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                fontSize: "11px", fontWeight: "700", color: "white", flexShrink: 0,
                                            }}>
                                                {i + 1}
                                            </span>
                                            <span style={{ fontSize: "13px", color: "#2b2b2b", flex: 1 }}>{title}</span>
                                            <Hash size={12} color="#888" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={reset}
                            style={{
                                background: "none", border: "1px solid #e8e8e4",
                                borderRadius: "8px", padding: "10px 20px",
                                color: "#555", fontSize: "13px", cursor: "pointer",
                                fontFamily: "'DM Sans', sans-serif", fontWeight: "500",
                                transition: "all 0.15s",
                            }}
                            onMouseOver={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = "#f7f2e4";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "#d0d0cc";
                            }}
                            onMouseOut={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = "none";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "#e8e8e4";
                            }}
                        >
                            ← Translate another book
                        </button>
                    </div>
                )}
            </main>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes fadeInUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
                input::placeholder { color: #888; }
                ::-webkit-scrollbar { width: 3px; }
                ::-webkit-scrollbar-thumb { background: #e8e8e4; border-radius: 2px; }
            `}</style>
        </div>
    );
}