"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, logout } from "@/lib/firebase";
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
      tagColor: "#a78bfa",
      tagBg: "rgba(124,58,237,0.12)",
      description:
        "Photograph up to 400 handwritten pages — in any language — and AI transcribes every word into a clean, structured book exported as PDF & DOCX.",
      features: [
        "GPT-4o vision transcription",
        "Any language, any script",
        "Auto chapter detection & export",
      ],
      cta: "Scan Handwriting",
      href: "/dashboard/scan",
      accent: "#7c3aed",
      bg: "linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(124,58,237,0.02) 100%)",
      border: "rgba(124,58,237,0.25)",
      row: 1,
    },
    {
      key: "book",
      icon: BookOpen,
      label: "Book Writing",
      tag: "AI AGENT",
      tagColor: "#6366f1",
      tagBg: "rgba(99,102,241,0.12)",
      description:
        "Give us a title and vision. Our autonomous AI agent researches, structures, and writes your entire manuscript — exported as print-ready PDF & Word.",
      features: [
        "Full outline generation",
        "Chapter-by-chapter writing",
        "PDF + DOCX export",
      ],
      cta: "Start Writing",
      href: "/dashboard/books",
      accent: "#6366f1",
      bg: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(99,102,241,0.02) 100%)",
      border: "rgba(99,102,241,0.25)",
      row: 1,
    },
    // ── Row 2 (3 cards) ───────────────────────────────────────────────────────
    {
      key: "editor",
      icon: PencilLine,
      label: "Book Editor",
      tag: "EXPERT",
      tagColor: "#f472b6",
      tagBg: "rgba(244,114,182,0.12)",
      description:
        "Upload your book (PDF / DOCX / ZIP) and have a conversation to edit it — rewrite chapters, change the theme, adjust tone, add sections, and download each new version instantly.",
      features: [
        "Chat-based chapter editing",
        "Theme switching (Sci-Fi, Romance, Academic…)",
        "Versioned PDF + DOCX exports",
      ],
      cta: "Edit a Book",
      href: "/dashboard/editor",
      accent: "#f472b6",
      bg: "linear-gradient(135deg, rgba(244,114,182,0.08) 0%, rgba(244,114,182,0.02) 100%)",
      border: "rgba(244,114,182,0.25)",
      row: 2,
    },
    {
      key: "proof",
      icon: FileSearch,
      label: "Proofreading",
      tag: "POPULAR",
      tagColor: "#10b981",
      tagBg: "rgba(16,185,129,0.12)",
      description:
        "Upload any document and get an AI-powered edit covering grammar, punctuation, style, and readability — with a clean corrected file to download.",
      features: [
        "Grammar & spelling fixes",
        "Punctuation corrections",
        "Style & readability suggestions",
      ],
      cta: "Proofread a Doc",
      href: "/dashboard/proofread",
      accent: "#10b981",
      bg: "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 100%)",
      border: "rgba(16,185,129,0.25)",
      row: 2,
    },
    {
      key: "translate",
      icon: Languages,
      label: "Book Translator",
      tag: "MULTILINGUAL",
      tagColor: "#0ea5e9",
      tagBg: "rgba(14,165,233,0.12)",
      description:
        "Upload any PDF, DOCX, or ZIP book and translate it into 100+ languages. AI preserves chapter structure, tone, and formatting — exported as PDF & DOCX.",
      features: [
        "100+ languages supported",
        "Structure & chapters preserved",
        "PDF + DOCX export",
      ],
      cta: "Translate a Book",
      href: "/dashboard/translate",
      accent: "#0ea5e9",
      bg: "linear-gradient(135deg, rgba(14,165,233,0.08) 0%, rgba(14,165,233,0.02) 100%)",
      border: "rgba(14,165,233,0.25)",
      row: 2,
    },
    // ── Row 3 (2 full-width feature card) ────────────────────────────────────
    {
      key: "cover",
      icon: Palette,
      label: "Cover Designer",
      tag: "AI ART",
      tagColor: "#fb923c",
      tagBg: "rgba(251,146,60,0.12)",
      description:
        "Upload your manuscript (PDF or DOCX) and let AI design a stunning, print-ready cover page — professionally typeset and attached to your book.",
      features: [
        "AI-generated design concept",
        "Full-bleed cover page rendered",
        "Prepended to your original file",
      ],
      cta: "Design a Cover",
      href: "/dashboard/cover",
      accent: "#fb923c",
      bg: "linear-gradient(135deg, rgba(251,146,60,0.08) 0%, rgba(251,146,60,0.02) 100%)",
      border: "rgba(251,146,60,0.25)",
      row: 3,
    },
    {
      key: "layout",
      icon: LayoutTemplate,
      label: "Layout Designer",
      tag: "DESIGNER",
      tagColor: "#f59e0b",
      tagBg: "rgba(245,158,11,0.12)",
      description:
        "Upload your manuscript (PDF, DOCX, or ZIP), choose a paper size, and describe your vision. AI designs a fully typeset internal layout — custom page dimensions, fonts, colour palette, chapter ornaments, drop caps, and more — exported as a print-ready PDF & DOCX.",
      features: [
        "Custom paper size (A4, A5, US Trade, or any mm)",
        "AI-chosen typography, spacing & colour palette",
        "Drop caps, ornaments & page numbers",
        "PDF + DOCX export",
      ],
      cta: "Design Layout",
      href: "/dashboard/layout",
      accent: "#f59e0b",
      bg: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 100%)",
      border: "rgba(245,158,11,0.25)",
      row: 3,
    },
  ];

  const row1 = tools.filter((t) => t.row === 1);
  const row2 = tools.filter((t) => t.row === 2);
  const row3 = tools.filter((t) => t.row === 3);

  const Card = ({
    tool,
    wide = false,
  }: {
    tool: (typeof tools)[0];
    wide?: boolean;
  }) => {
    const Icon = tool.icon;
    return (
      <div
        style={{
          background: tool.bg,
          border: `1px solid ${tool.border}`,
          borderRadius: "16px",
          padding: wide ? "32px 36px" : "28px",
          cursor: "pointer",
          transition: "transform 0.2s, box-shadow 0.2s",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: wide ? "row" : "column",
          gap: wide ? "32px" : undefined,
          alignItems: wide ? "flex-start" : undefined,
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform =
            "translateY(-3px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = `0 20px 60px ${tool.accent}22`;
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        }}
        onClick={() => router.push(tool.href)}
      >
        {/* Tag */}
        <div
          style={{
            position: "absolute",
            top: "18px",
            right: "18px",
            background: tool.tagBg,
            border: `1px solid ${tool.accent}33`,
            borderRadius: "6px",
            padding: "2px 8px",
            fontSize: "10px",
            fontWeight: "700",
            letterSpacing: "0.08em",
            color: tool.tagColor,
          }}
        >
          {tool.tag}
        </div>

        {/* Icon */}
        <div
          style={{
            width: "48px",
            height: "48px",
            background: `${tool.accent}18`,
            border: `1px solid ${tool.accent}33`,
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: wide ? 0 : "18px",
            flexShrink: 0,
          }}
        >
          <Icon size={22} color={tool.accent} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <h2
            style={{
              fontSize: "19px",
              fontWeight: "700",
              letterSpacing: "-0.01em",
              marginBottom: "8px",
              fontFamily: "'Playfair Display', serif",
            }}
          >
            {tool.label}
          </h2>
          <p
            style={{
              color: "#94a3b8",
              fontSize: "13px",
              lineHeight: "1.6",
              marginBottom: "20px",
              flex: wide ? undefined : 1,
              maxWidth: wide ? "520px" : undefined,
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
              display: wide ? "grid" : "block",
              gridTemplateColumns: wide ? "repeat(2, 1fr)" : undefined,
              gap: wide ? "4px 24px" : undefined,
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
                  color: "#cbd5e1",
                  marginBottom: wide ? 0 : "5px",
                }}
              >
                <span
                  style={{
                    color: tool.accent,
                    fontSize: "14px",
                    lineHeight: "1.3",
                  }}
                >
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: tool.accent,
              color: "#0c0f1a",
              borderRadius: "10px",
              padding: "9px 18px",
              fontSize: "13px",
              fontWeight: "700",
              alignSelf: "flex-start",
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
        background: "#0c0f1a",
        fontFamily: "'DM Sans', sans-serif",
        color: "#e2e8f0",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          padding: "0 40px",
          height: "60px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          background: "rgba(12,15,26,0.95)",
          backdropFilter: "blur(12px)",
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FileText size={16} color="white" />
          </div>
          <span
            style={{
              fontWeight: "700",
              fontSize: "15px",
              letterSpacing: "-0.01em",
            }}
          >
            Publixo AI
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <span style={{ fontSize: "13px", color: "#64748b" }}>
            {user?.email}
          </span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "none",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              padding: "6px 14px",
              color: "#94a3b8",
              fontSize: "13px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "rgba(255,255,255,0.2)";
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "rgba(255,255,255,0.1)";
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </nav>

      <main
        style={{ maxWidth: "1060px", margin: "0 auto", padding: "64px 40px" }}
      >
        {/* Header */}
        <div style={{ marginBottom: "52px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: "20px",
              padding: "4px 14px",
              fontSize: "11px",
              fontWeight: "700",
              letterSpacing: "0.08em",
              color: "#818cf8",
              marginBottom: "20px",
            }}
          >
            <Sparkles size={11} /> AI-POWERED WRITING SUITE
          </div>
          <h1
            style={{
              fontSize: "42px",
              fontWeight: "800",
              letterSpacing: "-0.03em",
              fontFamily: "'Playfair Display', serif",
              lineHeight: "1.1",
              marginBottom: "12px",
            }}
          >
            Welcome back, {firstName}.
          </h1>
          <p style={{ color: "#64748b", fontSize: "16px", lineHeight: "1.6" }}>
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

        {/* Row 3 — 2 equal columns, matches row 1 */}
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
            marginTop: "20px",
            padding: "18px 24px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px",
            display: "flex",
            gap: "40px",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "12px", color: "#475569" }}>
            Signed in as{" "}
            <span style={{ color: "#94a3b8", fontWeight: "600" }}>
              {user?.email}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "#10b981",
              marginLeft: "auto",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
              }}
            />
            AI services online
          </div>
        </div>
      </main>
    </div>
  );
}