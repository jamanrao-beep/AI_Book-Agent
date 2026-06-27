"use client";
import Link from "next/link";
import {
  FileText,
  Zap,
  Download,
  Shield,
  RefreshCw,
  BookOpen,
  ArrowRight,
} from "lucide-react";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithGoogle, auth } from "@/lib/firebase";
import { onAuthStateChanged, getRedirectResult } from "firebase/auth";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) router.push("/dashboard");
    });
    getRedirectResult(auth).catch((err) => {
      console.error(err);
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const handleGoogle = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        background: "#f7f2e4ff",
        minHeight: "100vh",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 48px",
          height: "56px",
          borderBottom: "1px solid #efefcfff",
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
          <span style={{ fontWeight: "700", fontSize: "15px", color: "#2a2929ff" }}>
            Publixo AI
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "12px",
              color: "#262626ff",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                background: "#22c55e",
                borderRadius: "50%",
                display: "inline-block",
              }}
            />
            AI Health: Optimal
          </span>
          <Link
            href="/login"
            style={{
              color: "#262626ff",
              fontSize: "14px",
              fontWeight: "500",
              padding: "6px 14px",
              textDecoration: "none",
            }}
          >
            Sign In
          </Link>
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="btn-dark"
            style={{ padding: "8px 18px", fontSize: "13px", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "Connecting..." : "Start Writing Free"}
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section
        style={{
          background:
            "linear-gradient(160deg, #f0f4ff 0%, #faf8f5 40%, #f0fff4 100%)",
          padding: "80px 48px 60px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "white",
            border: "1px solid #e0e0dc",
            borderRadius: "20px",
            padding: "4px 14px",
            fontSize: "11px",
            color: "#2563eb",
            fontWeight: "600",
            letterSpacing: "0.06em",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Zap size={11} />
          POWERED BY OPENAI — GPT-4o
        </div>
        <h1
          style={{
            fontSize: "56px",
            fontWeight: "800",
            color: '#2d2c2cff',
            lineHeight: "1.1",
            letterSpacing: "-0.03em",
            marginTop: "36px",
            fontFamily: "'Playfair Display', serif",
          }}
        >
          Write a Full Book with AI
          <br />
          <span style={{ color: "#2563eb" }}>in Minutes</span>
        </h1>
        <p
          style={{
            color: "#555",
            fontSize: "18px",
            maxWidth: "560px",
            margin: "20px auto 36px",
            lineHeight: "1.6",
          }}
        >
          Simply enter your title and vision. Our autonomous agent researches,
          structures, and writes your entire manuscript into a print-ready PDF
          or Word document.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="btn-dark"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "14px 28px",
              fontSize: "14px",
              justifyContent: "center",
              margin: "0 auto",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Connecting..." : <>Generate Your Book Free <ArrowRight size={16} /></>}
          </button>
          <Link href="/login">
            <button
              className="btn-outline"
              style={{ padding: "14px 28px", fontSize: "14px" }}
            >
              Sign In
            </button>
          </Link>
        </div>

        {/* Mock app screenshot */}
        <div
          style={{
            marginTop: "56px",
            maxWidth: "560px",
            margin: "56px auto 0",
            background: "#1a1a1a",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
          }}
        >
          <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#ff5f57",
              }}
            />
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#febc2e",
              }}
            />
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#28c840",
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "DM Mono, monospace",
              fontSize: "12px",
              color: "#888",
              lineHeight: 2,
            }}
          >
            <div>
              <span style={{ color: "#2563eb" }}>◆</span>{" "}
              <span style={{ color: "#ccc" }}>Generating outline</span>{" "}
              <span style={{ color: "#22c55e" }}>✓</span>
            </div>
            <div>
              <span style={{ color: "#2563eb" }}>◆</span>{" "}
              <span style={{ color: "#ccc" }}>Chapter 1: The Foundation</span>{" "}
              <span style={{ color: "#22c55e" }}>✓</span>
            </div>
            <div>
              <span style={{ color: "#2563eb" }}>◆</span>{" "}
              <span style={{ color: "#ccc" }}>Chapter 2: Core Principles</span>{" "}
              <span style={{ color: "#2563eb" }}>writing...</span>
            </div>
            <div style={{ color: "#555" }}>
              <span>◆</span> Chapter 3: Advanced Techniques{" "}
              <span className="blink">|</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section
        style={{
          borderTop: "1px solid #e8e8e4",
          borderBottom: "1px solid #e8e8e4",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
        }}
      >
        {[
          {
            label: "PRICING",
            value: "100% Free",
            sub: "to start your journey",
          },
          {
            label: "EFFICIENCY",
            value: "< 30m",
            sub: "for a full 200-page book",
          },
          {
            label: "COMPATIBILITY",
            value: "PDF + DOCX",
            sub: "standard export formats",
          },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              padding: "32px 40px",
              borderRight: i < 2 ? "1px solid #e8e8e4" : "none",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                color: "#0c43bbff",
                fontWeight: "700",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "800",
                letterSpacing: "-0.02em",
                fontFamily: "Playfair Display, serif",
                color: '#2b2b2bff',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: "13px", color: "#2a2929ff", marginTop: "4px" }}>
              {s.sub}
            </div>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section
        style={{ padding: "80px 48px", maxWidth: "680px", margin: "0 auto" }}
      >
        <div style={{ textAlign: "center", marginBottom: "56px" }}>
          <div
            style={{
              fontSize: "11px",
              color: "#0c43bbff",
              fontWeight: "700",
              letterSpacing: "0.1em",
              marginBottom: "12px",
            }}
          >
            THE PROCESS
          </div>
          <h2
            style={{
              fontSize: "40px",
              fontWeight: "800",
              color: '#2b2b2bff',
              letterSpacing: "-0.02em",
              fontFamily: "Playfair Display, serif",
            }}
          >
            The Editorial Workflow
          </h2>
        </div>
        {[
          {
            n: "01",
            title: "Enter Details",
            desc: "Provide a working title and a brief description of your vision. AI handles the complex prompt engineering for you.",
          },
          {
            n: "02",
            title: "AI Writes Chapter by Chapter",
            desc: "The agent crafts a structured outline and writes each chapter with stylistic consistency, maintaining the narrative thread.",
          },
          {
            n: "03",
            title: "Download Your Book",
            desc: "Instantly export your manuscript in professional PDF or DOCX formats, ready for editing or immediate self-publishing.",
          },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: "24px",
              marginBottom: "40px",
              borderBottom: i < 2 ? "1px solid #f0f0ec" : "none",
              paddingBottom: "40px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                background: "#1a1a1a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: "700",
                  color: "white",
                }}
              >
                {s.n}
              </span>
            </div>
            <div>
              <h3
                style={{
                  fontWeight: "700",
                  fontSize: "18px",
                  marginBottom: "8px",
                  color: '#2b2b2bff',
                }}
              >
                {s.title}
              </h3>
              <p style={{ color: "#666", fontSize: "14px", lineHeight: "1.6" }}>
                {s.desc}
              </p>
            </div>
          </div>
        ))}
      </section>

      {/* Features grid */}
      <section
        style={{ padding: "0 48px 80px", maxWidth: "960px", margin: "0 auto" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1px",
            border: "1px solid #e8e8e4",
            borderRadius: "12px",
            overflow: "hidden",
            background: "#e8e8e4",
          }}
        >
          {[
            {
              icon: Zap,
              title: "AI-Powered Writing",
              desc: "GPT-4o generates coherent, professional prose chapter by chapter with unprecedented quality.",
            },
            {
              icon: Download,
              title: "PDF & Word Export",
              desc: "Get a print-ready PDF and fully formatted .docx file instantly, ready for KDP or editing.",
            },
            {
              icon: RefreshCw,
              title: "Resume on Failure",
              desc: "Generation paused? The agent picks up exactly where it left off. Never lose progress.",
            },
            {
              icon: Shield,
              title: "Your Books, Secure",
              desc: "Every manuscript is private to your account with Firebase-secured authentication.",
            },
            {
              icon: BookOpen,
              title: "Any Topic",
              desc: "Non-fiction, guides, textbooks, business books — any title you choose, any genre.",
            },
            {
              icon: FileText,
              title: "Structured Output",
              desc: "Beautiful cover pages, table of contents, chapter headings and formatted body text.",
            },
          ].map((f, i) => (
            <div key={i} style={{ background: "white", padding: "28px 24px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  background: "#f0f6ff",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "14px",
                }}
              >
                <f.icon size={18} color="#2563eb" />
              </div>
              <h3
                style={{
                  fontWeight: "600",
                  fontSize: "15px",
                  marginBottom: "6px",
                  color: '#2b2b2bff',
                }}
              >
                {f.title}
              </h3>
              <p style={{ color: "#777", fontSize: "13px", lineHeight: "1.5" }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          background: "#1a1a1a",
          padding: "80px 48px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: "48px",
            fontWeight: "800",
            color: "white",
            letterSpacing: "-0.02em",
            fontFamily: "Playfair Display, serif",
            marginBottom: "16px",
          }}
        >
          Ready to Write Your Book?
        </h2>
        <p style={{ color: "#888", fontSize: "16px", marginBottom: "36px" }}>
          The blank page is a thing of the past. Join authors using Publixo AI
          to bring their stories to life.
        </p>
        <Link href="/login?signup=true">
          <button
            style={{
              background: "white",
              color: "#1a1a1a",
              border: "none",
              borderRadius: "8px",
              padding: "14px 32px",
              fontSize: "14px",
              fontWeight: "700",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            Start Writing Free <ArrowRight size={16} />
          </button>
        </Link>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid #e8e8e4",
          padding: "24px 48px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
            color: "#888",
          }}
        >
          <FileText size={14} />
          Publixo AI
        </div>
        <div
          style={{
            display: "flex",
            gap: "20px",
            fontSize: "13px",
            color: "#888",
          }}
        >
          <span style={{ cursor: "pointer" }}>Privacy Policy</span>
          <span style={{ cursor: "pointer" }}>Terms of Service</span>
          <span style={{ cursor: "pointer" }}>Documentation</span>
        </div>
        <span style={{ fontSize: "12px", color: "#aaa" }}>
          © 2026 Publixo AI Suite
        </span>
      </footer>
    </div>
  );
}
