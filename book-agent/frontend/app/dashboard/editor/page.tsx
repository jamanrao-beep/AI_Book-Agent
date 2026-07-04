"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { parseFriendlyError } from "@/lib/api";
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
    BookMarked,
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
    premium: { label: "Premium", color: "#c9a84c", desc: "Elegant serif typography on warm cream paper", icon: "✦" },
    scifi: { label: "Sci-Fi", color: "#00e5ff", desc: "Futuristic monospace on deep space gray", icon: "◈" },
    romance: { label: "Romance", color: "#f06292", desc: "Soft cursive styles on blush gradients", icon: "♡" },
    academic: { label: "Academic", color: "var(--sapphire)", desc: "Clean scholarly layout, crisp lines", icon: "⊞" },
    thriller: { label: "Thriller", color: "var(--crimson)", desc: "High-contrast dark noir layout", icon: "◆" },
    fantasy: { label: "Fantasy", color: "var(--violet)", desc: "Ornate display scripts, classic margins", icon: "⟡" },
    minimalist: { label: "Minimalist", color: "var(--mist)", desc: "Ultra-clean modern layout, direct focus", icon: "○" },
    retro: { label: "Vintage", color: "#a1887f", desc: "Classic sepia, old-book warm layout", icon: "⊛" },
};

