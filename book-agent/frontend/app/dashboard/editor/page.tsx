"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    ArrowLeft,
    Upload,
    Send,
    Download,
    FileText,
    Sparkles,
    ChevronDown,
    ChevronRight,
    BookOpen,
    Palette,
    Clock,
    CheckCircle,
    AlertCircle,
    Loader2,
    PencilLine,
    X,
    History,
    Wand2,
    FileDown,
    BookMarked,
    RefreshCw,
    Layers,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Version {
    turn: number;
    edit_summary: string;
    theme: string;
    chapters_changed: number[];
    pdf_url: string;
    docx_url: string;
}

interface Message {
    role: "user" | "assistant" | "system";
    content: string;
    version?: Version;
    timestamp: Date;
}

interface SessionMeta {
    session_id: string;
    title: string;
    author: string;
    chapters: number;
    chapter_titles: string[];
    theme: string;
    available_themes: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const THEME_META: Record<string, { label: string; color: string; desc: string; icon: string }> = {
    premium: { label: "Premium", color: "#c9a84c", desc: "Elegant serif typography on cream", icon: "✦" },
    scifi: { label: "Sci-Fi", color: "#00e5ff", desc: "Futuristic monospace on deep space", icon: "◈" },
    romance: { label: "Romance", color: "#f06292", desc: "Soft cursive on blush gradient", icon: "♡" },
    academic: { label: "Academic", color: "#7986cb", desc: "Clean scholarly layout, indigo accents", icon: "⊞" },
    thriller: { label: "Thriller", color: "#ef5350", desc: "High-contrast dark noir aesthetic", icon: "◆" },
    fantasy: { label: "Fantasy", color: "#ab47bc", desc: "Ornate display font, jewel tones", icon: "⟡" },
    minimalist: { label: "Minimal", color: "#90a4ae", desc: "Ultra-clean black on white", icon: "○" },
    retro: { label: "Vintage", color: "#a1887f", desc: "Sepia tones, old-book warmth", icon: "⊛" },
    normal: { label: "Normal", color: "#94a3b8", desc: "Clean default layout", icon: "□" },
    vibrant: { label: "Vibrant", color: "#F59E0B", desc: "Bold colors, high energy", icon: "★" },
    vintage: { label: "Vintage", color: "#a1887f", desc: "Sepia tones, old-book warmth", icon: "⊛" },
};

const SUGGESTIONS = [
    "Rewrite Chapter 1 in a more suspenseful tone",
    "Make the entire book sci-fi themed",
    "Add a new chapter at the end as an epilogue",
    "Fix any inconsistencies in character names",
    "Make the dialogue more natural and conversational",
    "Shorten Chapter 3 by about 30%",
    "Change the writing style to first person",
    "Make it suitable for a younger (YA) audience",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypingDots() {
    return (
        <span style={{ display: "inline-flex", gap: "3px", alignItems: "center", padding: "2px 0" }}>
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    style={{
                        width: "5px", height: "5px", borderRadius: "50%",
                        background: "#f472b6",
                        animation: "bounce 1.2s infinite",
                        animationDelay: `${i * 0.2}s`,
                    }}
                />
            ))}
        </span>
    );
}

