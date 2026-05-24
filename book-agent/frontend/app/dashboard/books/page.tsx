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
} from "lucide-react";

const STATUS_COLOR: Record<string, string> = {
  pending: "text-slate-400 bg-slate-700/50",
  outlining: "text-blue-400 bg-blue-500/10",
  generating: "text-indigo-400 bg-indigo-500/10",
  assembling: "text-amber-400 bg-amber-500/10",
  done: "text-emerald-400 bg-emerald-500/10",
  failed: "text-red-400 bg-red-500/10",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  outlining: "Creating Outline...",
  generating: "Writing Chapters...",
  assembling: "Assembling Book...",
  done: "Complete",
  failed: "Failed",
};

interface ActiveJob {
  bookId: number;
  title: string;
  segments: number;
  status: string;
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/login");
      else setUser(u);
    });
    return () => unsub();
  }, [router]);

  const fetchBooks = useCallback(async () => {
    try {
      const res = await listBooks();
      setBooks(res.data);
    } catch {
      /* ignore */
    } finally {
      setLoadingBooks(false);
    }
  }, []);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

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
          prev
            ? {
              ...prev,
              status: statusRes.data.status,
              segments: progressRes.data.completed_segments,
            }
            : null,
        );
        if (
          statusRes.data.status === "done" ||
          statusRes.data.status === "failed"
        ) {
          fetchBooks();
          clearInterval(interval);
        }
      } catch {
        /* ignore */
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeJob, fetchBooks]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const effectiveStyle = writingStyle === "other" ? customWritingStyle.trim() : writingStyle;
      const res = await generateBook({
        title,
        num_pages: pages,
        words_per_page: wpp,
        user_id: user?.uid || "anon",
        writing_style: effectiveStyle,
      });
      setActiveJob({
        bookId: res.data.book_id,
        title,
        segments: 0,
        status: "pending",
      });
      setShowForm(false);
      setTitle("");
      setWritingStyle("");
      setCustomWritingStyle("");
    } catch {
      setError(
        "Failed to start generation. Make sure the backend is running on port 8000.",
      );
    } finally {
      setLoading(false);
    }
  };

  const totalSegments = Math.ceil((pages * wpp) / 250) * 4;
  const progress = activeJob
    ? Math.min(
      100,
      Math.round((activeJob.segments / Math.max(totalSegments, 1)) * 100),
    )
    : 0;

  return (
    <div
      className="min-h-screen bg-[#0c0f1a] text-white"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* Nav */}
      <nav className="border-b border-white/[0.07] px-10 h-[60px] flex items-center justify-between sticky top-0 bg-[#0c0f1a]/95 backdrop-blur-md z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 text-slate-500 hover:text-white text-[13px] transition-colors"
          >
            <ArrowLeft size={14} /> Dashboard
          </button>
          <span className="text-white/10">|</span>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500/20 border border-indigo-500/30 rounded-lg flex items-center justify-center">
              <BookOpen size={16} className="text-indigo-400" />
            </div>
            <span className="font-semibold text-[14px]">Book Writing</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-sm hidden sm:block">
            {user?.email}
          </span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            className="flex items-center gap-2 text-slate-500 hover:text-white text-sm transition-colors border border-white/10 rounded-lg px-3 py-1.5"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-10 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Books</h1>
            <p className="text-slate-500 text-sm mt-1">
              Generate and manage your AI-written manuscripts
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95"
          >
            <Plus size={16} /> New Book
            {showForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* New Book Form */}
        {showForm && (
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 mb-8">
            <h2 className="font-semibold text-lg mb-5">Generate New Book</h2>
            <form onSubmit={handleGenerate} className="space-y-5">
              <div>
                <label className="text-sm text-slate-400 mb-1.5 block">
                  Book Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. The Art of Leadership"
                  className="w-full bg-slate-700/50 border border-slate-600 rounded-xl py-3 px-4 text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400 mb-1.5 block">
                    Number of Pages{" "}
                    <span className="text-indigo-400 ml-2 font-medium">
                      {pages}
                    </span>
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={200}
                    step={5}
                    value={pages}
                    onChange={(e) => setPages(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>5</span>
                    <span>200</span>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-slate-400 mb-1.5 block">
                    Words per Page{" "}
                    <span className="text-indigo-400 ml-2 font-medium">
                      {wpp}
                    </span>
                  </label>
                  <input
                    type="range"
                    min={150}
                    max={300}
                    step={10}
                    value={wpp}
                    onChange={(e) => setWpp(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>150</span>
                    <span>300</span>
                  </div>
                </div>
              </div>

              {/* Writing Style */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block">
                  Writing Style{" "}
                  <span className="text-slate-600 text-xs font-normal">(default: Professional)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
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
                    { value: "other", label: "✏️ Other", hint: "Describe your own style" },
                  ].map(({ value, label, hint }) => {
                    const selected = writingStyle === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        title={hint}
                        onClick={() => setWritingStyle(value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all whitespace-nowrap ${selected
                          ? "bg-indigo-500/20 border-indigo-500 text-indigo-300"
                          : "bg-slate-700/40 border-slate-600/50 text-slate-400 hover:border-indigo-500/50 hover:text-slate-200"
                          }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {writingStyle === "other" && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={customWritingStyle}
                      onChange={(e) => setCustomWritingStyle(e.target.value)}
                      placeholder="e.g. Socratic dialogue, stream of consciousness, epistolary…"
                      autoFocus
                      className="w-full bg-indigo-500/5 border border-indigo-500/30 focus:border-indigo-500 rounded-xl py-2.5 px-4 text-sm placeholder:text-slate-500 text-slate-200 outline-none transition-colors"
                    />
                    <p className="text-xs text-slate-600 mt-1.5">
                      Describe any writing style — the AI will interpret and apply it throughout.
                    </p>
                  </div>
                )}

                {writingStyle && writingStyle !== "other" && (
                  <p className="text-xs text-slate-600 mt-2">
                    AI will write in a{" "}
                    <span className="text-indigo-400 font-medium">{writingStyle}</span>{" "}
                    style. Hover a chip to see details.
                  </p>
                )}
              </div>

              <div className="bg-slate-700/30 rounded-xl px-4 py-3 text-sm text-slate-400 flex flex-wrap gap-x-6 gap-y-1">
                <span>~{(pages * wpp).toLocaleString()} total words</span>
                <span>~{Math.ceil((pages * wpp) / 250) * 4} sections</span>
                <span>
                  ~{pages < 20 ? "5–10" : pages < 100 ? "10–20" : "20–35"} mins
                </span>
              </div>
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={loading || !title.trim()}
                  className="flex-1 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed py-3 rounded-xl font-semibold text-sm transition-all"
                >
                  {loading ? "Starting..." : "✦ Generate Book"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 border border-slate-600 hover:border-slate-400 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Active Job */}
        {activeJob &&
          activeJob.status !== "done" &&
          activeJob.status !== "failed" && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-6 mb-8">
              <div className="flex items-center gap-3 mb-4">
                <Loader size={18} className="text-indigo-400 animate-spin" />
                <div>
                  <p className="font-medium text-sm">{activeJob.title}</p>
                  <p className="text-indigo-400 text-xs">
                    {STATUS_LABEL[activeJob.status]}
                  </p>
                </div>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(5, progress)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{activeJob.segments} sections written</span>
                <span>{progress}%</span>
              </div>
            </div>
          )}

        {/* Books list */}
        {loadingBooks ? (
          <div className="text-center py-20 text-slate-500">
            <Loader
              size={32}
              className="animate-spin mx-auto mb-3 text-indigo-400"
            />
            <p>Loading your books...</p>
          </div>
        ) : books.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <BookOpen size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium text-slate-400">No books yet</p>
            <p className="text-sm mt-1">
              Click "New Book" to generate your first AI book
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {books.map((book) => (
              <div
                key={book.book_id}
                className="bg-slate-800/40 border border-slate-700/40 hover:border-slate-600/60 rounded-xl p-5 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-10 h-10 bg-slate-700/60 rounded-lg flex items-center justify-center shrink-0">
                      <FileText size={18} className="text-slate-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{book.title}</p>
                      <p className="text-slate-500 text-xs mt-0.5">
                        {new Date(book.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${STATUS_COLOR[book.status] || STATUS_COLOR.pending}`}
                    >
                      {book.status === "done" && <CheckCircle size={12} />}
                      {book.status === "failed" && <XCircle size={12} />}
                      {["generating", "assembling", "outlining"].includes(
                        book.status,
                      ) && <Loader size={12} className="animate-spin" />}
                      {book.status === "pending" && <Clock size={12} />}
                      {STATUS_LABEL[book.status] || book.status}
                    </span>
                    {book.status === "done" && (
                      <div className="flex gap-2">
                        <a
                          href={downloadPDF(book.book_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Download size={12} /> PDF
                        </a>
                        <a
                          href={downloadDOCX(book.book_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Download size={12} /> DOCX
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}