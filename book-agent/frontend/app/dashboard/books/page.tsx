"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, logout } from "@/lib/firebase";
import {
  generateBook,
  listBooks,
  getBookStatus,
  getProgress,
  downloadPDF,
  downloadDOCX,
  BookStatus,
} from "@/lib/api";
import {
  BookOpen,
  LogOut,
  Plus,
  FileText,
  Download,
  Clock,
  CheckCircle,
  XCircle,
  Loader,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Sparkles,
  Zap,
  Globe,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; glow: string }> = {
  pending: { label: "Pending", color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)", glow: "rgba(148,163,184,0.0)" },
  outlining: { label: "Creating Outline…", color: "#a78bfa", bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.25)", glow: "rgba(167,139,250,0.15)" },
  generating: { label: "Writing Chapters…", color: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.25)", glow: "rgba(96,165,250,0.15)" },
  assembling: { label: "Assembling Book…", color: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.25)", glow: "rgba(251,191,36,0.15)" },
  done: { label: "Complete", color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)", glow: "rgba(52,211,153,0.12)" },
  failed: { label: "Failed", color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.25)", glow: "rgba(248,113,113,0.0)" },
};

const STYLE_OPTIONS = [
  { value: "", label: "✦ Default", hint: "Professional & balanced" },
  { value: "academic", label: "🎓 Academic", hint: "Formal, research-oriented, citation-friendly" },
  { value: "conversational", label: "💬 Conversational", hint: "Friendly, accessible, like talking to a friend" },
  { value: "storytelling", label: "📖 Storytelling", hint: "Narrative-driven, vivid scenes, character focus" },
  { value: "technical", label: "⚙️ Technical", hint: "Precise, structured, jargon-appropriate" },
  { value: "inspirational", label: "✨ Inspirational", hint: "Motivating, uplifting, call-to-action tone" },
  { value: "humorous", label: "😄 Humorous", hint: "Light-hearted, witty, entertaining" },
  { value: "journalistic", label: "📰 Journalistic", hint: "Objective, concise, fact-forward" },
  { value: "poetic", label: "🌿 Poetic", hint: "Lyrical, metaphor-rich, literary" },
  { value: "minimalist", label: "◻ Minimalist", hint: "Sparse, direct, no fluff" },
  { value: "other", label: "\u270F\uFE0F Other", hint: "Describe your own style" },
];

const LANGUAGE_OPTIONS = [
  "English", "Hindi", "Telugu", "Tamil", "Kannada",
  "Malayalam", "Bengali", "Marathi", "Urdu", "Gujarati",
  "Punjabi", "Arabic", "Spanish", "French", "German",
  "Portuguese", "Chinese", "Japanese", "Russian",
];

interface ActiveJob {
  bookId: number;
  title: string;
  segments: number;
  status: string;
  errorMessage?: string; // user-friendly error from backend
}

