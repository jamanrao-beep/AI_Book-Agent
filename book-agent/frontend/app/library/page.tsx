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
    Filter,
} from "lucide-react";

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
    pending: { label: "Pending", color: "#555555", bg: "rgba(138,148,168,0.08)", border: "rgba(138,148,168,0.15)" },
    outlining: { label: "Creating Outline", color: "#9B6DFF", bg: "rgba(155,109,255,0.08)", border: "rgba(155,109,255,0.2)" },
    generating: { label: "Writing", color: "#6B93FF", bg: "rgba(59,111,255,0.08)", border: "rgba(59,111,255,0.2)" },
    assembling: { label: "Assembling", color: "#F5A623", bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.2)" },
    done: { label: "Complete", color: "#10D98A", bg: "rgba(16,217,138,0.08)", border: "rgba(16,217,138,0.2)" },
    failed: { label: "Failed", color: "#FF4D6A", bg: "rgba(255,77,106,0.08)", border: "rgba(255,77,106,0.2)" },
};

export default function LibraryPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [books, setBooks] = useState<BookStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<"all" | "done" | "generating" | "failed">("all");

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
        <div style={{ minHeight: "100vh", background: "#f7f2e4", fontFamily: "'DM Sans', sans-serif", color: "#2a2929" }}>

            {/* Nav */}
            <nav style={{
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                padding: "0 40px", height: "60px",
                display: "flex", alignItems: "center", gap: "16px",
                position: "sticky", top: 0,
                background: "rgba(8,10,15,0.92)", backdropFilter: "blur(16px)",
                zIndex: 50,
            }}>
                <button
                    onClick={() => router.push("/dashboard")}
                    style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        background: "none", border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: "8px", padding: "6px 12px",
                        color: "#555555", fontSize: "12px", cursor: "pointer", transition: "all 0.2s",
                    }}
                    onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.color = "#2a2929"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,0,0,0.14)"; }}
                    onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.color = "#555555"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,0,0,0.08)"; }}
                >
                    <ArrowLeft size={13} /> Dashboard
                </button>
                <div style={{ height: "18px", width: "1px", background: "rgba(0,0,0,0.08)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{
                        width: "26px", height: "26px",
                        background: "rgba(59,111,255,0.1)", border: "1px solid rgba(59,111,255,0.2)",
                        borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Library size={13} color="#6B93FF" />
                    </div>
                    <span style={{ fontWeight: "600", fontSize: "14px" }}>Library</span>
                </div>
            </nav>

            <main style={{ maxWidth: "880px", margin: "0 auto", padding: "48px 32px 80px" }}>

                {/* Header */}
                <div style={{ marginBottom: "36px" }}>
                    <h1 style={{
                        fontFamily: "'Playfair Display', serif",
                        fontSize: "34px", fontWeight: "400",
                        letterSpacing: "-0.02em", marginBottom: "6px",
                    }}>
                        Your Library
                    </h1>
                    <p style={{ color: "#555555", fontSize: "14px" }}>
                        All your manuscripts, organized in one place
                    </p>
                </div>

                {/* Stats row */}
                <div style={{
                    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px",
                    marginBottom: "28px",
                }}>
                    {[
                        { label: "Total Books", value: counts.all, color: "#2a2929" },
                        { label: "Completed", value: counts.done, color: "#10D98A" },
                        { label: "In Progress", value: counts.generating, color: "#6B93FF" },
                        { label: "Failed", value: counts.failed, color: "#FF4D6A" },
                    ].map(stat => (
                        <div key={stat.label} style={{
                            background: "#faf8f5", border: "1px solid rgba(0,0,0,0.06)",
                            borderRadius: "10px", padding: "16px 20px",
                        }}>
                            <div style={{ fontSize: "11px", color: "#737373", fontWeight: "600", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "6px" }}>
                                {stat.label}
                            </div>
                            <div style={{ fontSize: "28px", fontWeight: "700", fontFamily: "'DM Sans Mono', monospace", color: stat.color }}>
                                {loading ? "—" : stat.value}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Search + filter */}
                <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: "200px", position: "relative" }}>
                        <Search size={14} color="#737373" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search manuscripts…"
                            className="input-field"
                            style={{ paddingLeft: "38px" }}
                        />
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                        {(["all", "done", "generating", "failed"] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                style={{
                                    padding: "10px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: "600",
                                    cursor: "pointer", transition: "all 0.15s",
                                    background: filter === f ? "rgba(59,111,255,0.12)" : "rgba(0,0,0,0.03)",
                                    border: filter === f ? "1px solid rgba(59,111,255,0.3)" : "1px solid rgba(0,0,0,0.06)",
                                    color: filter === f ? "#6B93FF" : "#555555",
                                }}
                            >
                                {f === "all" ? "All" : f === "done" ? "Complete" : f === "generating" ? "In Progress" : "Failed"}
                                <span style={{
                                    marginLeft: "6px", fontSize: "11px",
                                    background: filter === f ? "rgba(59,111,255,0.2)" : "rgba(0,0,0,0.06)",
                                    color: filter === f ? "#6B93FF" : "#737373",
                                    borderRadius: "20px", padding: "1px 6px",
                                }}>
                                    {counts[f]}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Book list */}
                {loading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} style={{
                                height: "80px", borderRadius: "12px",
                                background: "linear-gradient(90deg, #faf8f5 25%, #ffffff 50%, #faf8f5 75%)",
                                backgroundSize: "200% 100%",
                                animation: "shimmer 1.5s infinite",
                            }} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{
                        textAlign: "center", padding: "72px 32px",
                        background: "#faf8f5", border: "1px dashed rgba(0,0,0,0.08)",
                        borderRadius: "14px",
                    }}>
                        <Library size={36} color="#737373" style={{ margin: "0 auto 14px" }} />
                        <h3 style={{ fontSize: "18px", fontFamily: "'Playfair Display', serif", fontWeight: "400", marginBottom: "8px" }}>
                            {search ? "No results found" : "Your library is empty"}
                        </h3>
                        <p style={{ color: "#555555", fontSize: "14px", marginBottom: "24px" }}>
                            {search ? `No books match "${search}"` : "Start creating AI manuscripts to build your library"}
                        </p>
                        {!search && (
                            <button onClick={() => router.push("/dashboard/books")} className="btn-dark">
                                Create your first book
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {filtered.map(book => {
                            const meta = STATUS_META[book.status] || STATUS_META.pending;
                            return (
                                <div key={book.book_id} style={{
                                    background: "#faf8f5",
                                    border: "1px solid rgba(0,0,0,0.06)",
                                    borderRadius: "12px", padding: "18px 22px",
                                    display: "flex", alignItems: "center", gap: "14px",
                                    transition: "border-color 0.2s",
                                    cursor: "default",
                                }}
                                    onMouseOver={e => (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0,0,0,0.08)"}
                                    onMouseOut={e => (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0,0,0,0.06)"}
                                >
                                    <div style={{
                                        width: "40px", height: "40px", flexShrink: 0,
                                        background: meta.bg, border: `1px solid ${meta.border}`,
                                        borderRadius: "9px",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <BookOpen size={17} color={meta.color} />
                                    </div>

                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {book.title}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", color: "#737373" }}>
                                            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                <Clock size={11} /> {new Date(book.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                                            </span>
                                            <span>·</span>
                                            <span>{book.pages} pages</span>
                                            <span>·</span>
                                            <span>ID #{book.book_id}</span>
                                        </div>
                                    </div>

                                    <div style={{
                                        background: meta.bg, border: `1px solid ${meta.border}`,
                                        borderRadius: "20px", padding: "3px 10px",
                                        fontSize: "11px", fontWeight: "600", color: meta.color,
                                        display: "flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap",
                                    }}>
                                        {book.status === "done" && <CheckCircle size={10} />}
                                        {book.status === "failed" && <XCircle size={10} />}
                                        {["generating", "outlining", "assembling", "pending"].includes(book.status) && <Loader size={10} className="spin" />}
                                        {meta.label}
                                    </div>

                                    {book.status === "done" && (
                                        <div style={{ display: "flex", gap: "7px", flexShrink: 0 }}>
                                            <a
                                                href={downloadPDF(book.book_id)} target="_blank" rel="noreferrer"
                                                style={{
                                                    display: "flex", alignItems: "center", gap: "5px",
                                                    background: "rgba(59,111,255,0.08)", border: "1px solid rgba(59,111,255,0.18)",
                                                    borderRadius: "7px", padding: "6px 12px",
                                                    fontSize: "12px", color: "#6B93FF", fontWeight: "600",
                                                    textDecoration: "none", transition: "all 0.15s",
                                                }}
                                            >
                                                <Download size={12} /> PDF
                                            </a>
                                            <a
                                                href={downloadDOCX(book.book_id)} target="_blank" rel="noreferrer"
                                                style={{
                                                    display: "flex", alignItems: "center", gap: "5px",
                                                    background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)",
                                                    borderRadius: "7px", padding: "6px 12px",
                                                    fontSize: "12px", color: "#555555", fontWeight: "600",
                                                    textDecoration: "none", transition: "all 0.15s",
                                                }}
                                            >
                                                <Download size={12} /> DOCX
                                            </a>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}
