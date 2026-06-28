"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, logout } from "@/lib/firebase";
import Link from "next/link";
import {
  BookOpen,
  LogOut,
  FileSearch,
  ArrowRight,
  Sparkles,
  FileText,
  Palette,
  ScanLine,
  PencilLine,
  Languages,
  LayoutTemplate,
  Library,
  Settings,
} from "lucide-react";

export default function DashboardHome() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/login");
      else setUser(u);
    });
    return () => unsub();
  }, [router]);

  const firstName =
    user?.displayName?.split(" ")[0] || user?.email?.split("@")[0] || "there";

  const tools = [
    // ── Row 1 (2 cards) ──────────────────────────────────────────────────────
    {
      key: "scan",
      icon: ScanLine,
      label: "Handwritten Scanner",
      tag: "AI VISION",
      tagColor: "var(--violet)",
      description:
        "Photograph up to 400 handwritten pages — in any language — and AI transcribes every word into a clean, structured book exported as PDF & DOCX.",
      features: [
        "GPT-4o vision transcription",
        "Any language, any script",
        "Auto chapter detection & export",
      ],
      cta: "Scan Handwriting",
      href: "/dashboard/scan",
      accent: "var(--violet)",
      row: 1,
    },
    {
      key: "book",
      icon: BookOpen,
      label: "Book Writing",
      tag: "AI AGENT",
      tagColor: "var(--sapphire)",
      description:
        "Give us a title and vision. Our autonomous AI agent researches, structures, and writes your entire manuscript — exported as print-ready PDF & Word.",
      features: [
        "Full outline generation",
        "Chapter-by-chapter writing",
        "PDF + DOCX export",
      ],
      cta: "Start Writing",
      href: "/dashboard/books",
      accent: "var(--sapphire)",
      row: 1,
    },
    // ── Row 2 (3 cards) ───────────────────────────────────────────────────────
    {
      key: "editor",
      icon: PencilLine,
      label: "Book Editor",
      tag: "EXPERT",
      tagColor: "var(--crimson)",
      description:
        "Upload your book (PDF / DOCX / ZIP) and have a conversation to edit it — rewrite chapters, change the theme, adjust tone, add sections, and download each new version instantly.",
      features: [
        "Chat-based chapter editing",
        "Theme switching (Sci-Fi, Romance, Academic…)",
        "Versioned PDF + DOCX exports",
      ],
      cta: "Edit a Book",
      href: "/dashboard/editor",
      accent: "var(--crimson)",
      row: 2,
    },
    {
      key: "proof",
      icon: FileSearch,
      label: "Proofreading",
      tag: "POPULAR",
      tagColor: "var(--emerald)",
      description:
        "Upload any document and get an AI-powered edit covering grammar, punctuation, style, and readability — with a clean corrected file to download.",
      features: [
        "Grammar & spelling fixes",
        "Punctuation corrections",
        "Style & readability suggestions",
      ],
      cta: "Proofread a Doc",
      href: "/dashboard/proofread",
      accent: "var(--emerald)",
      row: 2,
    },
    {
      key: "translate",
      icon: Languages,
      label: "Book Translator",
      tag: "MULTILINGUAL",
      tagColor: "#0369a1",
      description:
        "Upload any PDF, DOCX, or ZIP book and translate it into 100+ languages. AI preserves chapter structure, tone, and formatting — exported as PDF & DOCX.",
      features: [
        "100+ languages supported",
        "Structure & chapters preserved",
        "PDF + DOCX export",
      ],
      cta: "Translate a Book",
      href: "/dashboard/translate",
      accent: "#0369a1",
      row: 2,
    },
    // ── Row 3 (2 cards) ───────────────────────────────────────────────────────
    {
      key: "cover",
      icon: Palette,
      label: "Cover Designer",
      tag: "AI ART",
      tagColor: "var(--amber)",
      description:
        "Upload your manuscript (PDF or DOCX) and let AI design a stunning, print-ready cover page — professionally typeset and attached to your book.",
      features: [
        "AI-generated design concept",
        "Full-bleed cover page rendered",
        "Prepended to your original file",
      ],
      cta: "Design a Cover",
      href: "/dashboard/cover",
      accent: "var(--amber)",
      row: 3,
    },
    {
      key: "layout",
      icon: LayoutTemplate,
      label: "Layout Designer",
      tag: "DESIGNER",
      tagColor: "#92400e",
      description:
        "Upload your manuscript (PDF, DOCX, or ZIP), choose a paper size, and describe your vision. AI designs a fully typeset internal layout — custom page dimensions, fonts, drop caps, and more.",
      features: [
        "Custom paper size (A4, A5, US Trade, etc.)",
        "AI-chosen typography & spacing presets",
        "Drop caps, ornaments & page numbering",
        "PDF + DOCX export",
      ],
      cta: "Design Layout",
      href: "/dashboard/layout",
      accent: "#92400e",
      row: 3,
    },
  ];

  const row1 = tools.filter((t) => t.row === 1);
  const row2 = tools.filter((t) => t.row === 2);
  const row3 = tools.filter((t) => t.row === 3);

  const Card = ({ tool }: { tool: (typeof tools)[0] }) => {
    const Icon = tool.icon;
    const cardRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cardRef.current) return;
      const card = cardRef.current;
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const xc = rect.width / 2;
      const yc = rect.height / 2;
      const angleX = (yc - y) / 12; // tilt angle
      const angleY = (x - xc) / 12;
      card.style.transform = `perspective(1000px) rotateX(${angleX}deg) rotateY(${angleY}deg) scale(1.02)`;
      card.style.boxShadow = "0 20px 45px -12px rgba(37, 99, 235, 0.15), 0 0 20px rgba(37, 99, 235, 0.04)";
      card.style.borderColor = "var(--border-strong)";
    };

    const handleMouseLeave = () => {
      if (!cardRef.current) return;
      const card = cardRef.current;
      card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)";
      card.style.boxShadow = "0 10px 30px -10px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.01)";
      card.style.borderColor = "var(--border-subtle)";
    };

    return (
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={() => router.push(tool.href)}
        className="card card-3d"
        style={{
          background: "var(--onyx)",
          border: "1.5px solid var(--border-mid)",
          borderRadius: "16px",
          padding: "32px",
          cursor: "pointer",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.01)",
        }}
      >
        {/* Tag */}
        <div
          style={{
            position: "absolute",
            top: "20px",
            right: "20px",
            background: "rgba(37, 99, 235, 0.05)",
            border: `1.5px solid var(--border-mid)`,
            borderRadius: "6px",
            padding: "3px 10px",
            fontSize: "9px",
            fontWeight: "700",
            letterSpacing: "0.1em",
            color: tool.tagColor,
          }}
        >
          {tool.tag}
        </div>

        {/* Icon */}
        <div
          style={{
            width: "44px",
            height: "44px",
            background: "var(--void)",
            border: "1.5px solid var(--border-mid)",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "20px",
            flexShrink: 0,
            boxShadow: "0 4px 10px rgba(0,0,0,0.02)",
          }}
        >
          <Icon size={20} color={tool.accent} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <h2
            className="serif"
            style={{
              fontSize: "20px",
              fontWeight: "400",
              letterSpacing: "-0.01em",
              marginBottom: "8px",
              color: "var(--text-primary)",
            }}
          >
            {tool.label}
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "13px",
              lineHeight: "1.6",
              marginBottom: "24px",
              flex: 1,
            }}
          >
            {tool.description}
          </p>

          {/* Feature list */}
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              marginBottom: "24px",
            }}
          >
            {tool.features.map((f) => (
              <li
                key={f}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  fontSize: "12px",
                  color: "var(--text-tertiary)",
                  marginBottom: "6px",
                }}
              >
                <span
                  style={{
                    color: "var(--sapphire)",
                    fontSize: "13px",
                    lineHeight: "1.4",
                    flexShrink: 0,
                    fontWeight: "bold",
                  }}
                >
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>

          {/* CTA Button */}
          <div
            className="btn-outline"
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              fontSize: "12px",
              borderRadius: "8px",
              borderWidth: "1px",
              gap: "6px",
            }}
          >
            {tool.cta} <ArrowRight size={13} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--void)",
        fontFamily: "'DM Sans', sans-serif",
        color: "var(--text-primary)",
        position: "relative",
      }}
    >
      <div className="grid-overlay" />

      {/* Nav */}
      <nav
        className="glass"
        style={{
          borderBottom: "1.5px solid var(--border-mid)",
          padding: "0 40px",
          height: "60px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "30px",
              height: "30px",
              background: "var(--text-primary)",
              borderRadius: "7px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 8px rgba(0,0,0,0.06)",
            }}
          >
            <FileText size={15} color="var(--void)" />
          </div>
          <span
            style={{
              fontWeight: "800",
              fontSize: "15px",
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            Publixo AI
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <Link
            href="/library"
            className="btn-ghost"
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              borderRadius: "8px",
              gap: "6px",
            }}
          >
            <Library size={13} /> Library
          </Link>
          <Link
            href="/settings"
            className="btn-ghost"
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              borderRadius: "8px",
              gap: "6px",
            }}
          >
            <Settings size={13} /> Settings
          </Link>
          <div style={{ width: "1px", height: "16px", background: "var(--border-mid)" }} />
          <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontWeight: "500" }}>
            {user?.displayName || user?.email?.split("@")[0] || "User"}
          </span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            className="btn-ghost"
            style={{
              padding: "6px 14px",
              fontSize: "12px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </nav>

      <main
        style={{ maxWidth: "1100px", margin: "0 auto", padding: "64px 40px 96px", position: "relative", zIndex: 2 }}
      >
        {/* Header */}
        <div style={{ marginBottom: "52px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "var(--onyx)",
              border: "1.5px solid var(--border-mid)",
              borderRadius: "20px",
              padding: "4px 14px",
              fontSize: "10px",
              fontWeight: "700",
              letterSpacing: "0.1em",
              color: "var(--sapphire)",
              marginBottom: "18px",
              boxShadow: "0 4px 10px rgba(0,0,0,0.02)",
            }}
          >
            <Sparkles size={11} /> AI-POWERED WRITING SUITE
          </div>
          <h1
            className="serif"
            style={{
              fontSize: "44px",
              fontWeight: "400",
              letterSpacing: "-0.02em",
              lineHeight: "1.1",
              marginBottom: "12px",
              color: "var(--text-primary)",
            }}
          >
            Welcome back, {firstName}.
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px" }}>
            What would you like to work on today?
          </p>
        </div>

        {/* Row 1 — 2 equal columns */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "20px",
            marginBottom: "20px",
          }}
        >
          {row1.map((tool) => (
            <Card key={tool.key} tool={tool} />
          ))}
        </div>

        {/* Row 2 — 3 equal columns */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "20px",
            marginBottom: "20px",
          }}
        >
          {row2.map((tool) => (
            <Card key={tool.key} tool={tool} />
          ))}
        </div>

        {/* Row 3 — 2 equal columns */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "20px",
            marginBottom: "20px",
          }}
        >
          {row3.map((tool) => (
            <Card key={tool.key} tool={tool} />
          ))}
        </div>

        {/* Footer strip */}
        <div
          style={{
            marginTop: "32px",
            padding: "16px 24px",
            background: "var(--onyx)",
            border: "1.5px solid var(--border-mid)",
            borderRadius: "12px",
            display: "flex",
            gap: "40px",
            alignItems: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.01)",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Signed in as{" "}
            <span style={{ color: "var(--text-primary)", fontWeight: "600" }}>
              {user?.email}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "var(--emerald)",
              marginLeft: "auto",
              fontWeight: "600",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: "var(--emerald)",
                display: "inline-block",
                boxShadow: "0 0 8px var(--emerald)",
              }}
            />
            AI services online
          </div>
        </div>
      </main>
    </div>
  );
}