function ThemePill({ theme, accent }: { theme: string; accent: string }) {
    const meta = THEME_META[theme] || { label: theme, color: accent, icon: "◎" };
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            background: `${meta.color}18`, border: `1px solid ${meta.color}44`,
            borderRadius: "20px", padding: "2px 10px",
            fontSize: "11px", fontWeight: "600", color: meta.color,
            letterSpacing: "0.04em",
        }}>
            {meta.icon} {meta.label}
        </span>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BookEditorPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);

    // Upload state
    const [file, setFile] = useState<File | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [selectedTheme, setSelectedTheme] = useState("premium");
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Session state
    const [session, setSession] = useState<SessionMeta | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [versions, setVersions] = useState<Version[]>([]);
    const [currentTheme, setCurrentTheme] = useState("premium");

    // Chat state
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [chatError, setChatError] = useState("");
    const [themeOverride, setThemeOverride] = useState<string | null>(null);
    const [showThemePicker, setShowThemePicker] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showChapters, setShowChapters] = useState(false);
    const [expandedChapters, setExpandedChapters] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auth guard
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) router.push("/login");
            else setUser(u);
        });
        return () => unsub();
    }, [router]);

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
    }, [input]);

    // ── Upload ──────────────────────────────────────────────────────────────────

    const handleUpload = useCallback(async () => {
        if (!file) return;
        setUploading(true);
        setUploadError("");

        const fd = new FormData();
        fd.append("file", file);
        fd.append("theme", selectedTheme);

        try {
            const res = await fetch(`${API_BASE}/editor/upload`, { method: "POST", body: fd });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Upload failed");
            }
            const data: SessionMeta = await res.json();
            setSession(data);
            setCurrentTheme(data.theme);
            setMessages([
                {
                    role: "system",
                    content: `**"${data.title}"** loaded successfully — ${data.chapters} chapter${data.chapters !== 1 ? "s" : ""} detected.${data.author ? ` Author: *${data.author}*` : ""} Starting theme: **${data.theme}**.\n\nWhat would you like to edit?`,
                    timestamp: new Date(),
                },
            ]);
        } catch (e: unknown) {
            setUploadError(e instanceof Error ? e.message : "Upload failed");
        } finally {
            setUploading(false);
        }
    }, [file, selectedTheme]);

    // ── Chat send ───────────────────────────────────────────────────────────────

    const sendMessage = useCallback(async (text?: string) => {
        const msg = (text || input).trim();
        if (!msg || !session || sending) return;

        setInput("");
        setSending(true);
        setChatError("");
        setShowThemePicker(false);

        const userMsg: Message = { role: "user", content: msg, timestamp: new Date() };
        setMessages((prev) => [...prev, userMsg]);

        // Optimistic typing indicator
        const typingId = "__typing__";
        setMessages((prev) => [...prev, { role: "assistant", content: typingId, timestamp: new Date() }]);

        const fd = new FormData();
        fd.append("user_message", msg);
        if (themeOverride) fd.append("theme", themeOverride);

        try {
            const res = await fetch(`${API_BASE}/editor/${session.session_id}/chat`, {
                method: "POST",
                body: fd,
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Edit failed");
            }
            const { job_id } = await res.json();

            interface EditorResult {
                turn: number;
                edit_summary: string;
                theme: string;
                chapters_changed: number[];
                pdf_url: string;
                docx_url: string;
                chapter_titles?: string[];
                title?: string;
                assistant_message?: string;
            }

            const data = await new Promise<EditorResult>((resolve, reject) => {
                let consecutiveErrors = 0;
                const poll = async () => {
                    try {
                        const statusRes = await fetch(
                            `${API_BASE}/editor/${session.session_id}/job/${job_id}/status`
                        );
                        const status = await statusRes.json();
                        consecutiveErrors = 0;
                        if (status.state === "done") return resolve(status.result as EditorResult);
                        if (status.state === "error") return reject(new Error(status.error || "Edit failed"));
                        setTimeout(poll, 3000);
                    } catch (err) {
                        consecutiveErrors++;
                        if (consecutiveErrors >= 10) return reject(new Error("Polling failed repeatedly"));
                        setTimeout(poll, Math.min(3000 * consecutiveErrors, 15000));
                    }
                };
                setTimeout(poll, 3000);
            });

            const version: Version = {
                turn: data.turn,
                edit_summary: data.edit_summary,
                theme: data.theme,
                chapters_changed: data.chapters_changed || [],
                pdf_url: `${API_BASE}${data.pdf_url}`,
                docx_url: `${API_BASE}${data.docx_url}`,
            };

            setVersions((prev) => [...prev, version]);
            setCurrentTheme(data.theme);
            if (themeOverride) setThemeOverride(null);

            if (data.chapter_titles) {
                setSession((prev) => prev ? { ...prev, chapter_titles: data.chapter_titles!, title: data.title || prev.title } : prev);
            }

            setMessages((prev) =>
                prev
                    .filter((m) => m.content !== typingId)
                    .concat({
                        role: "assistant",
                        content: data.assistant_message || data.edit_summary,
                        version,
                        timestamp: new Date(),
                    })
            );
        } catch (e: unknown) {
            setMessages((prev) => prev.filter((m) => m.content !== typingId));
            setChatError(e instanceof Error ? e.message : "Something went wrong");
            setUploadError(
                e instanceof TypeError && e.message.includes("fetch")
                    ? `Cannot connect to server at ${API_BASE}. Is the backend running?`
                    : e instanceof Error ? e.message : "Upload failed"
            );
        } finally {
            setSending(false);
        }
    }, [input, session, sending, themeOverride]);

    // ── Reset session ───────────────────────────────────────────────────────────

    const resetSession = useCallback(async () => {
        if (session) {
            await fetch(`${API_BASE}/editor/${session.session_id}`, { method: "DELETE" }).catch(() => { });
        }
        setSession(null);
        setMessages([]);
        setVersions([]);
        setFile(null);
        setCurrentTheme("premium");
        setThemeOverride(null);
        setInput("");
        setChatError("");
    }, [session]);

    // ── Keyboard send ───────────────────────────────────────────────────────────

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    // ── Drag & drop ─────────────────────────────────────────────────────────────

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) setFile(f);
    };

    const accentColor = "#f472b6";
    const themeAccent = THEME_META[currentTheme]?.color || accentColor;

    // ════════════════════════════════════════════════════════════════════════════
    // RENDER — Upload Screen
    // ════════════════════════════════════════════════════════════════════════════

    if (!session) {
        return (
            <div style={{
                minHeight: "100vh", background: "#0c0f1a",
                fontFamily: "'DM Sans', sans-serif", color: "#e2e8f0",
                display: "flex", flexDirection: "column",
            }}>
                <style>{`
          @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
          @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
          @keyframes spin { to{transform:rotate(360deg)} }
          .upload-zone:hover { border-color: #f472b688 !important; background: rgba(244,114,182,0.06) !important; }
          .theme-opt:hover { border-color: var(--tc) !important; background: var(--tbg) !important; }
          .upload-btn:hover { opacity: 0.88; transform: translateY(-1px); }
          .back-btn:hover { color: #e2e8f0 !important; }
        `}</style>

                {/* Nav */}
                <nav style={{
                    borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 40px",
                    height: "60px", display: "flex", alignItems: "center",
                    background: "rgba(12,15,26,0.95)", backdropFilter: "blur(12px)",
                    position: "sticky", top: 0, zIndex: 50,
                }}>
                    <button
                        className="back-btn"
                        onClick={() => router.push("/dashboard")}
                        style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            background: "none", border: "none", color: "#64748b",
                            fontSize: "13px", cursor: "pointer", padding: 0, transition: "color 0.2s",
                        }}
                    >
                        <ArrowLeft size={15} /> Back to Dashboard
                    </button>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{
                            width: "28px", height: "28px",
                            background: "linear-gradient(135deg, #f472b6, #c026d3)",
                            borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                            <PencilLine size={14} color="white" />
                        </div>
                        <span style={{ fontWeight: "700", fontSize: "14px" }}>Book Editor</span>
                    </div>
                </nav>

                {/* Content */}
                <main style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "48px 24px",
                }}>
                    <div style={{ width: "100%", maxWidth: "640px", animation: "fadeUp 0.5s ease" }}>
                        {/* Header */}
                        <div style={{ textAlign: "center", marginBottom: "40px" }}>
                            <div style={{
                                width: "64px", height: "64px", margin: "0 auto 20px",
                                background: "linear-gradient(135deg, rgba(244,114,182,0.2), rgba(192,38,211,0.2))",
                                border: "1px solid rgba(244,114,182,0.3)",
                                borderRadius: "18px", display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                                <PencilLine size={28} color="#f472b6" />
                            </div>
                            <h1 style={{
                                fontSize: "34px", fontWeight: "800", letterSpacing: "-0.03em",
                                fontFamily: "'Playfair Display', serif", marginBottom: "10px",
                            }}>
                                AI Book Editor
                            </h1>
                            <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6" }}>
                                Upload your book and have a conversation to edit it — chapter by chapter, theme by theme.
                            </p>
                        </div>

                        {/* Drop zone */}
                        <div
                            className="upload-zone"
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${dragOver ? "#f472b6" : file ? "rgba(244,114,182,0.5)" : "rgba(255,255,255,0.12)"}`,
                                borderRadius: "16px", padding: "40px 24px",
                                background: file ? "rgba(244,114,182,0.04)" : dragOver ? "rgba(244,114,182,0.06)" : "rgba(255,255,255,0.02)",
                                cursor: "pointer", textAlign: "center",
                                transition: "all 0.2s", marginBottom: "24px",
                            }}
                        >
                            <input
                                ref={fileInputRef} type="file"
                                accept=".pdf,.docx,.zip,.txt,.md"
                                style={{ display: "none" }}
                                onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
                            />
                            {file ? (
                                <div>
                                    <div style={{
                                        width: "48px", height: "48px", margin: "0 auto 12px",
                                        background: "rgba(244,114,182,0.15)", border: "1px solid rgba(244,114,182,0.3)",
                                        borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <FileText size={22} color="#f472b6" />
                                    </div>
                                    <p style={{ fontWeight: "600", fontSize: "15px", marginBottom: "4px", color: "#e2e8f0" }}>
                                        {file.name}
                                    </p>
                                    <p style={{ color: "#64748b", fontSize: "12px" }}>
                                        {(file.size / 1024 / 1024).toFixed(2)} MB · Click to change
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <div style={{
                                        width: "48px", height: "48px", margin: "0 auto 16px",
                                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                                        borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <Upload size={20} color="#64748b" />
                                    </div>
                                    <p style={{ fontWeight: "600", fontSize: "15px", marginBottom: "6px" }}>
                                        Drop your book here
                                    </p>
                                    <p style={{ color: "#64748b", fontSize: "13px" }}>
                                        PDF, DOCX, ZIP, TXT, MD · up to 150 MB
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Theme picker */}
                        <div style={{ marginBottom: "28px" }}>
                            <p style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", letterSpacing: "0.08em", marginBottom: "12px" }}>
                                STARTING THEME
                            </p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                                {Object.entries(THEME_META).map(([key, meta]) => (
                                    <button
                                        key={key}
                                        className="theme-opt"
                                        onClick={() => setSelectedTheme(key)}
                                        style={{
                                            "--tc": meta.color,
                                            "--tbg": `${meta.color}12`,
                                            background: selectedTheme === key ? `${meta.color}18` : "rgba(255,255,255,0.03)",
                                            border: `1px solid ${selectedTheme === key ? meta.color : "rgba(255,255,255,0.08)"}`,
                                            borderRadius: "10px", padding: "10px 8px",
                                            cursor: "pointer", textAlign: "center", transition: "all 0.15s",
                                        } as React.CSSProperties}
                                    >
                                        <div style={{ fontSize: "16px", marginBottom: "4px" }}>{meta.icon}</div>
                                        <div style={{ fontSize: "11px", fontWeight: "600", color: selectedTheme === key ? meta.color : "#94a3b8" }}>
                                            {meta.label}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <p style={{ fontSize: "11px", color: "#475569", marginTop: "8px" }}>
                                {THEME_META[selectedTheme]?.desc} — you can change this any time during editing.
                            </p>
                        </div>

                        {uploadError && (
                            <div style={{
                                display: "flex", alignItems: "center", gap: "8px",
                                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                                borderRadius: "10px", padding: "12px 16px", marginBottom: "20px",
                                fontSize: "13px", color: "#f87171",
                            }}>
                                <AlertCircle size={15} /> {uploadError}
                            </div>
                        )}

                        <button
                            className="upload-btn"
                            onClick={handleUpload}
                            disabled={!file || uploading}
                            style={{
                                width: "100%", padding: "14px",
                                background: !file || uploading ? "rgba(244,114,182,0.3)" : "linear-gradient(135deg, #f472b6, #c026d3)",
                                border: "none", borderRadius: "12px", color: "white",
                                fontSize: "15px", fontWeight: "700", cursor: !file || uploading ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                                transition: "all 0.2s",
                            }}
                        >
                            {uploading ? (
                                <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Parsing your book…</>
                            ) : (
                                <><Wand2 size={18} /> Start Editing Session</>
                            )}
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    // ════════════════════════════════════════════════════════════════════════════
    // RENDER — Editor Screen
    // ════════════════════════════════════════════════════════════════════════════

    const latestVersion = versions[versions.length - 1] || null;

    return (
        <div style={{
            minHeight: "100vh", height: "100vh", overflow: "hidden",
            background: "#0c0f1a", fontFamily: "'DM Sans', sans-serif",
            color: "#e2e8f0", display: "flex", flexDirection: "column",
        }}>
            <style>{`
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes slideIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        .msg-bubble { animation: fadeUp 0.3s ease; }
        .send-btn:hover:not(:disabled) { transform: scale(1.06); }
        .dl-btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .suggestion-chip:hover { background: rgba(244,114,182,0.12) !important; border-color: rgba(244,114,182,0.4) !important; color: #f9a8d4 !important; }
        .theme-mini:hover { border-color: var(--tc) !important; }
        .version-row:hover { background: rgba(255,255,255,0.04) !important; }
        .panel-close:hover { color: #e2e8f0 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .chat-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
      `}</style>

            {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
            <header style={{
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                padding: "0 24px", height: "58px",
                display: "flex", alignItems: "center", gap: "16px",
                background: "rgba(12,15,26,0.97)", backdropFilter: "blur(12px)",
                flexShrink: 0, zIndex: 50,
            }}>
                {/* Left: back + book info */}
                <button
                    onClick={resetSession}
                    style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        background: "none", border: "none", color: "#64748b",
                        fontSize: "12px", cursor: "pointer", padding: 0, flexShrink: 0,
                    }}
                >
                    <ArrowLeft size={14} /> New Book
                </button>

                <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.08)" }} />

                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                    <div style={{
                        width: "30px", height: "30px", flexShrink: 0,
                        background: "linear-gradient(135deg, rgba(244,114,182,0.2), rgba(192,38,211,0.2))",
                        border: "1px solid rgba(244,114,182,0.3)",
                        borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <BookOpen size={14} color="#f472b6" />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <p style={{
                            fontWeight: "700", fontSize: "14px", letterSpacing: "-0.01em",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                            {session.title}
                        </p>
                        {session.author && (
                            <p style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>by {session.author}</p>
                        )}
                    </div>
                </div>

                {/* Centre: live theme + chapters pills */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <ThemePill theme={currentTheme} accent={themeAccent} />
                    <button
                        onClick={() => { setShowChapters(!showChapters); setShowHistory(false); }}
                        style={{
                            display: "flex", alignItems: "center", gap: "5px",
                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "20px", padding: "3px 10px",
                            fontSize: "11px", color: "#94a3b8", cursor: "pointer",
                        }}
                    >
                        <Layers size={11} /> {session.chapters} chapters
                    </button>
                </div>

                {/* Right: history + version count */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    {versions.length > 0 && (
                        <div style={{
                            display: "flex", alignItems: "center", gap: "5px",
                            fontSize: "12px", color: "#10b981",
                        }}>
                            <CheckCircle size={13} /> v{versions.length}
                        </div>
                    )}
                    <button
                        onClick={() => { setShowHistory(!showHistory); setShowChapters(false); }}
                        style={{
                            display: "flex", alignItems: "center", gap: "6px",
                            background: showHistory ? "rgba(244,114,182,0.1)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${showHistory ? "rgba(244,114,182,0.3)" : "rgba(255,255,255,0.08)"}`,
                            borderRadius: "8px", padding: "6px 12px",
                            fontSize: "12px", color: showHistory ? "#f472b6" : "#94a3b8",
                            cursor: "pointer", transition: "all 0.15s",
                        }}
                    >
                        <History size={13} /> Version History
                    </button>
                </div>
            </header>

            {/* ── Body ────────────────────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

                {/* ── Chapter list panel ──────────────────────────────────────────── */}
                {showChapters && (
                    <aside style={{
                        width: "280px", flexShrink: 0,
                        borderRight: "1px solid rgba(255,255,255,0.07)",
                        background: "#0e1120", display: "flex", flexDirection: "column",
                        animation: "slideIn 0.2s ease", overflow: "hidden",
                    }}>
                        <div style={{
                            padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}>
                            <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.06em", color: "#64748b" }}>
                                CHAPTERS
                            </span>
                            <button
                                className="panel-close"
                                onClick={() => setShowChapters(false)}
                                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", padding: "2px" }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }} className="chat-scroll">
                            {session.chapter_titles.map((title, i) => (
                                <div
                                    key={i}
                                    style={{
                                        padding: "10px 12px", borderRadius: "8px",
                                        marginBottom: "4px", cursor: "pointer",
                                        transition: "background 0.15s",
                                        display: "flex", alignItems: "flex-start", gap: "10px",
                                    }}
                                    onClick={() => {
                                        setInput(`Rewrite Chapter ${i + 1} — "${title}" to `);
                                        textareaRef.current?.focus();
                                        setShowChapters(false);
                                    }}
                                    className="version-row"
                                >
                                    <span style={{
                                        fontSize: "10px", fontWeight: "700", color: "#f472b6",
                                        background: "rgba(244,114,182,0.1)", border: "1px solid rgba(244,114,182,0.2)",
                                        borderRadius: "5px", padding: "1px 6px", flexShrink: 0, marginTop: "1px",
                                    }}>
                                        {i + 1}
                                    </span>
                                    <span style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.4" }}>{title}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ padding: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                            <p style={{ fontSize: "11px", color: "#475569", textAlign: "center" }}>
                                Click a chapter to start editing it
                            </p>
                        </div>
                    </aside>
                )}

                {/* ── Chat area ───────────────────────────────────────────────────── */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

                    {/* Messages */}
                    <div
                        className="chat-scroll"
                        style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: "20px" }}
                    >
                        {messages.map((msg, idx) => (
                            <div key={idx} className="msg-bubble">

                                {/* System message */}
                                {msg.role === "system" && (
                                    <div style={{
                                        background: "rgba(244,114,182,0.06)",
                                        border: "1px solid rgba(244,114,182,0.18)",
                                        borderRadius: "12px", padding: "16px 20px",
                                        fontSize: "13px", color: "#cbd5e1", lineHeight: "1.7",
                                        maxWidth: "680px", margin: "0 auto",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                            <Sparkles size={13} color="#f472b6" />
                                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.06em", color: "#f472b6" }}>
                                                SESSION STARTED
                                            </span>
                                        </div>
                                        {msg.content.split("\n").map((line, li) => (
                                            <p key={li} style={{ margin: "2px 0" }}
                                                dangerouslySetInnerHTML={{
                                                    __html: line
                                                        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                                                        .replace(/\*(.+?)\*/g, "<em>$1</em>"),
                                                }}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* User message */}
                                {msg.role === "user" && (
                                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                        <div style={{
                                            background: "linear-gradient(135deg, rgba(244,114,182,0.18), rgba(192,38,211,0.12))",
                                            border: "1px solid rgba(244,114,182,0.2)",
                                            borderRadius: "16px 16px 4px 16px",
                                            padding: "12px 18px", maxWidth: "65%",
                                            fontSize: "14px", lineHeight: "1.6", color: "#e2e8f0",
                                        }}>
                                            {msg.content}
                                        </div>
                                    </div>
                                )}

                                {/* Assistant message */}
                                {msg.role === "assistant" && (
                                    <div style={{ display: "flex", gap: "12px", maxWidth: "75%" }}>
                                        {/* Avatar */}
                                        <div style={{
                                            width: "32px", height: "32px", flexShrink: 0,
                                            background: "linear-gradient(135deg, #f472b6, #c026d3)",
                                            borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center",
                                            marginTop: "2px",
                                        }}>
                                            <PencilLine size={14} color="white" />
                                        </div>

                                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                                            {/* Typing indicator */}
                                            {msg.content === "__typing__" ? (
                                                <div style={{
                                                    background: "rgba(255,255,255,0.04)",
                                                    border: "1px solid rgba(255,255,255,0.08)",
                                                    borderRadius: "4px 16px 16px 16px",
                                                    padding: "14px 18px",
                                                }}>
                                                    <TypingDots />
                                                </div>
                                            ) : (
                                                <div style={{
                                                    background: "rgba(255,255,255,0.04)",
                                                    border: "1px solid rgba(255,255,255,0.08)",
                                                    borderRadius: "4px 16px 16px 16px",
                                                    padding: "14px 18px",
                                                    fontSize: "14px", lineHeight: "1.7", color: "#cbd5e1",
                                                }}>
                                                    {msg.content.split("\n").map((line, li) => (
                                                        <p key={li} style={{ margin: "2px 0" }}
                                                            dangerouslySetInnerHTML={{
                                                                __html: line
                                                                    .replace(/\*\*(.+?)\*\*/g, "<strong style='color:#e2e8f0'>$1</strong>")
                                                                    .replace(/\*(.+?)\*/g, "<em>$1</em>"),
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            )}

                                            {/* Version download card */}
                                            {msg.version && (
                                                <div style={{
                                                    background: "rgba(16,185,129,0.06)",
                                                    border: "1px solid rgba(16,185,129,0.2)",
                                                    borderRadius: "12px", padding: "14px 16px",
                                                    animation: "fadeIn 0.4s ease",
                                                }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                                                        <CheckCircle size={14} color="#10b981" />
                                                        <span style={{ fontSize: "12px", fontWeight: "700", color: "#10b981", letterSpacing: "0.04em" }}>
                                                            VERSION {msg.version.turn} READY
                                                        </span>
                                                        <ThemePill theme={msg.version.theme} accent={THEME_META[msg.version.theme]?.color || "#10b981"} />
                                                        {msg.version.chapters_changed.length > 0 && (
                                                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                                                                Ch. {msg.version.chapters_changed.join(", ")} edited
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ display: "flex", gap: "8px" }}>
                                                        <a
                                                            href={msg.version.pdf_url}
                                                            download
                                                            className="dl-btn"
                                                            style={{
                                                                display: "flex", alignItems: "center", gap: "6px",
                                                                background: "#10b981", color: "white",
                                                                borderRadius: "8px", padding: "8px 14px",
                                                                fontSize: "12px", fontWeight: "700",
                                                                textDecoration: "none", transition: "all 0.2s",
                                                            }}
                                                        >
                                                            <FileDown size={13} /> PDF
                                                        </a>
                                                        <a
                                                            href={msg.version.docx_url}
                                                            download
                                                            className="dl-btn"
                                                            style={{
                                                                display: "flex", alignItems: "center", gap: "6px",
                                                                background: "rgba(16,185,129,0.15)",
                                                                border: "1px solid rgba(16,185,129,0.35)",
                                                                color: "#10b981", borderRadius: "8px",
                                                                padding: "8px 14px", fontSize: "12px",
                                                                fontWeight: "700", textDecoration: "none", transition: "all 0.2s",
                                                            }}
                                                        >
                                                            <FileText size={13} /> DOCX
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Error banner */}
                        {chatError && (
                            <div style={{
                                display: "flex", alignItems: "center", gap: "8px",
                                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
                                borderRadius: "10px", padding: "12px 16px",
                                fontSize: "13px", color: "#f87171", maxWidth: "680px", margin: "0 auto",
                            }}>
                                <AlertCircle size={14} /> {chatError}
                                <button
                                    onClick={() => setChatError("")}
                                    style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", marginLeft: "auto" }}
                                >
                                    <X size={13} />
                                </button>
                            </div>
                        )}

                        {/* Suggestions — shown only at the start */}
                        {messages.length === 1 && (
                            <div style={{ maxWidth: "680px", margin: "0 auto", width: "100%" }}>
                                <p style={{ fontSize: "11px", fontWeight: "600", color: "#475569", letterSpacing: "0.07em", marginBottom: "10px" }}>
                                    SUGGESTED EDITS
                                </p>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                    {SUGGESTIONS.map((s) => (
                                        <button
                                            key={s}
                                            className="suggestion-chip"
                                            onClick={() => sendMessage(s)}
                                            style={{
                                                background: "rgba(255,255,255,0.03)",
                                                border: "1px solid rgba(255,255,255,0.08)",
                                                borderRadius: "20px", padding: "7px 14px",
                                                fontSize: "12px", color: "#94a3b8",
                                                cursor: "pointer", transition: "all 0.15s",
                                            }}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div ref={chatEndRef} />
                    </div>

                    {/* ── Theme quick-switch bar (collapsible) ───────────────────────── */}
                    {showThemePicker && (
                        <div style={{
                            borderTop: "1px solid rgba(255,255,255,0.06)",
                            padding: "14px 32px",
                            background: "#0e1120",
                            display: "flex", alignItems: "center", gap: "10px",
                            flexWrap: "wrap", animation: "fadeUp 0.2s ease",
                        }}>
                            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", letterSpacing: "0.07em", flexShrink: 0 }}>
                                SWITCH THEME →
                            </span>
                            {Object.entries(THEME_META).map(([key, meta]) => (
                                <button
                                    key={key}
                                    className="theme-mini"
                                    onClick={() => { setThemeOverride(key); setShowThemePicker(false); setInput(`Switch the theme to ${meta.label}`); }}
                                    style={{
                                        "--tc": meta.color,
                                        display: "flex", alignItems: "center", gap: "5px",
                                        background: key === currentTheme ? `${meta.color}18` : "rgba(255,255,255,0.03)",
                                        border: `1px solid ${key === currentTheme ? meta.color : "rgba(255,255,255,0.08)"}`,
                                        borderRadius: "20px", padding: "5px 12px",
                                        fontSize: "12px", color: key === currentTheme ? meta.color : "#94a3b8",
                                        cursor: "pointer", transition: "all 0.15s",
                                    } as React.CSSProperties}
                                >
                                    {meta.icon} {meta.label}
                                </button>
                            ))}
                            <button
                                onClick={() => setShowThemePicker(false)}
                                style={{ marginLeft: "auto", background: "none", border: "none", color: "#475569", cursor: "pointer" }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {/* ── Input bar ───────────────────────────────────────────────────── */}
                    <div style={{
                        borderTop: "1px solid rgba(255,255,255,0.07)",
                        padding: "16px 24px",
                        background: "rgba(12,15,26,0.98)",
                        flexShrink: 0,
                    }}>
                        {/* Latest version quick-download */}
                        {latestVersion && !sending && (
                            <div style={{
                                display: "flex", alignItems: "center", gap: "10px",
                                marginBottom: "12px", padding: "8px 12px",
                                background: "rgba(255,255,255,0.02)",
                                border: "1px solid rgba(255,255,255,0.06)",
                                borderRadius: "10px",
                            }}>
                                <Clock size={12} color="#64748b" />
                                <span style={{ fontSize: "12px", color: "#64748b", flex: 1 }}>
                                    Latest: <strong style={{ color: "#94a3b8" }}>v{latestVersion.turn}</strong> — {latestVersion.edit_summary.slice(0, 70)}{latestVersion.edit_summary.length > 70 ? "…" : ""}
                                </span>
                                <a href={latestVersion.pdf_url} download style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#10b981", textDecoration: "none", fontWeight: "600" }}>
                                    <Download size={11} /> PDF
                                </a>
                                <a href={latestVersion.docx_url} download style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#10b981", textDecoration: "none", fontWeight: "600" }}>
                                    <Download size={11} /> DOCX
                                </a>
                            </div>
                        )}

                        <div style={{
                            display: "flex", gap: "10px", alignItems: "flex-end",
                        }}>
                            {/* Theme toggle button */}
                            <button
                                onClick={() => setShowThemePicker(!showThemePicker)}
                                title="Switch theme"
                                style={{
                                    width: "40px", height: "40px", flexShrink: 0,
                                    background: showThemePicker ? "rgba(244,114,182,0.15)" : "rgba(255,255,255,0.04)",
                                    border: `1px solid ${showThemePicker ? "rgba(244,114,182,0.3)" : "rgba(255,255,255,0.08)"}`,
                                    borderRadius: "10px", cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    color: showThemePicker ? "#f472b6" : "#64748b",
                                    transition: "all 0.15s",
                                }}
                            >
                                <Palette size={16} />
                            </button>

                            {/* Textarea */}
                            <div style={{
                                flex: 1, display: "flex", alignItems: "flex-end",
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "12px", padding: "10px 14px",
                                transition: "border-color 0.15s",
                            }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(244,114,182,0.4)")}
                                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                            >
                                <textarea
                                    ref={textareaRef}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Tell the AI what to edit… e.g. 'Make Chapter 2 more dramatic' or 'Switch to sci-fi theme'"
                                    disabled={sending}
                                    rows={1}
                                    style={{
                                        flex: 1, background: "none", border: "none", outline: "none",
                                        color: "#e2e8f0", fontSize: "14px", lineHeight: "1.5",
                                        resize: "none", fontFamily: "inherit",
                                        maxHeight: "160px", overflow: "auto",
                                        width: "100%",
                                    }}
                                />
                            </div>

                            {/* Send button */}
                            <button
                                className="send-btn"
                                onClick={() => sendMessage()}
                                disabled={!input.trim() || sending}
                                style={{
                                    width: "40px", height: "40px", flexShrink: 0,
                                    background: !input.trim() || sending
                                        ? "rgba(244,114,182,0.2)"
                                        : "linear-gradient(135deg, #f472b6, #c026d3)",
                                    border: "none", borderRadius: "10px", cursor: !input.trim() || sending ? "not-allowed" : "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    color: "white", transition: "all 0.15s",
                                }}
                            >
                                {sending
                                    ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                                    : <Send size={16} />}
                            </button>
                        </div>

                        <p style={{ fontSize: "11px", color: "#334155", marginTop: "8px", textAlign: "center" }}>
                            Enter to send · Shift+Enter for new line · Click <Palette size={10} style={{ display: "inline", verticalAlign: "middle" }} /> to change theme
                        </p>
                    </div>
                </div>

                {/* ── Version History panel ────────────────────────────────────────── */}
                {showHistory && (
                    <aside style={{
                        width: "300px", flexShrink: 0,
                        borderLeft: "1px solid rgba(255,255,255,0.07)",
                        background: "#0e1120",
                        display: "flex", flexDirection: "column",
                        animation: "slideIn 0.2s ease",
                    }}>
                        <div style={{
                            padding: "16px 20px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                                <History size={13} color="#f472b6" />
                                <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.06em", color: "#64748b" }}>
                                    VERSION HISTORY
                                </span>
                            </div>
                            <button
                                className="panel-close"
                                onClick={() => setShowHistory(false)}
                                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", padding: "2px" }}
                            >
                                <X size={14} />
                            </button>
                        </div>

                        <div className="chat-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
                            {versions.length === 0 ? (
                                <div style={{ padding: "32px 16px", textAlign: "center" }}>
                                    <BookMarked size={28} color="#334155" style={{ margin: "0 auto 12px" }} />
                                    <p style={{ fontSize: "13px", color: "#475569", lineHeight: "1.5" }}>
                                        No versions yet. Send your first edit instruction to get started.
                                    </p>
                                </div>
                            ) : (
                                [...versions].reverse().map((v) => (
                                    <div
                                        key={v.turn}
                                        className="version-row"
                                        style={{
                                            padding: "14px", borderRadius: "10px",
                                            marginBottom: "8px", border: "1px solid rgba(255,255,255,0.05)",
                                            transition: "background 0.15s",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                                                <span style={{
                                                    background: "rgba(244,114,182,0.15)", border: "1px solid rgba(244,114,182,0.25)",
                                                    borderRadius: "5px", padding: "1px 7px",
                                                    fontSize: "10px", fontWeight: "800", color: "#f472b6",
                                                }}>
                                                    v{v.turn}
                                                </span>
                                                <ThemePill theme={v.theme} accent={THEME_META[v.theme]?.color || "#f472b6"} />
                                            </div>
                                        </div>
                                        <p style={{ fontSize: "12px", color: "#94a3b8", lineHeight: "1.5", marginBottom: "10px" }}>
                                            {v.edit_summary}
                                        </p>
                                        {v.chapters_changed.length > 0 && (
                                            <p style={{ fontSize: "11px", color: "#475569", marginBottom: "10px" }}>
                                                Chapters changed: {v.chapters_changed.join(", ")}
                                            </p>
                                        )}
                                        <div style={{ display: "flex", gap: "7px" }}>
                                            <a
                                                href={v.pdf_url} download
                                                className="dl-btn"
                                                style={{
                                                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                                                    background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)",
                                                    borderRadius: "7px", padding: "7px",
                                                    fontSize: "11px", fontWeight: "700", color: "#10b981",
                                                    textDecoration: "none", transition: "all 0.15s",
                                                }}
                                            >
                                                <FileDown size={12} /> PDF
                                            </a>
                                            <a
                                                href={v.docx_url} download
                                                className="dl-btn"
                                                style={{
                                                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                                                    background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)",
                                                    borderRadius: "7px", padding: "7px",
                                                    fontSize: "11px", fontWeight: "700", color: "#818cf8",
                                                    textDecoration: "none", transition: "all 0.15s",
                                                }}
                                            >
                                                <FileText size={12} /> DOCX
                                            </a>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {versions.length > 0 && (
                            <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                <p style={{ fontSize: "11px", color: "#475569", textAlign: "center" }}>
                                    {versions.length} version{versions.length !== 1 ? "s" : ""} · all downloads available
                                </p>
                            </div>
                        )}
                    </aside>
                )}
            </div>
        </div>
    );
}