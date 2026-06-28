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
      tagColor: "#7c3aed",
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
      row: 1,
    },
    {
      key: "book",
      icon: BookOpen,
      label: "Book Writing",
      tag: "AI AGENT",
      tagColor: "#2563eb",
      description:
        "Give us a title and vision. Our autonomous AI agent researches, structures, and writes your entire manuscript — exported as print-ready PDF & Word.",
      features: [
        "Full outline generation",
        "Chapter-by-chapter writing",
        "PDF + DOCX export",
      ],
      cta: "Start Writing",
      href: "/dashboard/books",
      accent: "#2563eb",
      row: 1,
    },
    // ── Row 2 (3 cards) ───────────────────────────────────────────────────────
    {
      key: "editor",
      icon: PencilLine,
      label: "Book Editor",
      tag: "EXPERT",
      tagColor: "#be185d",
      description:
        "Upload your book (PDF / DOCX / ZIP) and have a conversation to edit it — rewrite chapters, change the theme, adjust tone, add sections, and download each new version instantly.",
      features: [
        "Chat-based chapter editing",
        "Theme switching (Sci-Fi, Romance, Academic…)",
        "Versioned PDF + DOCX exports",
      ],
      cta: "Edit a Book",
      href: "/dashboard/editor",
      accent: "#be185d",
      row: 2,
    },
    {
      key: "proof",
      icon: FileSearch,
      label: "Proofreading",
      tag: "POPULAR",
      tagColor: "#047857",
      description:
        "Upload any document and get an AI-powered edit covering grammar, punctuation, style, and readability — with a clean corrected file to download.",
      features: [
        "Grammar & spelling fixes",
        "Punctuation corrections",
        "Style & readability suggestions",
      ],
      cta: "Proofread a Doc",
      href: "/dashboard/proofread",
      accent: "#047857",
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
      tagColor: "#c2410c",
      description:
        "Upload your manuscript (PDF or DOCX) and let AI design a stunning, print-ready cover page — professionally typeset and attached to your book.",
      features: [
        "AI-generated design concept",
        "Full-bleed cover page rendered",
        "Prepended to your original file",
      ],
      cta: "Design a Cover",
      href: "/dashboard/cover",
      accent: "#c2410c",
      row: 3,
    },
    {
      key: "layout",
      icon: LayoutTemplate,
      label: "Layout Designer",
      tag: "DESIGNER",
      tagColor: "#92400e",
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
      accent: "#92400e",
      row: 3,
    },
  ];

  const row1 = tools.filter((t) => t.row === 1);
  const row2 = tools.filter((t) => t.row === 2);
  const row3 = tools.filter((t) => t.row === 3);

  const Card = ({
    tool,
  }: {
    tool: (typeof tools)[0];
  }) => {
    const Icon = tool.icon;
    return (
      <div
        style={{
          background: "white",
          border: "1px solid #e8e8e4",
          borderRadius: "12px",
          padding: "28px",
          cursor: "pointer",
          transition: "transform 0.2s, box-shadow 0.2s",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform =
            "translateY(-2px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 12px 40px rgba(0,0,0,0.10)";
          (e.currentTarget as HTMLDivElement).style.borderColor = "#d0d0cc";
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
          (e.currentTarget as HTMLDivElement).style.borderColor = "#e8e8e4";
        }}
        onClick={() => router.push(tool.href)}
      >
        {/* Tag */}
        <div
          style={{
            position: "absolute",
            top: "18px",
            right: "18px",
            background: "#f7f2e4",
            border: `1px solid #e8e8e4`,
            borderRadius: "5px",
            padding: "2px 8px",
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
            background: "#f7f2e4",
            border: "1px solid #e8e8e4",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "18px",
            flexShrink: 0,
          }}
        >
          <Icon size={20} color={tool.accent} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "800",
              letterSpacing: "-0.02em",
              marginBottom: "8px",
              color: "#2b2b2b",
              fontFamily: "'Playfair Display', serif",
            }}
          >
            {tool.label}
          </h2>
          <p
            style={{
              color: "#666",
              fontSize: "13px",
              lineHeight: "1.65",
              marginBottom: "20px",
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
                  color: "#555",
                  marginBottom: "5px",
                }}
              >
                <span
                  style={{
                    color: tool.accent,
                    fontSize: "13px",
                    lineHeight: "1.4",
                    flexShrink: 0,
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
              background: "#1a1a1a",
              color: "white",
              borderRadius: "8px",
              padding: "9px 18px",
              fontSize: "12px",
              fontWeight: "700",
              alignSelf: "flex-start",
              letterSpacing: "0.01em",
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
        background: "#f7f2e4",
        fontFamily: "'DM Sans', sans-serif",
        color: "#2b2b2b",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          borderBottom: "1px solid #efefcf",
          padding: "0 40px",
          height: "56px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          background: "white",
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              background: "#1a1a1a",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FileText size={14} color="white" />
          </div>
          <span
            style={{
              fontWeight: "700",
              fontSize: "15px",
              color: "#2a2929",
              letterSpacing: "-0.01em",
            }}
          >
            Publixo AI
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <span style={{ fontSize: "13px", color: "#888" }}>
            {user?.email}
          </span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "none",
              border: "1px solid #e8e8e4",
              borderRadius: "7px",
              padding: "6px 14px",
              color: "#555",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: "500",
              transition: "all 0.15s",
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "#f7f2e4";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "#d0d0cc";
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "none";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "#e8e8e4";
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </nav>

      <main
        style={{ maxWidth: "1060px", margin: "0 auto", padding: "60px 40px" }}
      >
        {/* Header */}
        <div style={{ marginBottom: "52px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "white",
              border: "1px solid #e8e8e4",
              borderRadius: "20px",
              padding: "4px 14px",
              fontSize: "10px",
              fontWeight: "700",
              letterSpacing: "0.1em",
              color: "#2563eb",
              marginBottom: "20px",
            }}
          >
            <Sparkles size={11} /> AI-POWERED WRITING SUITE
          </div>
          <h1
            style={{
              fontSize: "44px",
              fontWeight: "800",
              letterSpacing: "-0.03em",
              fontFamily: "'Playfair Display', serif",
              lineHeight: "1.1",
              marginBottom: "12px",
              color: "#2d2c2c",
            }}
          >
            Welcome back, {firstName}.
          </h1>
          <p style={{ color: "#666", fontSize: "16px", lineHeight: "1.6" }}>
            What would you like to work on today?
          </p>
        </div>

        {/* Row 1 — 2 equal columns */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "16px",
            marginBottom: "16px",
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
            gap: "16px",
            marginBottom: "16px",
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
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          {row3.map((tool) => (
            <Card key={tool.key} tool={tool} />
          ))}
        </div>

        {/* Footer strip */}
        <div
          style={{
            marginTop: "16px",
            padding: "16px 24px",
            background: "white",
            border: "1px solid #e8e8e4",
            borderRadius: "10px",
            display: "flex",
            gap: "40px",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "12px", color: "#888" }}>
            Signed in as{" "}
            <span style={{ color: "#2b2b2b", fontWeight: "600" }}>
              {user?.email}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "#047857",
              marginLeft: "auto",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: "#22c55e",
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