const SUGGESTIONS = [
    "Rewrite Chapter 1 in a more suspenseful tone",
    "Change the writing style to first person perspective",
    "Add a new short epilogue at the end of the manuscript",
    "Make the dialogue more natural and conversational",
    "Fix any pacing issues in Chapter 2",
    "Shorten Chapter 3 by about 25%",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypingDots() {
    return (
        <span style={{ display: "inline-flex", gap: "4px", alignItems: "center", padding: "4px 0" }}>
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    style={{
                        width: "6px", height: "6px", borderRadius: "50%",
                        background: "var(--sapphire)",
                        animation: "pulse 1.2s infinite ease-in-out",
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
            display: "inline-flex", alignItems: "center", gap: "6px",
            background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
            borderRadius: "20px", padding: "4px 12px",
            fontSize: "11px", fontWeight: "700", color: meta.color,
            boxShadow: "0 2px 6px rgba(0,0,0,0.01)",
        }}>
            <span style={{ fontSize: "11px" }}>{meta.icon}</span> {meta.label}
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
                    content: `**"${data.title}"** loaded successfully — ${data.chapters} chapter${data.chapters !== 1 ? "s" : ""} detected.${data.author ? ` Author: *${data.author}*` : ""} Starting layout style: **${data.theme}**.\n\nDescribe the changes you want to apply. Our AI agent will edit the book accordingly!`,
                    timestamp: new Date(),
                },
            ]);
        } catch (e: unknown) {
            setUploadError(parseFriendlyError(e));
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

            // Poll for completion
            let polled = false;
            while (!polled) {
                await new Promise((r) => setTimeout(r, 2500));
                const sRes = await fetch(`${API_BASE}/editor/${session.session_id}/job/${job_id}/status`);
                if (!sRes.ok) continue;
                const statusData = await sRes.json();

                if (statusData.state === "done" && statusData.result) {
                    polled = true;
                    const ver: Version = {
                        ...statusData.result,
                        pdf_url: `${API_BASE}${statusData.result.pdf_url}`,
                        docx_url: `${API_BASE}${statusData.result.docx_url}`,
                    };
                    setVersions((prev) => [...prev, ver]);
                    setCurrentTheme(ver.theme);
                    setThemeOverride(null);

                    // Remove typing and add answer
                    setMessages((prev) =>
                        prev
                            .filter((m) => m.content !== typingId)
                            .concat([
                                {
                                    role: "assistant",
                                    content: ver.edit_summary,
                                    version: ver,
                                    timestamp: new Date(),
                                },
                            ])
                    );
                } else if (statusData.state === "error") {
                    polled = true;
                    throw new Error(statusData.error || "The editor agent encountered a model error.");
                }
            }
        } catch (e: unknown) {
            setChatError(parseFriendlyError(e));
            // Remove typing
            setMessages((prev) => prev.filter((m) => m.content !== typingId));
        } finally {
            setSending(false);
        }
    }, [input, session, themeOverride, sending]);

    const resetSession = () => {
        setSession(null);
        setFile(null);
        setMessages([]);
        setVersions([]);
        setUploadError("");
        setChatError("");
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
    };

    const themeAccent = THEME_META[currentTheme]?.color || "var(--sapphire)";

    // ════════════════════════════════════════════════════════════════════════════
    // RENDER — Upload Screen
    // ════════════════════════════════════════════════════════════════════════════
    if (!session) {
        return (
            <div style={{
                minHeight: "100vh",
                background: "var(--void)",
                fontFamily: "'DM Sans', sans-serif",
                color: "var(--text-primary)",
                display: "flex", flexDirection: "column",
                position: "relative",
            }}>
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
                        <div style={{
                            width: "28px", height: "28px",
                            background: "var(--text-primary)",
                            borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                            <PencilLine size={14} color="var(--void)" />
                        </div>
                        <span style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>Book Editor</span>
                    </div>
                </nav>

                {/* Main Content */}
                <main style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "64px 24px", position: "relative", zIndex: 2,
                }}>
                    <div style={{ width: "100%", maxWidth: "680px", animation: "fadeInUp 0.5s ease" }}>
                        
                        {/* Header */}
                        <div style={{ textAlign: "center", marginBottom: "40px" }}>
                            <div style={{
                                display: "inline-flex", alignItems: "center", gap: "6px",
                                background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
                                borderRadius: "20px", padding: "4px 14px",
                                fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em",
                                color: "var(--crimson)", marginBottom: "16px",
                                boxShadow: "0 4px 10px rgba(0,0,0,0.02)",
                            }}>
                                <Sparkles size={10} /> INTERACTIVE REWRITER
                            </div>
                            <h1 className="serif" style={{
                                fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em",
                                marginBottom: "10px", color: "var(--text-primary)",
                            }}>
                                AI Book Editor
                            </h1>
                            <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.6" }}>
                                Upload your book and have a conversation to edit it — chapter by chapter, tone by tone.
                            </p>
                        </div>

                        {/* Drop zone */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${dragOver ? "var(--crimson)" : file ? "rgba(239, 68, 68, 0.4)" : "var(--border-strong)"}`,
                                borderRadius: "20px", padding: "48px 32px",
                                background: file ? "rgba(239, 68, 68, 0.02)" : dragOver ? "rgba(239, 68, 68, 0.05)" : "var(--onyx)",
                                cursor: "pointer", textAlign: "center",
                                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)", marginBottom: "24px",
                                boxShadow: "0 10px 30px -10px rgba(0,0,0,0.02)",
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
                                        width: "56px", height: "56px", margin: "0 auto 14px",
                                        background: "var(--void)", border: "1.5px solid var(--border-mid)",
                                        borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <FileText size={22} color="var(--crimson)" />
                                    </div>
                                    <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "4px", color: "var(--text-primary)" }}>
                                        {file.name}
                                    </p>
                                    <p style={{ color: "var(--text-tertiary)", fontSize: "12px" }}>
                                        {(file.size / 1024 / 1024).toFixed(2)} MB · Click to change file
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <div style={{
                                        width: "56px", height: "56px", margin: "0 auto 16px",
                                        background: "var(--void)", border: "1.5px solid var(--border-mid)",
                                        borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <Upload size={22} color="var(--crimson)" />
                                    </div>
                                    <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "6px", color: "var(--text-primary)" }}>
                                        Drop your manuscript here
                                    </p>
                                    <p style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>
                                        PDF, DOCX, ZIP, TXT, MD · up to 150 MB
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Theme picker */}
                        <div style={{ marginBottom: "32px" }}>
                            <label className="field-label" style={{ color: "var(--crimson)", marginBottom: "12px" }}>STARTING STYLE THEME</label>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                                {Object.entries(THEME_META).map(([key, meta]) => {
                                    const isSelected = selectedTheme === key;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => setSelectedTheme(key)}
                                            style={{
                                                background: isSelected ? "var(--void)" : "var(--onyx)",
                                                border: `1.5px solid ${isSelected ? meta.color : "var(--border-mid)"}`,
                                                borderRadius: "10px", padding: "12px 10px",
                                                cursor: "pointer", textAlign: "center", transition: "all 0.2s",
                                            }}
                                        >
                                            <div style={{ fontSize: "18px", marginBottom: "6px", color: meta.color }}>{meta.icon}</div>
                                            <div style={{ fontSize: "12px", fontWeight: "700", color: isSelected ? meta.color : "var(--text-secondary)" }}>
                                                {meta.label}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "10px", fontStyle: "italic", lineHeight: 1.4 }}>
                                {THEME_META[selectedTheme]?.desc} — you can toggle this styles template during chat.
                            </p>
                        </div>

                        {uploadError && (
                          <div style={{
                              display: "flex", alignItems: "center", gap: "8px",
                              background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.18)",
                              borderRadius: "10px", padding: "12px 16px", marginBottom: "20px",
                              fontSize: "13px", color: "var(--crimson)",
                          }}>
                              <AlertCircle size={15} /> {uploadError}
                          </div>
                        )}

                        <button
                            onClick={handleUpload}
                            disabled={!file || uploading}
                            className="btn-dark"
                            style={{
                                width: "100%", padding: "14px",
                                background: !file || uploading ? "rgba(0,0,0,0.04)" : "var(--text-primary)",
                                color: !file || uploading ? "var(--ash)" : "var(--void)",
                                border: "none", borderRadius: "12px",
                                cursor: !file || uploading ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                            }}
                        >
                            {uploading ? (
                                <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Analyzing manuscript structure…</>
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
            background: "var(--void)", fontFamily: "'DM Sans', sans-serif",
            color: "var(--text-primary)", display: "flex", flexDirection: "column",
        }}>
            {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
            <header className="glass" style={{
                borderBottom: "1.5px solid var(--border-mid)",
                padding: "0 24px", height: "60px",
                display: "flex", alignItems: "center", gap: "16px",
                flexShrink: 0, zIndex: 50,
            }}>
                <button
                    onClick={resetSession}
                    className="btn-ghost"
                    style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      padding: "6px 12px", fontSize: "12px", borderRadius: "8px"
                    }}
                >
                    <ArrowLeft size={13} /> Exit Session
                </button>

                <div style={{ width: "1px", height: "20px", background: "var(--border-mid)" }} />

                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                    <div style={{
                        width: "30px", height: "30px", flexShrink: 0,
                        background: "var(--void)",
                        border: "1px solid var(--border-mid)",
                        borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <BookOpen size={14} color="var(--crimson)" />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <h4 style={{
                            fontWeight: "800", fontSize: "14px", letterSpacing: "-0.01em",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            color: "var(--text-primary)",
                        }}>
                            {session.title}
                        </h4>
                        {session.author && (
                            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "1px" }}>by {session.author}</p>
                        )}
                    </div>
                </div>

                {/* Center tags layout */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <ThemePill theme={currentTheme} accent={themeAccent} />
                    <button
                        onClick={() => { setShowChapters(!showChapters); setShowHistory(false); }}
                        className="btn-ghost"
                        style={{
                            display: "flex", alignItems: "center", gap: "5px",
                            borderRadius: "20px", padding: "4px 12px",
                            fontSize: "11px", fontWeight: "600",
                        }}
                    >
                        <BookMarked size={12} /> Chapters ({session.chapters})
                    </button>
                    <button
                        onClick={() => { setShowHistory(!showHistory); setShowChapters(false); }}
                        className="btn-ghost"
                        style={{
                            display: "flex", alignItems: "center", gap: "5px",
                            borderRadius: "20px", padding: "4px 12px",
                            fontSize: "11px", fontWeight: "600",
                        }}
                    >
                        <History size={12} /> History ({versions.length})
                    </button>
                </div>
            </header>

            {/* ── Body ────────────────────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
                
                {/* ── Left panel: Chapters shelf ── */}
                {showChapters && (
                    <div style={{
                        width: "300px", background: "var(--onyx)",
                        borderRight: "1.5px solid var(--border-mid)",
                        display: "flex", flexDirection: "column",
                        animation: "slideIn 0.25s ease-out",
                        flexShrink: 0,
                    }}>
                        <div style={{ padding: "16px", borderBottom: "1.5px solid var(--border-mid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="field-label" style={{ margin: 0, color: "var(--crimson)" }}>Manuscript Index</span>
                            <button onClick={() => setShowChapters(false)} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
                                <X size={15} />
                            </button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {session.chapter_titles.map((title, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "var(--void)", border: "1px solid var(--border-mid)", borderRadius: "8px" }}>
                                        <span style={{ width: "22px", height: "22px", borderRadius: "5px", background: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "700", color: "var(--void)" }}>
                                            {i + 1}
                                        </span>
                                        <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: "600" }}>{title}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Left panel: Version History shelf ── */}
                {showHistory && (
                    <div style={{
                        width: "300px", background: "var(--onyx)",
                        borderRight: "1.5px solid var(--border-mid)",
                        display: "flex", flexDirection: "column",
                        animation: "slideIn 0.25s ease-out",
                        flexShrink: 0,
                    }}>
                        <div style={{ padding: "16px", borderBottom: "1.5px solid var(--border-mid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="field-label" style={{ margin: 0, color: "var(--crimson)" }}>Edit Version History</span>
                            <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
                                <X size={15} />
                            </button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
                            {versions.length === 0 ? (
                                <p style={{ color: "var(--text-tertiary)", fontSize: "12px", textAlign: "center", padding: "30px 0" }}>No changes generated yet.</p>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {versions.map((ver) => (
                                        <div key={ver.turn} style={{ background: "var(--void)", border: "1px solid var(--border-mid)", borderRadius: "10px", padding: "12px" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                                <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--crimson)" }}>Version {ver.turn}</span>
                                                <ThemePill theme={ver.theme} accent="#666" />
                                            </div>
                                            <p style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: "1.4", marginBottom: "8px" }}>{ver.edit_summary}</p>
                                            <div style={{ display: "flex", gap: "6px" }}>
                                                <a href={ver.pdf_url} target="_blank" rel="noopener noreferrer" className="btn-dark" style={{ padding: "4px 10px", fontSize: "11px", borderRadius: "6px", textDecoration: "none" }}>
                                                    PDF
                                                </a>
                                                <a href={ver.docx_url} target="_blank" rel="noopener noreferrer" className="btn-outline" style={{ padding: "4px 10px", fontSize: "11px", borderRadius: "6px", textDecoration: "none" }}>
                                                    DOCX
                                                </a>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Main Chat Area ── */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--void)" }}>
                    
                    {/* Chat Messages */}
                    <div className="chat-scroll" style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
                        <div style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
                            {messages.map((m, idx) => {
                                const isUser = m.role === "user";
                                const isSystem = m.role === "system";
                                const isTyping = m.content === "__typing__";

                                return (
                                    <div
                                        key={idx}
                                        style={{
                                            display: "flex",
                                            justifyContent: isSystem ? "center" : isUser ? "flex-end" : "flex-start",
                                            animation: "fadeInUp 0.3s ease",
                                        }}
                                    >
                                        <div style={{
                                            maxWidth: isSystem ? "100%" : "70%",
                                            background: isSystem
                                                ? "rgba(37,99,235,0.04)"
                                                : isUser
                                                    ? "var(--text-primary)"
                                                    : "var(--onyx)",
                                            color: isUser ? "var(--void)" : "var(--text-primary)",
                                            border: isSystem
                                                ? "1.5px solid var(--border-mid)"
                                                : isUser
                                                    ? "none"
                                                    : "1.5px solid var(--border-mid)",
                                            borderRadius: isSystem ? "12px" : "16px",
                                            padding: isSystem ? "16px 20px" : "14px 20px",
                                            boxShadow: isUser ? "0 4px 12px rgba(0,0,0,0.04)" : "0 4px 12px rgba(0,0,0,0.01)",
                                        }}>
                                            {isTyping ? (
                                                <TypingDots />
                                            ) : (
                                                <div style={{ fontSize: "14px", lineHeight: "1.6", whiteSpace: "pre-line" }}>
                                                    {m.content}
                                                </div>
                                            )}

                                            {/* Attached Version panel in chat */}
                                            {m.version && (
                                                <div style={{
                                                    marginTop: "12px", paddingTop: "12px",
                                                    borderTop: "1px solid var(--border-mid)",
                                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                                    gap: "20px",
                                                }}>
                                                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--crimson)" }}>
                                                        Draft Version {m.version.turn} Compiled
                                                    </span>
                                                    <div style={{ display: "flex", gap: "6px" }}>
                                                        <a href={m.version.pdf_url} target="_blank" rel="noopener noreferrer" className="btn-dark" style={{ padding: "6px 12px", fontSize: "12px", borderRadius: "8px", textDecoration: "none" }}>
                                                            <Download size={12} /> PDF
                                                        </a>
                                                        <a href={m.version.docx_url} target="_blank" rel="noopener noreferrer" className="btn-outline" style={{ padding: "6px 12px", fontSize: "12px", borderRadius: "8px", textDecoration: "none" }}>
                                                            <Download size={12} /> DOCX
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={chatEndRef} />
                        </div>
                    </div>

                    {/* Chat Input Dock */}
                    <div style={{
                        background: "var(--onyx)", borderTop: "1.5px solid var(--border-mid)",
                        padding: "20px 32px 24px", flexShrink: 0,
                    }}>
                        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
                            
                            {/* Suggestions */}
                            {messages.length === 1 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                    {SUGGESTIONS.map((s) => (
                                        <button
                                            key={s} onClick={() => setInput(s)}
                                            className="btn-ghost"
                                            style={{
                                                fontSize: "12px", padding: "6px 12px",
                                                borderRadius: "16px", background: "var(--void)",
                                            }}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {chatError && (
                                <div style={{
                                    display: "flex", alignItems: "center", gap: "8px",
                                    background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.18)",
                                    borderRadius: "8px", padding: "10px 14px", marginBottom: "14px",
                                    fontSize: "13px", color: "var(--crimson)",
                                }}>
                                    <AlertCircle size={14} /> {chatError}
                                </div>
                            )}

                            {/* Chat controls & forms */}
                            <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                                
                                {/* Theme picker trigger */}
                                <div style={{ position: "relative" }}>
                                    <button
                                        onClick={() => setShowThemePicker(!showThemePicker)}
                                        className="btn-ghost"
                                        style={{
                                            padding: "12px", borderRadius: "10px",
                                            background: themeOverride ? "var(--sapphire-dim)" : "var(--void)",
                                            color: themeOverride ? "var(--sapphire)" : "var(--text-secondary)",
                                            borderColor: themeOverride ? "var(--sapphire)" : "var(--border-mid)",
                                        }}
                                    >
                                        <Palette size={16} />
                                    </button>
                                    {showThemePicker && (
                                        <div className="card" style={{
                                            position: "absolute", bottom: "100%", left: 0, marginBottom: "8px",
                                            width: "280px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
                                            borderRadius: "12px", padding: "12px", zIndex: 100,
                                            boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
                                            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px",
                                        }}>
                                            {Object.entries(THEME_META).map(([key, meta]) => (
                                                <button
                                                    key={key}
                                                    onClick={() => {
                                                        setThemeOverride(key);
                                                        setShowThemePicker(false);
                                                    }}
                                                    style={{
                                                        background: themeOverride === key ? "var(--void)" : "transparent",
                                                        border: `1px solid ${themeOverride === key ? meta.color : "var(--border-mid)"}`,
                                                        borderRadius: "8px", padding: "8px",
                                                        cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: "6px"
                                                    }}
                                                >
                                                    <span style={{ color: meta.color }}>{meta.icon}</span>
                                                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-primary)" }}>{meta.label}</span>
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => { setThemeOverride(null); setShowThemePicker(false); }}
                                                style={{
                                                    gridColumn: "span 2", textAlign: "center", padding: "6px",
                                                    fontSize: "11px", fontWeight: "600", cursor: "pointer",
                                                    border: "1px solid var(--border-mid)", background: "transparent", borderRadius: "6px",
                                                }}
                                            >
                                                Clear override theme
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Text input field */}
                                <div style={{ flex: 1, position: "relative" }}>
                                    <textarea
                                        ref={textareaRef}
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                sendMessage();
                                            }
                                        }}
                                        placeholder="Ask AI to rewrite, edit, or style your book..."
                                        rows={1}
                                        className="input-field"
                                        style={{
                                            resize: "none", overflowY: "auto",
                                            paddingRight: "50px", minHeight: "44px",
                                        }}
                                    />
                                    <button
                                        onClick={() => sendMessage()}
                                        disabled={!input.trim() || sending}
                                        className="btn-dark"
                                        style={{
                                            position: "absolute", right: "6px", bottom: "6px",
                                            padding: "6px 12px", borderRadius: "8px",
                                            background: !input.trim() || sending ? "transparent" : "var(--text-primary)",
                                            color: !input.trim() || sending ? "var(--ash)" : "var(--void)",
                                            border: "none",
                                        }}
                                    >
                                        <Send size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
