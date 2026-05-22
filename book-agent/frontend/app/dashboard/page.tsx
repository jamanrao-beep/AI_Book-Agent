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

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [books, setBooks] = useState<BookStatus[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [error, setError] = useState("");

  // Form state
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState(10);
  const [wpp, setWpp] = useState(200);

  // Auth guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/login");
      else setUser(u);
    });
    return () => unsub();
  }, [router]);

  // Load books
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

  // Poll active job
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
      const res = await generateBook({
        title,
        num_pages: pages,
        words_per_page: wpp,
        user_id: user?.uid || "anon",
      });
      setActiveJob({
        bookId: res.data.book_id,
        title,
        segments: 0,
        status: "pending",
      });
      setShowForm(false);
      setTitle("");
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
    <div className="min-h-screen bg-[#0f172a] text-white">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <BookOpen size={18} />
            </div>
            <span className="font-semibold">BookAgent AI</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 text-sm hidden sm:block">
              {user?.email}
            </span>
            <button
              onClick={() => logout().then(() => router.push("/login"))}
              className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Books</h1>
            <p className="text-slate-400 text-sm mt-1">
              Generate and manage your AI-written books
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-105 active:scale-95"
          >
            <Plus size={16} />
            New Book
            {showForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* New Book Form */}
        {showForm && (
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 mb-8 fade-in">
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
                    Number of Pages
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
                    Words per Page
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

              {/* Estimate */}
              <div className="bg-slate-700/30 rounded-xl px-4 py-3 text-sm text-slate-400 flex flex-wrap gap-x-6 gap-y-1">
                <span>~{(pages * wpp).toLocaleString()} total words</span>
                <span>
                  ~{Math.ceil((pages * wpp) / 250) * 4} sections to generate
                </span>
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

        {/* Active Job Progress */}
        {activeJob &&
          activeJob.status !== "done" &&
          activeJob.status !== "failed" && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-6 mb-8 fade-in">
              <div className="flex items-center gap-3 mb-4">
                <Loader size={18} className="text-indigo-400 animate-spin" />
                <div>
                  <p className="font-medium text-sm">{activeJob.title}</p>
                  <p className="text-indigo-400 text-xs">
                    {STATUS_LABEL[activeJob.status]}
                  </p>
                </div>
              </div>
              {/* Progress bar */}
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full shimmer rounded-full transition-all duration-500"
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
                    {/* Status badge */}
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${STATUS_COLOR[book.status] || STATUS_COLOR.pending}`}
                    >
                      {book.status === "done" && <CheckCircle size={12} />}
                      {book.status === "failed" && <XCircle size={12} />}
                      {book.status === "generating" && (
                        <Loader size={12} className="animate-spin" />
                      )}
                      {book.status === "assembling" && (
                        <Loader size={12} className="animate-spin" />
                      )}
                      {book.status === "outlining" && (
                        <Loader size={12} className="animate-spin" />
                      )}
                      {book.status === "pending" && <Clock size={12} />}
                      {STATUS_LABEL[book.status] || book.status}
                    </span>

                    {/* Download buttons */}
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
