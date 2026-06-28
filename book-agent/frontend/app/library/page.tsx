"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { listBooks, downloadPDF, downloadDOCX, BookStatus } from "@/lib/api";
import {
    ArrowLeft,
    Library,
    BookOpen,
    Download,
    Clock,
    CheckCircle,
    Loader,
    XCircle,
    Search,
    ChevronRight,
    X,
    LayoutGrid,
    AlignJustify,
} from "lucide-react";

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
    pending: { label: "Pending", color: "var(--mist)", bg: "rgba(110,110,110,0.06)", border: "var(--border-mid)" },
    outlining: { label: "Outlining", color: "var(--violet)", bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.18)" },
    generating: { label: "Writing", color: "var(--sapphire)", bg: "var(--sapphire-dim)", border: "var(--border-strong)" },
    assembling: { label: "Assembling", color: "var(--amber)", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.18)" },
    done: { label: "Complete", color: "var(--emerald)", bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.2)" },
    failed: { label: "Failed", color: "var(--crimson)", bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.18)" },
};

export default function LibraryPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [books, setBooks] = useState<BookStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<"all" | "done" | "generating" | "failed">("all");
    const [viewMode, setViewMode] = useState<"bookshelf" | "list">("bookshelf");
    const [selectedBook, setSelectedBook] = useState<BookStatus | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) { router.push("/login"); return; }
            setUser(u);
            try {
                const res = await listBooks(u.uid);
                setBooks(res.data);
            } catch { /* ignore */ }
            finally { setLoading(false); }
        });
        return () => unsub();
    }, [router]);

    const filtered = books.filter(b => {
        const matchSearch = b.title.toLowerCase().includes(search.toLowerCase());
        const matchFilter = filter === "all" ? true : b.status === filter;
        return matchSearch && matchFilter;
    });

    const counts = {
        all: books.length,
        done: books.filter(b => b.status === "done").length,
        generating: books.filter(b => ["generating", "outlining", "assembling", "pending"].includes(b.status)).length,
        failed: books.filter(b => b.status === "failed").length,
    };

    return (
        <div style={{ minHeight: "100vh", background: "var(--void)", fontFamily: "'DM Sans', sans-serif", color: "var(--text-primary)", position: "relative", display: "flex", flexDirection: "column" }}>
            <div className="grid-overlay" />

            {/* Nav */}
            <nav className="glass" style={{
                borderBottom: "1.5px solid var(--border-mid)",
                padding: "0 40px", height: "60px",
                display: "flex", alignItems: "center", gap: "16px",
                position: "sticky", top: 0, zIndex: 50,
            }}>
                <button
                    onClick={() => router.push("/dashboard")}
                    className="btn-ghost"
                    style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "6px 12px", fontSize: "12px", borderRadius: "8px"
                    }}
                >
                    <ArrowLeft size={13} /> Dashboard
                </button>
                <span style={{ color: "var(--border-mid)" }}>|</span>
                <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <div style={{
                        width: "28px", height: "28px",
                        background: "var(--text-primary)",
                        borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Library size={14} color="var(--void)" />
                    </div>
                    <span style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>My Library</span>
                </div>
            </nav>

            <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden" }}>
                
                {/* Main panel shelf */}
                <main style={{ flex: 1, padding: "48px 40px", overflowY: "auto", position: "relative", zIndex: 2 }}>
                    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
                        
                        {/* Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "40px" }}>
                            <div>
                                <h1 className="serif" style={{ fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
                                    Your Library
                                </h1>
                                <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
                                    All your manuscripts and generated works, organized in one place.
                                </p>
                            </div>

                            {/* View toggle */}
                            <div style={{ display: "flex", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "10px", padding: "4px", gap: "4px" }}>
                                <button onClick={() => setViewMode("bookshelf")} style={{ background: viewMode === "bookshelf" ? "var(--void)" : "transparent", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", color: "var(--text-primary)" }}>
                                    <LayoutGrid size={14} />
                                </button>
                                <button onClick={() => setViewMode("list")} style={{ background: viewMode === "list" ? "var(--void)" : "transparent", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", color: "var(--text-primary)" }}>
                                    <AlignJustify size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Search and Filters */}
                        <div style={{ display: "flex", gap: "12px", marginBottom: "32px", flexWrap: "wrap" }}>
                            <div style={{ flex: 1, minWidth: "240px", position: "relative" }}>
                                <Search size={14} color="var(--ash)" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
                                <input
                                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                                    placeholder="Search library manuscripts..." className="input-field"
                                    style={{ paddingLeft: "38px" }}
                                />
                            </div>

                            <div style={{ display: "flex", gap: "6px" }}>
                                {(["all", "done", "generating", "failed"] as const).map(f => (
                                    <button
                                        key={f} onClick={() => setFilter(f)}
                                        className="btn-ghost"
                                        style={{
                                            padding: "8px 14px", fontSize: "12px", borderRadius: "8px",
                                            background: filter === f ? "var(--sapphire-dim)" : "var(--onyx)",
                                            borderColor: filter === f ? "var(--sapphire)" : "var(--border-mid)",
                                            color: filter === f ? "var(--sapphire)" : "var(--text-primary)",
                                        }}
                                    >
                                        {f === "all" ? "All Works" : f === "done" ? "Complete" : f === "generating" ? "Active" : "Failed"}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Loading state */}
                        {loading ? (
                            <div style={{ textAlign: "center", padding: "60px 0" }}>
                                <Loader size={24} color="var(--sapphire)" style={{ animation: "spin 1.2s linear infinite" }} />
                                <p style={{ color: "var(--text-tertiary)", fontSize: "13px", marginTop: "12px" }}>Scanning archives…</p>
                            </div>
                        ) : filtered.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "80px 0", background: "var(--onyx)", border: "1.5px dashed var(--border-strong)", borderRadius: "20px" }}>
                                <Library size={32} color="var(--sapphire)" style={{ opacity: 0.5, marginBottom: "16px" }} />
                                <p className="serif" style={{ fontSize: "18px", color: "var(--text-primary)", marginBottom: "4px" }}>
                                    {search ? "No matches found" : "Library is empty"}
                                </p>
                                <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                                    {search ? "Try searching for a different title concept" : "Start writing to fill your custom library shelf."}
                                </p>
                            </div>
                        ) : viewMode === "bookshelf" ? (
                            
                            /* ── BOOKSHELF VIEW MODE ── */
                            <div style={{ display: "flex", flexDirection: "column", gap: "40px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "28px", paddingBottom: "20px" }}>
                                    {filtered.map(book => {
                                        const meta = STATUS_META[book.status] || STATUS_META.pending;
                                        const isDone = book.status === "done";
                                        const bookBg = isDone ? "var(--emerald)" : "var(--border-strong)";

                                        return (
                                            <div
                                                key={book.book_id}
                                                onClick={() => setSelectedBook(book)}
                                                style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center" }}
                                            >
                                                {/* 3D Vertical standing book cover */}
                                                <div
                                                    style={{
                                                        width: "110px", height: "160px",
                                                        background: `linear-gradient(135deg, ${bookBg}aa, ${bookBg}66)`,
                                                        border: "1px solid var(--border-mid)",
                                                        borderRadius: "3px 8px 8px 3px",
                                                        position: "relative",
                                                        transition: "transform 0.2s, box-shadow 0.2s",
                                                        boxShadow: "-8px 8px 16px rgba(0,0,0,0.18)",
                                                        transform: "perspective(800px) rotateY(-14deg) rotateX(2deg)",
                                                        transformStyle: "preserve-3d",
                                                    }}
                                                    onMouseOver={e => {
                                                        const el = e.currentTarget;
                                                        el.style.transform = "perspective(800px) rotateY(-4deg) rotateX(1deg) scale(1.05)";
                                                        el.style.boxShadow = "-12px 12px 24px rgba(0,0,0,0.26)";
                                                    }}
                                                    onMouseOut={e => {
                                                        const el = e.currentTarget;
                                                        el.style.transform = "perspective(800px) rotateY(-14deg) rotateX(2deg)";
                                                        el.style.boxShadow = "-8px 8px 16px rgba(0,0,0,0.18)";
                                                    }}
                                                >
                                                    {/* Book spine line shadow edge */}
                                                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "6px", background: "linear-gradient(90deg, rgba(0,0,0,0.2) 0%, transparent 100%)", zIndex: 10 }} />
                                                    
                                                    {/* Genre icon or status marker inside book */}
                                                    <div style={{ position: "absolute", inset: "12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                                                        <BookOpen size={16} color="var(--void)" style={{ opacity: 0.8 }} />
                                                        <span style={{ fontSize: "8px", color: "var(--void)", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.9 }}>
                                                            {meta.label}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Shelf wood border */}
                                                <div style={{ width: "130px", height: "6px", background: "linear-gradient(180deg, #8b5a2b, #5c3a21)", borderRadius: "3px", marginTop: "8px", boxShadow: "0 4px 8px rgba(0,0,0,0.1)" }} />

                                                {/* Title metadata */}
                                                <p style={{ fontSize: "12px", fontWeight: "700", textAlign: "center", color: "var(--text-primary)", marginTop: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                                                    {book.title}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            
                            /* ── LIST VIEW MODE ── */
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {filtered.map(book => {
                                    const meta = STATUS_META[book.status] || STATUS_META.pending;
                                    return (
                                        <div
                                            key={book.book_id}
                                            onClick={() => setSelectedBook(book)}
                                            className="card"
                                            style={{
                                                background: "var(--onyx)", border: "1.5px solid var(--border-mid)",
                                                borderRadius: "14px", padding: "16px 20px",
                                                display: "flex", alignItems: "center", gap: "16px",
                                                cursor: "pointer", transition: "all 0.2s",
                                            }}
                                            onMouseOver={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                                            onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border-mid)"; e.currentTarget.style.transform = "none"; }}
                                        >
                                            <div style={{ width: "36px", height: "36px", background: "var(--void)", border: "1px solid var(--border-mid)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                <BookOpen size={16} color="var(--sapphire)" />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <h4 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {book.title}
                                                </h4>
                                                <div style={{ display: "flex", gap: "10px", fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>
                                                    <span>{new Date(book.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                                                    <span>·</span>
                                                    <span>{book.pages} pages</span>
                                                </div>
                                            </div>
                                            <span style={{ fontSize: "11px", fontWeight: "700", color: meta.color, background: meta.bg, padding: "3px 10px", borderRadius: "12px", border: `1px solid ${meta.border}` }}>
                                                {meta.label}
                                            </span>
                                            <ChevronRight size={14} color="var(--text-tertiary)" style={{ opacity: 0.6 }} />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </main>

                {/* ── Sliding Detail Inspector Sidebar ── */}
                {selectedBook && (() => {
                    const meta = STATUS_META[selectedBook.status] || STATUS_META.pending;
                    const isDone = selectedBook.status === "done";
                    return (
                        <div
                            style={{
                                width: "360px", background: "var(--onyx)",
                                borderLeft: "1.5px solid var(--border-mid)",
                                display: "flex", flexDirection: "column",
                                animation: "slideIn 0.25s ease-out",
                                position: "relative", zIndex: 10,
                                flexShrink: 0,
                            }}
                        >
                            {/* Header */}
                            <div style={{ padding: "20px 24px", borderBottom: "1.5px solid var(--border-mid)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span className="field-label" style={{ margin: 0, color: "var(--sapphire)" }}>Manuscript Details</span>
                                <button onClick={() => setSelectedBook(null)} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Details info */}
                            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
                                <div style={{ marginBottom: "24px" }}>
                                    <h3 className="serif" style={{ fontSize: "22px", color: "var(--text-primary)", marginBottom: "8px" }}>
                                        {selectedBook.title}
                                    </h3>
                                    <span style={{ fontSize: "11px", fontWeight: "700", color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, padding: "3px 10px", borderRadius: "12px" }}>
                                        {meta.label}
                                    </span>
                                </div>

                                <div style={{ display: "grid", gap: "14px", marginBottom: "32px" }}>
                                    {[
                                        { label: "Manuscript ID", value: `#${selectedBook.book_id}` },
                                        { label: "Date Created", value: new Date(selectedBook.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) },
                                        { label: "Target Size", value: `${selectedBook.pages} chapters / pages` },
                                    ].map(info => (
                                        <div key={info.label} style={{ background: "var(--void)", border: "1px solid var(--border-mid)", padding: "12px 14px", borderRadius: "10px" }}>
                                            <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{info.label}</span>
                                            <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", marginTop: "4px" }}>{info.value}</p>
                                        </div>
                                    ))}
                                </div>

                                {/* Download targets */}
                                {isDone && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                        <a
                                            href={downloadPDF(selectedBook.book_id)} target="_blank" rel="noreferrer"
                                            className="btn-dark"
                                            style={{ textDecoration: "none", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
                                        >
                                            <Download size={14} /> Download PDF
                                        </a>
                                        <a
                                            href={downloadDOCX(selectedBook.book_id)} target="_blank" rel="noreferrer"
                                            className="btn-outline"
                                            style={{ textDecoration: "none", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
                                        >
                                            <Download size={14} /> Download DOCX
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