export default function BooksPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [books, setBooks] = useState<BookStatus[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState(10);
  const [wpp, setWpp] = useState(200);
  const [writingStyle, setWritingStyle] = useState("");
  const [customWritingStyle, setCustomWritingStyle] = useState("");

  // ── New: description → AI title suggestion → language ───────────────────────────────────────
  const [description, setDescription] = useState("");
  const [suggestedTitles, setSuggestedTitles] = useState<string[]>([]);
  const [suggestingTitles, setSuggestingTitles] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("English");
  const [customLanguage, setCustomLanguage] = useState("");

  // ── Fetch books ─────────────────────────────────────────────────────────────
  const fetchBooks = useCallback(async (uid?: string) => {
    const targetUid = uid || auth.currentUser?.uid || "anon";
    try {
      const res = await listBooks(targetUid);
      setBooks(res.data);
    } catch { /* ignore */ }
    finally { setLoadingBooks(false); }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.push("/login");
      } else {
        setUser(u);
        fetchBooks(u.uid);
      }
    });
    return () => unsub();
  }, [router, fetchBooks]);

  // ── Poll active job ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === "done" || activeJob.status === "failed") return;

    const interval = setInterval(async () => {
      try {
        const [statusRes, progressRes] = await Promise.all([
          getBookStatus(activeJob.bookId),
          getProgress(activeJob.bookId),
        ]);
        setActiveJob((prev) =>
          prev ? {
            ...prev,
            status: statusRes.data.status,
            segments: progressRes.data.completed_segments,
            errorMessage: statusRes.data.error_message ?? prev.errorMessage,
          } : null
        );
        if (statusRes.data.status === "done" || statusRes.data.status === "failed") {
          fetchBooks();
          clearInterval(interval);
        }
      } catch { /* ignore */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeJob, fetchBooks]);

  // ── Suggest titles via Claude API ──────────────────────────────────────────
  const handleSuggestTitles = async () => {
    if (!description.trim()) return;
    setSuggestingTitles(true);
    setSuggestedTitles([]);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `You are a professional book title expert. The user wants to write: "${description.trim()}". Suggest exactly 5 compelling, marketable book titles. Respond ONLY with a valid JSON array of 5 strings, no markdown, no explanation. Example: ["Title One","Title Two","Title Three","Title Four","Title Five"]`,
          }],
        }),
      });
      const data = await res.json();
      const raw = (data.content as { text?: string }[] || [])
        .map((b) => b.text || "").join("").trim()
        .replace(/\`\`\`json|\`\`\`/g, "").trim();
      setSuggestedTitles(JSON.parse(raw));
    } catch {
      setSuggestedTitles([
        "The Path Forward", "Echoes of Tomorrow", "Minds Unbound",
        "The Hidden Blueprint", "Beyond the Threshold",
      ]);
    } finally {
      setSuggestingTitles(false);
    }
  };

  // ── Generate ────────────────────────────────────────────────────────────────
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const effectiveStyle = writingStyle === "other" ? customWritingStyle.trim() : writingStyle;
      const effectiveLang = selectedLanguage === "Other" ? customLanguage.trim() || "English" : selectedLanguage;
      const res = await generateBook({
        title,
        num_pages: pages,
        words_per_page: wpp,
        user_id: user?.uid || "anon",
        writing_style: effectiveStyle,
        language: effectiveLang,
      });
      setActiveJob({ bookId: res.data.book_id, title, segments: 0, status: "pending" });
      setShowForm(false);
      setTitle("");
      setDescription("");
      setSuggestedTitles([]);
      setWritingStyle("");
      setCustomWritingStyle("");
      setSelectedLanguage("English");
      setCustomLanguage("");
    } catch {
      setError("Failed to start generation. Make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const totalSegments = Math.ceil((pages * wpp) / 250) * 4;
  const progress = activeJob
    ? Math.min(100, Math.round((activeJob.segments / Math.max(totalSegments, 1)) * 100))
    : 0;

  const totalWords = pages * wpp;
  const estimatedTime = pages < 20 ? "5–10" : pages < 100 ? "10–20" : "20–35";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#080b14", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif", position: "relative", overflowX: "hidden" }}>

      {/* Ambient background orbs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-120px", left: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "-100px", width: "400px", height: "400px", borderRadius: "50%", background: "radial-gradient(circle, rgba(52,211,153,0.05) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", top: "40%", left: "30%", width: "600px", height: "300px", borderRadius: "50%", background: "radial-gradient(circle, rgba(96,165,250,0.04) 0%, transparent 70%)" }} />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(8,11,20,0.85)",
        backdropFilter: "blur(20px)",
        padding: "0 32px",
        height: "58px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: "none", border: "none", color: "#475569",
              fontSize: "13px", cursor: "pointer", padding: "6px 0",
              transition: "color 0.2s",
            }}
            onMouseOver={e => (e.currentTarget.style.color = "#e2e8f0")}
            onMouseOut={e => (e.currentTarget.style.color = "#475569")}
          >
            <ArrowLeft size={13} /> Dashboard
          </button>

          <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.08)" }} />

          <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            <div style={{
              width: "30px", height: "30px",
              background: "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.2))",
              border: "1px solid rgba(99,102,241,0.4)",
              borderRadius: "8px",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <BookOpen size={14} color="#a78bfa" />
            </div>
            <span style={{ fontWeight: "600", fontSize: "14px", letterSpacing: "-0.01em" }}>Book Writing</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "12px", color: "#334155" }}>{user?.email}</span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px", padding: "6px 12px",
              color: "#64748b", fontSize: "12px", cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseOver={e => { e.currentTarget.style.color = "#e2e8f0"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
            onMouseOut={e => { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </nav>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main style={{ position: "relative", zIndex: 1, maxWidth: "900px", margin: "0 auto", padding: "48px 32px 80px" }}>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "40px" }}>
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
              borderRadius: "20px", padding: "3px 12px",
              fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em",
              color: "#818cf8", marginBottom: "14px",
            }}>
              <Sparkles size={10} /> AI MANUSCRIPT STUDIO
            </div>
            <h1 style={{
              fontSize: "32px", fontWeight: "800", letterSpacing: "-0.03em",
              fontFamily: "'Playfair Display', Georgia, serif",
              lineHeight: "1.1", marginBottom: "6px",
              background: "linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              My Books
            </h1>
            <p style={{ color: "#334155", fontSize: "13px" }}>Generate and manage your AI-written manuscripts</p>
          </div>

          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: showForm
                ? "rgba(99,102,241,0.15)"
                : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              border: showForm ? "1px solid rgba(99,102,241,0.4)" : "1px solid transparent",
              borderRadius: "12px", padding: "11px 20px",
              color: "white", fontSize: "13px", fontWeight: "600",
              cursor: "pointer",
              boxShadow: showForm ? "none" : "0 4px 20px rgba(99,102,241,0.4)",
              transition: "all 0.2s",
              letterSpacing: "0.01em",
            }}
            onMouseOver={e => { if (!showForm) e.currentTarget.style.boxShadow = "0 6px 28px rgba(99,102,241,0.55)"; }}
            onMouseOut={e => { if (!showForm) e.currentTarget.style.boxShadow = "0 4px 20px rgba(99,102,241,0.4)"; }}
          >
            <Plus size={15} />
            New Book
            {showForm ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {/* ── New Book Form ───────────────────────────────────────────────────── */}
        {showForm && (
          <div style={{
            background: "rgba(15,18,32,0.9)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: "20px",
            padding: "32px",
            marginBottom: "32px",
            boxShadow: "0 0 0 1px rgba(99,102,241,0.05), 0 24px 60px rgba(0,0,0,0.4)",
            animation: "slideDown 0.25s ease",
          }}>
            {/* Form header */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" }}>
              <div style={{
                width: "36px", height: "36px",
                background: "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.15))",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: "10px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Zap size={16} color="#818cf8" />
              </div>
              <div>
                <h2 style={{ fontWeight: "700", fontSize: "16px", letterSpacing: "-0.01em" }}>Generate New Book</h2>
                <p style={{ color: "#334155", fontSize: "12px", marginTop: "1px" }}>Configure your manuscript parameters</p>
              </div>
            </div>

            <form onSubmit={handleGenerate}>

              {/* ── STEP 1: Describe ── */}
              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", marginBottom: "8px" }}>
                  Step 1 — Describe what you want to write
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. A thriller about an AI that gains consciousness, or a self-help book on building better habits…"
                  rows={3}
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px", padding: "13px 16px",
                    fontSize: "14px", color: "#e2e8f0",
                    outline: "none", resize: "vertical", lineHeight: "1.6",
                    fontFamily: "inherit", boxSizing: "border-box",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "rgba(99,102,241,0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.1)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                  <button
                    type="button"
                    onClick={handleSuggestTitles}
                    disabled={suggestingTitles || description.trim().length < 5}
                    style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      background: "rgba(167,139,250,0.12)",
                      border: "1px solid rgba(167,139,250,0.25)",
                      borderRadius: "10px", padding: "8px 16px",
                      color: "#a78bfa", fontSize: "12px", fontWeight: "600",
                      cursor: suggestingTitles || description.trim().length < 5 ? "not-allowed" : "pointer",
                      opacity: description.trim().length < 5 ? 0.45 : 1,
                      transition: "all 0.15s",
                    }}
                  >
                    {suggestingTitles
                      ? <><Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> Thinking…</>
                      : suggestedTitles.length > 0
                        ? <><RefreshCw size={12} /> Regenerate titles</>
                        : <><Sparkles size={12} /> Suggest titles &amp; chapters</>
                    }
                  </button>
                </div>
              </div>

              {/* ── STEP 2: Suggested Titles ── */}
              {suggestedTitles.length > 0 && (
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", marginBottom: "10px" }}>
                    Step 2 — Suggested titles
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                    {suggestedTitles.map((t) => {
                      const isSelected = title === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTitle(t)}
                          style={{
                            padding: "7px 14px",
                            borderRadius: "20px",
                            fontSize: "13px", fontWeight: "500",
                            border: isSelected ? "1px solid rgba(167,139,250,0.6)" : "1px solid rgba(255,255,255,0.09)",
                            background: isSelected ? "rgba(167,139,250,0.18)" : "rgba(255,255,255,0.03)",
                            color: isSelected ? "#c4b5fd" : "#64748b",
                            cursor: "pointer",
                            boxShadow: isSelected ? "0 0 12px rgba(167,139,250,0.2)" : "none",
                            transition: "all 0.15s",
                          }}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── STEP 3: Book Title (final) ── */}
              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", marginBottom: "8px" }}>
                  Step 3 — {suggestedTitles.length > 0 ? "Put any suggested title or write your own" : "Book Title"}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  required
                  placeholder="e.g. The Art of Leadership"
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px", padding: "13px 16px",
                    fontSize: "14px", color: "#e2e8f0",
                    outline: "none", transition: "border-color 0.2s, box-shadow 0.2s",
                    boxSizing: "border-box",
                  }}
                  onFocus={e => { e.target.style.borderColor = "rgba(99,102,241,0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.1)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
                />
              </div>

              {/* ── Output Language ── */}
              <div style={{ marginBottom: "24px" }}>
                <label style={{ display: "block", fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", marginBottom: "10px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <Globe size={11} /> Output language
                    <span style={{ color: "#1e293b", fontSize: "10px", fontWeight: "400", textTransform: "none", letterSpacing: "0", marginLeft: "4px" }}>
                      — book will be written in this language
                    </span>
                  </span>
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                  {LANGUAGE_OPTIONS.map((lang) => {
                    const isSelected = selectedLanguage === lang;
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setSelectedLanguage(lang)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: "8px",
                          fontSize: "12px", fontWeight: "500",
                          border: isSelected ? "1px solid rgba(96,165,250,0.6)" : "1px solid rgba(255,255,255,0.07)",
                          background: isSelected ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.03)",
                          color: isSelected ? "#93c5fd" : "#64748b",
                          cursor: "pointer",
                          boxShadow: isSelected ? "0 0 10px rgba(96,165,250,0.18)" : "none",
                          transition: "all 0.15s",
                        }}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
                {selectedLanguage === "Other" && (
                  <input
                    type="text"
                    value={customLanguage}
                    onChange={e => setCustomLanguage(e.target.value)}
                    placeholder="Type your language (e.g. Swahili, Malay…)"
                    autoFocus
                    style={{
                      width: "100%", background: "rgba(96,165,250,0.05)",
                      border: "1px solid rgba(96,165,250,0.25)",
                      borderRadius: "10px", padding: "11px 14px",
                      fontSize: "13px", color: "#e2e8f0",
                      outline: "none", boxSizing: "border-box",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={e => e.target.style.borderColor = "rgba(96,165,250,0.5)"}
                    onBlur={e => e.target.style.borderColor = "rgba(96,165,250,0.25)"}
                  />
                )}
                {selectedLanguage && selectedLanguage !== "Other" && (
                  <p style={{ color: "#334155", fontSize: "11px", marginTop: "6px" }}>
                    Book will be written entirely in <span style={{ color: "#60a5fa", fontWeight: "600" }}>{selectedLanguage}</span>.
                  </p>
                )}
              </div>

              {/* ── Writing Style ── */}
              <div style={{ marginBottom: "24px" }}>
                <label style={{
                  display: "block", fontSize: "11px", fontWeight: "700",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "#475569", marginBottom: "10px",
                }}>
                  Writing Style
                  <span style={{ color: "#1e293b", fontSize: "10px", fontWeight: "400", marginLeft: "8px", textTransform: "none", letterSpacing: "0" }}>
                    (hover for details)
                  </span>
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                  {STYLE_OPTIONS.map(({ value, label, hint }) => {
                    const selected = writingStyle === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        title={hint}
                        onClick={() => setWritingStyle(value)}
                        style={{
                          padding: "6px 13px",
                          borderRadius: "8px",
                          fontSize: "12px", fontWeight: "500",
                          border: selected ? "1px solid rgba(99,102,241,0.6)" : "1px solid rgba(255,255,255,0.07)",
                          background: selected ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.03)",
                          color: selected ? "#a5b4fc" : "#64748b",
                          cursor: "pointer", whiteSpace: "nowrap",
                          transition: "all 0.15s",
                          boxShadow: selected ? "0 0 12px rgba(99,102,241,0.2)" : "none",
                        }}
                        onMouseOver={e => { if (!selected) { e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)"; e.currentTarget.style.color = "#94a3b8"; } }}
                        onMouseOut={e => { if (!selected) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#64748b"; } }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {writingStyle === "other" && (
                  <div style={{ marginTop: "12px" }}>
                    <input
                      type="text"
                      value={customWritingStyle}
                      onChange={e => setCustomWritingStyle(e.target.value)}
                      placeholder="e.g. Socratic dialogue, stream of consciousness, epistolary…"
                      autoFocus
                      style={{
                        width: "100%", background: "rgba(99,102,241,0.05)",
                        border: "1px solid rgba(99,102,241,0.25)",
                        borderRadius: "10px", padding: "11px 14px",
                        fontSize: "13px", color: "#e2e8f0",
                        outline: "none", transition: "border-color 0.2s",
                        boxSizing: "border-box",
                      }}
                      onFocus={e => e.target.style.borderColor = "rgba(99,102,241,0.5)"}
                      onBlur={e => e.target.style.borderColor = "rgba(99,102,241,0.25)"}
                    />
                    <p style={{ color: "#334155", fontSize: "11px", marginTop: "6px" }}>
                      Describe any style — AI will interpret and apply it throughout.
                    </p>
                  </div>
                )}

                {writingStyle && writingStyle !== "other" && (
                  <p style={{ color: "#334155", fontSize: "11px", marginTop: "8px" }}>
                    Writing in a <span style={{ color: "#818cf8", fontWeight: "600" }}>{writingStyle}</span> style throughout.
                  </p>
                )}
              </div>

              {/* ── Sliders ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <label style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569" }}>Pages</label>
                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "22px", fontWeight: "700", color: "#a78bfa", letterSpacing: "-0.02em" }}>{pages}</span>
                  </div>
                  <input type="range" min={5} max={200} step={5} value={pages} onChange={e => setPages(Number(e.target.value))} style={{ width: "100%", accentColor: "#6366f1" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#334155", marginTop: "4px" }}>
                    <span>5</span><span>200</span>
                  </div>
                </div>

                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <label style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569" }}>Words / Page</label>
                    <span style={{ fontFamily: "'Playfair Display', serif", fontSize: "22px", fontWeight: "700", color: "#60a5fa", letterSpacing: "-0.02em" }}>{wpp}</span>
                  </div>
                  <input type="range" min={150} max={300} step={10} value={wpp} onChange={e => setWpp(Number(e.target.value))} style={{ width: "100%", accentColor: "#6366f1" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#334155", marginTop: "4px" }}>
                    <span>150</span><span>300</span>
                  </div>
                </div>
              </div>

              {/* ── Estimate strip ── */}
              <div style={{
                display: "flex", gap: "0",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "12px", overflow: "hidden",
                marginBottom: "24px",
              }}>
                {[
                  { label: "Total Words", value: totalWords.toLocaleString() },
                  { label: "Sections", value: `~${Math.ceil((pages * wpp) / 250) * 4}` },
                  { label: "Est. Time", value: `~${estimatedTime} min` },
                ].map((stat, i) => (
                  <div key={stat.label} style={{ flex: 1, padding: "14px 16px", textAlign: "center", borderRight: i < 2 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                    <div style={{ fontSize: "15px", fontWeight: "700", color: "#e2e8f0", fontFamily: "'Playfair Display', serif", letterSpacing: "-0.01em" }}>{stat.value}</div>
                    <div style={{ fontSize: "10px", color: "#334155", fontWeight: "600", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: "3px" }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* ── Error ── */}
              {error && (
                <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "10px", padding: "12px 14px", color: "#f87171", fontSize: "13px", marginBottom: "20px" }}>
                  {error}
                </div>
              )}

              {/* ── Actions ── */}
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="submit"
                  disabled={loading || !title.trim()}
                  style={{
                    flex: 1,
                    background: loading || !title.trim()
                      ? "rgba(99,102,241,0.3)"
                      : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                    border: "none", borderRadius: "12px",
                    padding: "13px 24px",
                    color: "white", fontSize: "14px", fontWeight: "700",
                    cursor: loading || !title.trim() ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    boxShadow: loading || !title.trim() ? "none" : "0 4px 20px rgba(99,102,241,0.4)",
                    transition: "all 0.2s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {loading ? (
                    <><Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> Starting…</>
                  ) : (
                    <><Sparkles size={15} /> Generate Book</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px", padding: "13px 20px",
                    color: "#64748b", fontSize: "13px", fontWeight: "500",
                    cursor: "pointer", transition: "all 0.2s",
                  }}
                  onMouseOver={e => { e.currentTarget.style.color = "#e2e8f0"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                  onMouseOut={e => { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Active Job Banner ───────────────────────────────────────────────── */}
        {activeJob && activeJob.status !== "done" && (() => {

          // ── FAILED: friendly error card ──────────────────────────────────────
          if (activeJob.status === "failed") {
            return (
              <div style={{
                background: "rgba(248,113,113,0.07)",
                border: "1px solid rgba(248,113,113,0.22)",
                borderRadius: "16px",
                padding: "20px 24px",
                marginBottom: "28px",
                display: "flex",
                alignItems: "flex-start",
                gap: "14px",
                animation: "fadeInUp 0.3s ease",
              }}>
                <div style={{
                  width: "40px", height: "40px", flexShrink: 0,
                  background: "rgba(248,113,113,0.12)",
                  border: "1px solid rgba(248,113,113,0.25)",
                  borderRadius: "11px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <AlertTriangle size={18} color="#f87171" />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: "700", fontSize: "14px", color: "#fca5a5", marginBottom: "5px", letterSpacing: "-0.01em" }}>
                    "{activeJob.title}" couldn't be generated
                  </p>
                  <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: "1.65" }}>
                    {activeJob.errorMessage ?? "Something went wrong while generating your book. Please try again."}
                  </p>
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button
                      onClick={() => { setShowForm(true); setActiveJob(null); }}
                      style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "8px", padding: "7px 14px", color: "#a5b4fc", fontSize: "12px", fontWeight: "600", cursor: "pointer", transition: "all 0.15s" }}
                      onMouseOver={e => e.currentTarget.style.background = "rgba(99,102,241,0.25)"}
                      onMouseOut={e => e.currentTarget.style.background = "rgba(99,102,241,0.15)"}
                    >
                      <RefreshCw size={12} /> Try Again
                    </button>
                    <button
                      onClick={() => setActiveJob(null)}
                      style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "7px 14px", color: "#64748b", fontSize: "12px", cursor: "pointer", transition: "all 0.15s" }}
                      onMouseOver={e => e.currentTarget.style.color = "#e2e8f0"}
                      onMouseOut={e => e.currentTarget.style.color = "#64748b"}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // ── IN PROGRESS ───────────────────────────────────────────────────────
          const meta = STATUS_META[activeJob.status] || STATUS_META.pending;
          return (
            <div style={{
              background: `linear-gradient(135deg, ${meta.bg}, rgba(8,11,20,0.6))`,
              border: `1px solid ${meta.border}`,
              borderRadius: "16px",
              padding: "20px 24px",
              marginBottom: "28px",
              boxShadow: `0 0 40px ${meta.glow}`,
              animation: "fadeInUp 0.3s ease",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <div style={{
                  width: "36px", height: "36px",
                  background: `${meta.color}18`,
                  border: `1px solid ${meta.color}33`,
                  borderRadius: "10px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Loader size={15} style={{ color: meta.color, animation: "spin 1.2s linear infinite" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: "600", fontSize: "14px", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {activeJob.title}
                  </p>
                  <p style={{ fontSize: "12px", color: meta.color, marginTop: "2px", fontWeight: "500" }}>
                    {meta.label}
                  </p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span style={{
                    fontFamily: "'Playfair Display', serif", fontSize: "24px", fontWeight: "700",
                    color: meta.color, letterSpacing: "-0.02em",
                  }}>{progress}%</span>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden", marginBottom: "10px" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.max(4, progress)}%`,
                  background: `linear-gradient(90deg, ${meta.color}99, ${meta.color})`,
                  borderRadius: "4px",
                  transition: "width 0.6s ease",
                  boxShadow: `0 0 8px ${meta.color}66`,
                }} />
              </div>

              {/* Step indicators */}
              <div style={{ display: "flex", gap: "6px" }}>
                {["pending", "outlining", "generating", "assembling", "done"].map((step, i) => {
                  const steps = ["pending", "outlining", "generating", "assembling", "done"];
                  const currentIdx = steps.indexOf(activeJob.status);
                  const isDone = i < currentIdx;
                  const isActive = i === currentIdx;
                  return (
                    <div key={step} style={{
                      flex: 1, height: "3px", borderRadius: "3px",
                      background: isDone ? meta.color : isActive ? `${meta.color}66` : "rgba(255,255,255,0.06)",
                      transition: "background 0.4s",
                    }} />
                  );
                })}
              </div>

              <p style={{ fontSize: "11px", color: "#334155", marginTop: "10px" }}>
                {activeJob.segments} sections written of ~{totalSegments}
              </p>
            </div>
          );
        })()}

        {/* ── Books List ──────────────────────────────────────────────────────── */}
        {loadingBooks ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{
              width: "48px", height: "48px", margin: "0 auto 16px",
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
              borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Loader size={20} color="#818cf8" style={{ animation: "spin 1s linear infinite" }} />
            </div>
            <p style={{ color: "#334155", fontSize: "13px" }}>Loading your manuscripts…</p>
          </div>

        ) : books.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "80px 0",
            background: "rgba(255,255,255,0.01)",
            border: "1px dashed rgba(255,255,255,0.06)",
            borderRadius: "20px",
          }}>
            <div style={{
              width: "64px", height: "64px", margin: "0 auto 20px",
              background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)",
              borderRadius: "18px", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <BookOpen size={28} color="#6366f1" style={{ opacity: 0.5 }} />
            </div>
            <p style={{ fontSize: "16px", fontWeight: "600", color: "#64748b", marginBottom: "6px", fontFamily: "'Playfair Display', serif" }}>
              No manuscripts yet
            </p>
            <p style={{ fontSize: "13px", color: "#334155" }}>Click "New Book" above to generate your first AI manuscript</p>
          </div>

        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* List header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              paddingBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.05)",
              marginBottom: "4px",
            }}>
              <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", color: "#334155" }}>
                {books.length} Manuscript{books.length !== 1 ? "s" : ""}
              </span>
              <span style={{ fontSize: "11px", color: "#1e293b" }}>
                {books.filter(b => b.status === "done").length} complete
              </span>
            </div>

            {books.map((book, idx) => {
              const meta = STATUS_META[book.status] || STATUS_META.pending;
              const isComplete = book.status === "done";
              const isFailed = book.status === "failed";
              const isActive = ["generating", "assembling", "outlining"].includes(book.status);

              return (
                <div
                  key={book.book_id}
                  style={{
                    background: isComplete
                      ? "linear-gradient(135deg, rgba(52,211,153,0.04), rgba(15,18,32,0.6))"
                      : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isComplete ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.06)"}`,
                    borderRadius: "14px",
                    padding: "18px 20px",
                    transition: "all 0.2s",
                    animation: `fadeInUp 0.3s ease ${idx * 0.04}s both`,
                    position: "relative",
                    overflow: "hidden",
                  }}
                  onMouseOver={e => {
                    const el = e.currentTarget;
                    el.style.borderColor = isComplete ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.1)";
                    el.style.transform = "translateY(-1px)";
                    el.style.boxShadow = `0 8px 32px rgba(0,0,0,0.3)`;
                  }}
                  onMouseOut={e => {
                    const el = e.currentTarget;
                    el.style.borderColor = isComplete ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.06)";
                    el.style.transform = "translateY(0)";
                    el.style.boxShadow = "none";
                  }}
                >
                  {/* Active pulse line */}
                  {isActive && (
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: "2px",
                      background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
                      animation: "shimmer 2s ease infinite",
                    }} />
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    {/* Book icon */}
                    <div style={{
                      width: "42px", height: "42px", flexShrink: 0,
                      background: isComplete
                        ? "rgba(52,211,153,0.1)"
                        : isFailed
                          ? "rgba(248,113,113,0.08)"
                          : "rgba(255,255,255,0.04)",
                      border: `1px solid ${isComplete ? "rgba(52,211,153,0.2)" : isFailed ? "rgba(248,113,113,0.15)" : "rgba(255,255,255,0.07)"}`,
                      borderRadius: "11px",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isComplete
                        ? <CheckCircle size={18} color="#34d399" />
                        : isFailed
                          ? <XCircle size={18} color="#f87171" />
                          : <FileText size={18} color="#475569" />
                      }
                    </div>

                    {/* Title & date */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontWeight: "600", fontSize: "14px",
                        letterSpacing: "-0.01em",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        color: isComplete ? "#f1f5f9" : "#94a3b8",
                        marginBottom: "3px",
                      }}>
                        {book.title}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "11px", color: "#1e293b" }}>
                          {new Date(book.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                        {isActive && (
                          <span style={{
                            fontSize: "10px", color: meta.color,
                            display: "flex", alignItems: "center", gap: "4px",
                            fontWeight: "600",
                          }}>
                            <span style={{
                              width: "6px", height: "6px", borderRadius: "50%",
                              background: meta.color, display: "inline-block",
                              animation: "pulse 1.5s ease infinite",
                            }} />
                            {meta.label}
                          </span>
                        )}
                      </div>

                      {/* ── Friendly error message on failed book cards ── */}
                      {isFailed && book.error_message && (
                        <div style={{
                          display: "flex", alignItems: "flex-start", gap: "6px",
                          marginTop: "8px", padding: "8px 10px",
                          background: "rgba(248,113,113,0.06)",
                          border: "1px solid rgba(248,113,113,0.15)",
                          borderRadius: "8px",
                        }}>
                          <AlertTriangle size={12} color="#f87171" style={{ flexShrink: 0, marginTop: "1px" }} />
                          <p style={{ fontSize: "12px", color: "#fca5a5", lineHeight: "1.5", margin: 0 }}>
                            {book.error_message}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Status + Downloads */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                      {!isActive && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: "5px",
                          fontSize: "11px", fontWeight: "600",
                          padding: "4px 10px", borderRadius: "20px",
                          background: meta.bg, border: `1px solid ${meta.border}`,
                          color: meta.color, letterSpacing: "0.02em",
                        }}>
                          {book.status === "done" && <CheckCircle size={11} />}
                          {book.status === "failed" && <XCircle size={11} />}
                          {book.status === "pending" && <Clock size={11} />}
                          {meta.label}
                        </span>
                      )}

                      {isComplete && (
                        <div style={{ display: "flex", gap: "6px" }}>
                          <a
                            href={downloadPDF(book.book_id)}
                            target="_blank" rel="noopener noreferrer"
                            style={{
                              display: "flex", alignItems: "center", gap: "5px",
                              background: "rgba(239,68,68,0.1)",
                              border: "1px solid rgba(239,68,68,0.2)",
                              borderRadius: "8px", padding: "6px 12px",
                              color: "#f87171", fontSize: "12px", fontWeight: "600",
                              textDecoration: "none", transition: "all 0.15s",
                            }}
                            onMouseOver={e => { e.currentTarget.style.background = "rgba(239,68,68,0.18)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)"; }}
                            onMouseOut={e => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.2)"; }}
                          >
                            <Download size={11} /> PDF
                          </a>
                          <a
                            href={downloadDOCX(book.book_id)}
                            target="_blank" rel="noopener noreferrer"
                            style={{
                              display: "flex", alignItems: "center", gap: "5px",
                              background: "rgba(96,165,250,0.1)",
                              border: "1px solid rgba(96,165,250,0.2)",
                              borderRadius: "8px", padding: "6px 12px",
                              color: "#60a5fa", fontSize: "12px", fontWeight: "600",
                              textDecoration: "none", transition: "all 0.15s",
                            }}
                            onMouseOver={e => { e.currentTarget.style.background = "rgba(96,165,250,0.18)"; e.currentTarget.style.borderColor = "rgba(96,165,250,0.35)"; }}
                            onMouseOut={e => { e.currentTarget.style.background = "rgba(96,165,250,0.1)"; e.currentTarget.style.borderColor = "rgba(96,165,250,0.2)"; }}
                          >
                            <Download size={11} /> DOCX
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin       { to { transform: rotate(360deg); } }
        @keyframes fadeInUp   { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideDown  { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse      { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes shimmer    { 0%,100% { opacity:0.4; } 50% { opacity:1; } }
        input::placeholder    { color: #334155; }
      `}</style>
    </div>
  );
}