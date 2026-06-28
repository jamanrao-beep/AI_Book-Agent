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
  cancelBookGeneration,
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
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; glow: string }> = {
  pending: { label: "Pending", color: "var(--mist)", bg: "rgba(110,110,110,0.06)", border: "var(--border-mid)", glow: "transparent" },
  outlining: { label: "Creating Outline…", color: "var(--violet)", bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.18)", glow: "rgba(139,92,246,0.08)" },
  generating: { label: "Writing Chapters…", color: "var(--sapphire)", bg: "var(--sapphire-dim)", border: "var(--border-strong)", glow: "var(--sapphire-glow)" },
  assembling: { label: "Assembling Book…", color: "var(--amber)", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.18)", glow: "rgba(245,158,11,0.06)" },
  done: { label: "Complete", color: "var(--emerald)", bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.2)", glow: "rgba(16,185,129,0.06)" },
  failed: { label: "Failed", color: "var(--crimson)", bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.18)", glow: "transparent" },
};

const STYLE_OPTIONS = [
  { value: "", label: "✦ Default", hint: "Professional & balanced" },
  { value: "academic", label: "🎓 Academic", hint: "Formal, research-oriented, citation-friendly" },
  { value: "conversational", label: "💬 Conversational", hint: "Friendly, accessible, conversational" },
  { value: "storytelling", label: "📖 Storytelling", hint: "Narrative-driven, vivid scenes, character focus" },
  { value: "technical", label: "⚙️ Technical", hint: "Precise, structured, jargon-appropriate" },
  { value: "inspirational", label: "✨ Inspirational", hint: "Motivating, uplifting, call-to-action tone" },
  { value: "humorous", label: "😄 Humorous", hint: "Light-hearted, witty, entertaining" },
  { value: "journalistic", label: "📰 Journalistic", hint: "Objective, concise, fact-forward" },
  { value: "poetic", label: "🌿 Poetic", hint: "Lyrical, metaphor-rich, literary" },
  { value: "minimalist", label: "◻ Minimalist", hint: "Sparse, direct, no fluff" },
  { value: "other", label: "✍️ Other", hint: "Describe your own style" },
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
  errorMessage?: string;
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
  const [pages, setPages] = useState(50);
  const [wpp, setWpp] = useState(250);
  const [writingStyle, setWritingStyle] = useState("");
  const [customWritingStyle, setCustomWritingStyle] = useState("");

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
  const estimatedTime = pages < 20 ? "5–10" : pages < 100 ? "10–20" : pages < 350 ? "20–35" : "35–65";

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--void)",
      color: "var(--text-primary)",
      fontFamily: "'DM Sans', sans-serif",
      position: "relative",
      overflowX: "hidden",
    }}>
      <div className="grid-overlay" />

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="glass" style={{
        position: "sticky", top: 0, zIndex: 50,
        borderBottom: "1.5px solid var(--border-mid)",
        padding: "0 32px",
        height: "60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <button
            onClick={() => router.push("/dashboard")}
            className="btn-ghost"
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              fontSize: "12px", padding: "6px 12px", borderRadius: "8px"
            }}
          >
            <ArrowLeft size={13} /> Dashboard
          </button>

          <div style={{ width: "1px", height: "16px", background: "var(--border-mid)" }} />

          <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            <div style={{
              width: "28px", height: "28px",
              background: "var(--text-primary)",
              borderRadius: "6px",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <BookOpen size={14} color="var(--void)" />
            </div>
            <span style={{ fontWeight: "800", fontSize: "14px", letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
              Book Writing
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontWeight: "500" }}>{user?.email}</span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            className="btn-ghost"
            style={{
              padding: "6px 12px", borderRadius: "8px", fontSize: "12px"
            }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </nav>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: "920px", margin: "0 auto", padding: "64px 32px 96px", position: "relative", zIndex: 2 }}>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "40px" }}>
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              background: "var(--onyx)",
              border: "1.5px solid var(--border-mid)",
              borderRadius: "20px", padding: "4px 14px",
              fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em",
              color: "var(--sapphire)", marginBottom: "14px",
            }}>
              <Sparkles size={10} /> AI MANUSCRIPT STUDIO
            </div>
            <h1 className="serif" style={{
              fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em",
              lineHeight: "1.1", marginBottom: "8px",
              color: "var(--text-primary)",
            }}>
              My Books
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
              Generate and manage your AI-written manuscripts
            </p>
          </div>

          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-dark"
            style={{
              padding: "10px 20px", borderRadius: "10px", fontSize: "13px",
              background: showForm ? "var(--onyx)" : "var(--text-primary)",
              color: showForm ? "var(--text-primary)" : "var(--void)",
              borderColor: showForm ? "var(--border-strong)" : "var(--text-primary)",
            }}
          >
            <Plus size={15} />
            New Book
            {showForm ? <ChevronUp size={13} style={{ marginLeft: "4px" }} /> : <ChevronDown size={13} style={{ marginLeft: "4px" }} />}
          </button>
        </div>

        {/* ── New Book Form ───────────────────────────────────────────────────── */}
        {showForm && (
          <div className="card fade-in" style={{
            background: "var(--onyx)",
            border: "1.5px solid var(--border-mid)",
            borderRadius: "20px",
            padding: "36px",
            marginBottom: "32px",
            boxShadow: "0 15px 40px -10px rgba(37,99,235,0.06)",
          }}>
            {/* Form header */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "28px" }}>
              <div style={{
                width: "36px", height: "36px",
                background: "var(--void)",
                border: "1.5px solid var(--border-mid)",
                borderRadius: "10px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Zap size={16} color="var(--sapphire)" />
              </div>
              <div>
                <h2 className="serif" style={{
                  fontWeight: "400", fontSize: "18px",
                  color: "var(--text-primary)",
                }}>
                  Generate New Book
                </h2>
                <p style={{ color: "var(--text-tertiary)", fontSize: "12px", marginTop: "1px" }}>
                  Configure your manuscript parameters
                </p>
              </div>
            </div>

            <form onSubmit={handleGenerate}>

              {/* ── STEP 1: Describe ── */}
              <div style={{ marginBottom: "24px" }}>
                <label className="field-label" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--sapphire)" }}>
                  <span style={{
                    width: "20px", height: "20px", borderRadius: "50%",
                    background: "var(--text-primary)", color: "var(--void)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", fontWeight: "700",
                  }}>1</span>
                  Describe what you want to write
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. A mystery novel set in medieval Varanasi about an astrologer, or an ultimate self-help manual on coding habits…"
                  rows={4}
                  className="input-field"
                  style={{ resize: "vertical", lineHeight: "1.6" }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                  <button
                    type="button"
                    onClick={handleSuggestTitles}
                    disabled={suggestingTitles || description.trim().length < 5}
                    className="btn-outline"
                    style={{
                      padding: "8px 16px", borderRadius: "8px", fontSize: "12px",
                      opacity: description.trim().length < 5 ? 0.45 : 1,
                    }}
                  >
                    {suggestingTitles
                      ? <><Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> Suggesting…</>
                      : suggestedTitles.length > 0
                        ? <><RefreshCw size={12} /> Regenerate titles</>
                        : <><Sparkles size={12} /> Suggest titles</>
                    }
                  </button>
                </div>
              </div>

              {/* ── STEP 2: Suggested Titles ── */}
              {suggestedTitles.length > 0 && (
                <div style={{ marginBottom: "24px" }}>
                  <label className="field-label" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--sapphire)" }}>
                    <span style={{
                      width: "20px", height: "20px", borderRadius: "50%",
                      background: "var(--text-primary)", color: "var(--void)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: "10px", fontWeight: "700",
                    }}>2</span>
                    Select a Title Concept
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {suggestedTitles.map((t) => {
                      const isSelected = title === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTitle(t)}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "10px",
                            fontSize: "13px", fontWeight: "600",
                            border: isSelected ? "1.5px solid var(--sapphire)" : "1px solid var(--border-mid)",
                            background: isSelected ? "var(--sapphire-dim)" : "var(--onyx)",
                            color: isSelected ? "var(--sapphire)" : "var(--text-primary)",
                            cursor: "pointer",
                            transition: "all 0.2s",
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
              <div style={{ marginBottom: "24px" }}>
                <label className="field-label" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--sapphire)" }}>
                  <span style={{
                    width: "20px", height: "20px", borderRadius: "50%",
                    background: "var(--text-primary)", color: "var(--void)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", fontWeight: "700",
                  }}>3</span>
                  Final Book Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Or enter your custom title here..."
                  className="input-field"
                />
              </div>

              {/* ── STEP 4: Configuration parameters ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
                {/* Trim details */}
                <div style={{ background: "var(--void)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border-mid)" }}>
                  <label className="field-label" style={{ color: "var(--text-primary)", marginBottom: "12px" }}>Manuscript Size</label>
                  
                  <div style={{ marginBottom: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                      <span style={{ fontWeight: "600" }}>Total Pages:</span>
                      <span style={{ color: "var(--sapphire)", fontWeight: "700" }}>{pages} pages</span>
                    </div>
                    <input
                      type="range" min="5" max="1000" step="5"
                      value={pages} onChange={e => setPages(parseInt(e.target.value))}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                      <span style={{ fontWeight: "600" }}>Words Per Page:</span>
                      <span style={{ color: "var(--sapphire)", fontWeight: "700" }}>{wpp} words</span>
                    </div>
                    <input
                      type="range" min="50" max="300" step="10"
                      value={wpp} onChange={e => setWpp(parseInt(e.target.value))}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-mid)", paddingTop: "12px", marginTop: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <span style={{ fontSize: "10px", color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: "700" }}>Total Words</span>
                      <p style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>{totalWords.toLocaleString()}</p>
                    </div>
                    <div>
                      <span style={{ fontSize: "10px", color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: "700" }}>Write Time</span>
                      <p style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>~{estimatedTime} mins</p>
                    </div>
                  </div>
                </div>

                {/* Style and language options */}
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label className="field-label">Writing Tone & Style</label>
                    <select
                      value={writingStyle}
                      onChange={e => setWritingStyle(e.target.value)}
                      className="input-field"
                    >
                      {STYLE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label} — {opt.hint}
                        </option>
                      ))}
                    </select>

                    {writingStyle === "other" && (
                      <input
                        type="text" value={customWritingStyle} onChange={e => setCustomWritingStyle(e.target.value)}
                        placeholder="e.g. Victorian, cyber-noir, dense academic jargon..."
                        className="input-field" style={{ marginTop: "8px" }}
                      />
                    )}
                  </div>

                  <div>
                    <label className="field-label">Language</label>
                    <select
                      value={selectedLanguage}
                      onChange={e => setSelectedLanguage(e.target.value)}
                      className="input-field"
                    >
                      {LANGUAGE_OPTIONS.map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                      <option value="Other">✏️ Other language</option>
                    </select>

                    {selectedLanguage === "Other" && (
                      <input
                        type="text" value={customLanguage} onChange={e => setCustomLanguage(e.target.value)}
                        placeholder="e.g. Sanskrit, Icelandic..."
                        className="input-field" style={{ marginTop: "8px" }}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Error indicator */}
              {error && (
                <div style={{
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.18)",
                  borderRadius: "10px", padding: "12px 16px",
                  color: "var(--crimson)", fontSize: "13px", marginBottom: "20px"
                }}>
                  {error}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="submit"
                  disabled={loading || !title.trim()}
                  className="btn-dark"
                  style={{
                    flex: 1, justifyItems: "center", justifyContent: "center",
                    background: loading || !title.trim() ? "rgba(0,0,0,0.04)" : "var(--text-primary)",
                    color: loading || !title.trim() ? "var(--ash)" : "var(--void)",
                    border: "none", opacity: loading || !title.trim() ? 0.6 : 1,
                  }}
                >
                  {loading ? (
                    <><Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> Deploying Agent…</>
                  ) : (
                    <><Sparkles size={15} /> Generate Book</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Active Job Banner ───────────────────────────────────────────────── */}
        {activeJob && activeJob.status !== "done" && (() => {

          // FAILED Status
          if (activeJob.status === "failed") {
            return (
              <div className="card fade-in" style={{
                background: "rgba(239,68,68,0.02)",
                border: "1.5px solid rgba(239,68,68,0.18)",
                borderRadius: "16px",
                padding: "24px",
                marginBottom: "32px",
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
              }}>
                <div style={{
                  width: "40px", height: "40px", flexShrink: 0,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.15)",
                  borderRadius: "11px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <AlertTriangle size={18} color="var(--crimson)" />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 className="serif" style={{ fontWeight: "400", fontSize: "18px", color: "var(--crimson)", marginBottom: "6px" }}>
                    "{activeJob.title}" failed to generate
                  </h3>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.6" }}>
                    {activeJob.errorMessage ?? "An unexpected model error occurred during the outlining stage. Please retry."}
                  </p>
                  <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                    <button
                      onClick={() => { setShowForm(true); setActiveJob(null); }}
                      className="btn-dark"
                      style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "8px", gap: "4px" }}
                    >
                      <RefreshCw size={12} /> Try Again
                    </button>
                    <button
                      onClick={() => setActiveJob(null)}
                      className="btn-ghost"
                      style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "8px" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          // IN PROGRESS
          const meta = STATUS_META[activeJob.status] || STATUS_META.pending;
          return (
            <div className="card pulse-glow" style={{
              background: "var(--onyx)",
              border: `1.5px solid ${meta.border}`,
              borderRadius: "16px",
              padding: "24px",
              marginBottom: "32px",
              animation: "fadeInUp 0.3s ease",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "18px" }}>
                <div style={{
                  width: "36px", height: "36px",
                  background: "var(--void)",
                  border: "1.5px solid var(--border-mid)",
                  borderRadius: "10px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Loader size={15} style={{ color: meta.color, animation: "spin 1.2s linear infinite" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 className="serif" style={{ fontWeight: "400", fontSize: "18px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>
                    {activeJob.title}
                  </h3>
                  <p style={{ fontSize: "12px", color: meta.color, marginTop: "2px", fontWeight: "700", letterSpacing: "0.02em", textTransform: "uppercase" }}>
                    {meta.label}
                  </p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span className="serif" style={{ fontSize: "28px", fontWeight: "400", color: "var(--text-primary)" }}>{progress}%</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="progress-bar" style={{ marginBottom: "14px" }}>
                <div className="progress-fill" style={{ width: `${Math.max(4, progress)}%`, background: meta.color }} />
              </div>

              {/* Steps indicators */}
              <div style={{ display: "flex", gap: "6px" }}>
                {["pending", "outlining", "generating", "assembling", "done"].map((step, i) => {
                  const steps = ["pending", "outlining", "generating", "assembling", "done"];
                  const currentIdx = steps.indexOf(activeJob.status);
                  const isDone = i < currentIdx;
                  const isActive = i === currentIdx;
                  return (
                    <div key={step} style={{
                      flex: 1, height: "3px", borderRadius: "3px",
                      background: isDone ? meta.color : isActive ? `${meta.color}55` : "var(--graphite)",
                      transition: "background 0.4s",
                    }} />
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                  {activeJob.segments} sections compiled of ~{totalSegments} total
                </p>
                <button
                  onClick={async () => {
                    try {
                      await cancelBookGeneration(activeJob.book_id);
                      loadBooks(); // refresh list
                    } catch (e: any) {
                      alert(e.message || "Failed to cancel");
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    background: "rgba(239, 68, 68, 0.1)", color: "var(--crimson)",
                    border: "1px solid rgba(239, 68, 68, 0.2)", padding: "6px 12px", borderRadius: "6px",
                    fontSize: "12px", fontWeight: "600", cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = "rgba(239, 68, 68, 0.2)"}
                  onMouseOut={(e) => e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)"}
                >
                  <XCircle size={14} /> Cancel Generation
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Books List ──────────────────────────────────────────────────────── */}
        {loadingBooks ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{
              width: "48px", height: "48px", margin: "0 auto 16px",
              background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
              borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Loader size={20} color="var(--sapphire)" style={{ animation: "spin 1.2s linear infinite" }} />
            </div>
            <p style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>Querying manuscripts…</p>
          </div>

        ) : books.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "80px 0",
            background: "var(--onyx)",
            border: "1.5px dashed var(--border-strong)",
            borderRadius: "20px",
          }}>
            <div style={{
              width: "64px", height: "64px", margin: "0 auto 20px",
              background: "var(--void)", border: "1.5px solid var(--border-mid)",
              borderRadius: "18px", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <BookOpen size={28} color="var(--sapphire)" style={{ opacity: 0.6 }} />
            </div>
            <p className="serif" style={{ fontSize: "20px", color: "var(--text-primary)", marginBottom: "6px" }}>
              No manuscripts yet
            </p>
            <p style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
              Click "New Book" above to prompt your first AI writing model.
            </p>
          </div>

        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* List header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              paddingBottom: "12px", borderBottom: "1.5px solid var(--border-mid)",
              marginBottom: "8px",
            }}>
              <span className="field-label" style={{ margin: 0, color: "var(--sapphire)" }}>
                {books.length} Manuscript{books.length !== 1 ? "s" : ""}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontWeight: "600" }}>
                {books.filter(b => b.status === "done").length} ready for print
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
                  className="card"
                  style={{
                    background: "var(--onyx)",
                    border: `1.5px solid ${isComplete ? "rgba(16,185,129,0.18)" : "var(--border-mid)"}`,
                    borderRadius: "16px",
                    padding: "20px 24px",
                    transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                    animation: `fadeInUp 0.3s ease ${idx * 0.04}s both`,
                    position: "relative",
                    overflow: "hidden",
                  }}
                  onMouseOver={e => {
                    const el = e.currentTarget;
                    el.style.borderColor = isComplete ? "var(--emerald)" : "var(--border-strong)";
                    el.style.transform = "translateY(-2px)";
                    el.style.boxShadow = "0 12px 30px -8px rgba(37,99,235,0.08)";
                  }}
                  onMouseOut={e => {
                    const el = e.currentTarget;
                    el.style.borderColor = isComplete ? "rgba(16,185,129,0.18)" : "var(--border-mid)";
                    el.style.transform = "translateY(0)";
                    el.style.boxShadow = "none";
                  }}
                >
                  {/* Top shimmer accent for executing agents */}
                  {isActive && (
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: "2px",
                      background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`,
                      animation: "pulse 2s ease infinite",
                    }} />
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    {/* Book status indicator icon */}
                    <div style={{
                      width: "42px", height: "42px", flexShrink: 0,
                      background: "var(--void)",
                      border: "1.5px solid var(--border-mid)",
                      borderRadius: "10px",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isComplete
                        ? <CheckCircle size={18} color="var(--emerald)" />
                        : isFailed
                          ? <XCircle size={18} color="var(--crimson)" />
                          : <FileText size={18} color="var(--text-tertiary)" />
                      }
                    </div>

                    {/* Title & metadata */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 className="serif" style={{
                        fontSize: "17px",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        color: "var(--text-primary)",
                        marginBottom: "4px",
                      }}>
                        {book.title}
                      </h4>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontWeight: "600" }}>
                          {new Date(book.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                        {isActive && (
                          <span style={{
                            fontSize: "11px", color: meta.color,
                            display: "inline-flex", alignItems: "center", gap: "5px",
                            fontWeight: "700",
                          }}>
                            <span style={{
                              width: "6px", height: "6px", borderRadius: "50%",
                              background: meta.color, display: "inline-block",
                              animation: "pulse 1.2s ease infinite",
                            }} />
                            {meta.label}
                          </span>
                        )}
                      </div>

                      {/* Error trace on card */}
                      {isFailed && book.error_message && (
                        <div style={{
                          display: "flex", alignItems: "flex-start", gap: "6px",
                          marginTop: "10px", padding: "8px 12px",
                          background: "rgba(239,68,68,0.04)",
                          border: "1px solid rgba(239,68,68,0.15)",
                          borderRadius: "8px",
                        }}>
                          <AlertTriangle size={12} color="var(--crimson)" style={{ flexShrink: 0, marginTop: "2px" }} />
                          <p style={{ fontSize: "12px", color: "var(--crimson)", lineHeight: "1.5", margin: 0 }}>
                            {book.error_message}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Badges / Download lists */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                      {!isActive && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: "5px",
                          fontSize: "11px", fontWeight: "700",
                          padding: "4px 10px", borderRadius: "20px",
                          background: meta.bg, border: `1.5px solid ${meta.border}`,
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
                            className="btn-dark"
                            style={{
                              padding: "6px 12px", fontSize: "12px", borderRadius: "8px", textDecoration: "none"
                            }}
                          >
                            <Download size={11} /> PDF
                          </a>
                          <a
                            href={downloadDOCX(book.book_id)}
                            target="_blank" rel="noopener noreferrer"
                            className="btn-outline"
                            style={{
                              padding: "6px 12px", fontSize: "12px", borderRadius: "8px", textDecoration: "none"
                            }}
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
    </div>
  );
}
