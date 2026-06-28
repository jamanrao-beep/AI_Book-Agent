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
  Sparkles,
  Layers,
  Wand2,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { loginWithGoogle, auth } from "@/lib/firebase";
import { onAuthStateChanged, getRedirectResult } from "firebase/auth";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [outlineStep, setOutlineStep] = useState(0);
  const terminalCardRef = useRef<HTMLDivElement>(null);

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

  // Terminal text cycle animation
  useEffect(() => {
    const interval = setInterval(() => {
      setOutlineStep((prev) => (prev + 1) % 4);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  const handleGoogle = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  // Direct 3D Tilt handler for terminal mock card
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!terminalCardRef.current) return;
    const card = terminalCardRef.current;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    const angleX = (yc - y) / 18; // vertical tilt speed
    const angleY = (x - xc) / 18; // horizontal tilt speed
    card.style.transform = `perspective(1000px) rotateX(${angleX}deg) rotateY(${angleY}deg) scale(1.025)`;
  };

  const handleMouseLeave = () => {
    if (!terminalCardRef.current) return;
    const card = terminalCardRef.current;
    card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)";
  };

  return (
    <div
      style={{
        background: "var(--void)",
        minHeight: "100vh",
        fontFamily: "'DM Sans', sans-serif",
        color: "var(--text-primary)",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      <div className="grid-overlay" />

      {/* Decorative Blur Blobs */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "5%",
          width: "400px",
          height: "400px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(37, 99, 235, 0.08) 0%, transparent 70%)",
          filter: "blur(60px)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "40%",
          right: "5%",
          width: "500px",
          height: "500px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139, 92, 246, 0.06) 0%, transparent 70%)",
          filter: "blur(80px)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Navigation */}
      <nav
        className="glass"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 48px",
          height: "64px",
          borderBottom: "1px solid var(--border-mid)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              background: "var(--text-primary)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
            }}
          >
            <FileText size={16} color="var(--void)" />
          </div>
          <span style={{ fontWeight: "800", fontSize: "16px", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            Publixo AI
          </span>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: "600",
              color: "var(--text-secondary)",
              background: "rgba(37, 99, 235, 0.06)",
              border: "1px solid rgba(37, 99, 235, 0.15)",
              padding: "4px 10px",
              borderRadius: "20px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                background: "var(--emerald)",
                borderRadius: "50%",
                display: "inline-block",
                boxShadow: "0 0 8px var(--emerald)",
              }}
            />
            AI Status: Online
          </span>
          <Link
            href="/login"
            className="btn-ghost"
            style={{ padding: "6px 16px", fontSize: "13px" }}
          >
            Sign In
          </Link>
          <Link href="/login?signup=true">
            <button
              className="btn-dark"
              style={{ padding: "8px 18px", fontSize: "13px" }}
            >
              Start Writing Free
            </button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section
        style={{
          padding: "100px 48px 80px",
          textAlign: "center",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(255, 255, 255, 0.8)",
            border: "1.5px solid var(--border-mid)",
            borderRadius: "30px",
            padding: "6px 16px",
            fontSize: "11px",
            color: "var(--sapphire)",
            fontWeight: "700",
            letterSpacing: "0.08em",
            marginBottom: "24px",
            boxShadow: "0 4px 12px rgba(37, 99, 235, 0.05)",
          }}
        >
          <Sparkles size={12} />
          POWERED BY GPT-4o & CLAUDE 3.5
        </div>

        <h1
          className="serif fade-in"
          style={{
            fontSize: "64px",
            fontWeight: "400",
            color: 'var(--text-primary)',
            lineHeight: "1.05",
            letterSpacing: "-0.03em",
            maxWidth: "800px",
            margin: "0 auto 24px",
          }}
        >
          Write a Full Book with AI <br />
          <span style={{ color: "var(--sapphire)", fontStyle: "italic", textShadow: "0 0 40px rgba(37, 99, 235, 0.15)" }}>
            in Minutes
          </span>
        </h1>

        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "17px",
            maxWidth: "600px",
            margin: "0 auto 36px",
            lineHeight: "1.6",
          }}
        >
          Simply enter your title and vision. Our autonomous agent structures,
          researches, writes, and formats your entire manuscript into a print-ready PDF or Word document.
        </p>

        <div style={{ display: "flex", gap: "16px", justifyContent: "center", alignItems: "center" }}>
          <Link href="/login?signup=true">
            <button
              className="btn-dark"
              style={{ padding: "13px 28px", fontSize: "14px" }}
            >
              Generate Your Book Free <ArrowRight size={16} />
            </button>
          </Link>
          <Link href="/login">
            <button
              className="btn-outline"
              style={{ padding: "13px 28px", fontSize: "14px" }}
            >
              Sign In
            </button>
          </Link>
        </div>

        {/* 3D Tilt Mock Terminal */}
        <div className="card-3d-container" style={{ marginTop: "64px" }}>
          <div
            ref={terminalCardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="card card-3d"
            style={{
              maxWidth: "600px",
              margin: "0 auto",
              background: "#18181b",
              borderRadius: "16px",
              padding: "24px 28px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              boxShadow: "0 30px 70px rgba(0,0,0,0.3), 0 0 40px rgba(37, 99, 235, 0.08)",
              textAlign: "left",
            }}
          >
            {/* Windows Dots */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ef4444" }} />
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#f59e0b" }} />
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#10b981" }} />
            </div>

            {/* Simulated generation logs */}
            <div
              style={{
                fontFamily: "DM Sans Mono, monospace",
                fontSize: "13px",
                color: "#a1a1aa",
                lineHeight: 1.9,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: "var(--sapphire)" }}>◆</span>
                <span style={{ color: "#ffffff" }}>Initializing autonomous manuscript agent...</span>
                <span style={{ color: "var(--emerald)", fontWeight: "bold" }}>✓</span>
              </div>
              
              <div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: outlineStep >= 1 ? 1 : 0.25, transition: "opacity 0.5s" }}>
                <span style={{ color: "var(--sapphire)" }}>◆</span>
                <span style={{ color: "#ffffff" }}>Structuring chapters & reference blueprints...</span>
                {outlineStep >= 1 ? (
                  <span style={{ color: "var(--emerald)", fontWeight: "bold" }}>✓</span>
                ) : (
                  <span style={{ color: "var(--sapphire)", animation: "pulse 1.5s infinite" }}>processing...</span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: outlineStep >= 2 ? 1 : 0.25, transition: "opacity 0.5s" }}>
                <span style={{ color: "var(--sapphire)" }}>◆</span>
                <span style={{ color: "#ffffff" }}>Writing Chapter 1: The Foundation...</span>
                {outlineStep >= 2 ? (
                  <span style={{ color: "var(--emerald)", fontWeight: "bold" }}>✓</span>
                ) : outlineStep === 1 ? (
                  <span style={{ color: "var(--sapphire)", animation: "pulse 1.5s infinite" }}>writing...</span>
                ) : (
                  <span>pending</span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: outlineStep >= 3 ? 1 : 0.25, transition: "opacity 0.5s" }}>
                <span style={{ color: "var(--sapphire)" }}>◆</span>
                <span style={{ color: "#ffffff" }}>Compiling index templates & final PDF layout...</span>
                {outlineStep >= 3 ? (
                  <span style={{ color: "var(--emerald)", fontWeight: "bold" }}>✓</span>
                ) : outlineStep === 2 ? (
                  <span style={{ color: "var(--sapphire)", animation: "pulse 1.5s infinite" }}>assembling...</span>
                ) : (
                  <span>pending</span>
                )}
              </div>

              <div style={{ color: "#52525b", marginTop: "10px", borderTop: "1px solid #27272a", paddingTop: "10px", fontSize: "11px", display: "flex", justifyContent: "space-between" }}>
                <span>Publixo Engine v1.4.2</span>
                <span style={{ animation: "pulse 1.8s infinite" }}>● System Ready</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section
        style={{
          borderTop: "1.5px solid var(--border-mid)",
          borderBottom: "1.5px solid var(--border-mid)",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          background: "rgba(255, 255, 255, 0.5)",
          backdropFilter: "blur(8px)",
        }}
      >
        {[
          {
            label: "PRICING",
            value: "100% Free",
            sub: "no credit card required",
          },
          {
            label: "EFFICIENCY",
            value: "< 30 Minutes",
            sub: "for a fully researched manuscript",
          },
          {
            label: "COMPATIBILITY",
            value: "PDF + Word",
            sub: "standard self-publishing format",
          },
        ].map((s, i) => (
          <div
            key={i}
            className="card-hover"
            style={{
              padding: "40px 48px",
              borderRight: i < 2 ? "1.5px solid var(--border-mid)" : "none",
              textAlign: "center",
              transition: "background 0.3s",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                color: "var(--sapphire)",
                fontWeight: "800",
                letterSpacing: "0.12em",
                marginBottom: "10px",
              }}
            >
              {s.label}
            </div>
            <div
              className="serif"
              style={{
                fontSize: "36px",
                fontWeight: "400",
                letterSpacing: "-0.01em",
                color: 'var(--text-primary)',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "6px" }}>
              {s.sub}
            </div>
          </div>
        ))}
      </section>

      {/* Process Section */}
      <section
        style={{ padding: "100px 48px 80px", maxWidth: "800px", margin: "0 auto" }}
      >
        <div style={{ textAlign: "center", marginBottom: "64px" }}>
          <div
            style={{
              fontSize: "11px",
              color: "var(--sapphire)",
              fontWeight: "800",
              letterSpacing: "0.15em",
              marginBottom: "12px",
            }}
          >
            THE PROCESS
          </div>
          <h2
            className="serif"
            style={{
              fontSize: "44px",
              fontWeight: "400",
              color: 'var(--text-primary)',
              letterSpacing: "-0.02em",
            }}
          >
            The Editorial Workflow
          </h2>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {[
            {
              n: "01",
              title: "Provide Vision",
              desc: "Enter a working title and describe your vision. Our agent automatically designs outlines based on genres and parameters.",
            },
            {
              n: "02",
              title: "AI Writes Chapter by Chapter",
              desc: "The agent develops headings, generates citations, researches topics, and compiles detailed prose while maintaining stylistic consistency.",
            },
            {
              n: "03",
              title: "Download Print-Ready Documents",
              desc: "Instantly export your generated books as formatted DOCX or PDF, ready for final proofreading or immediate Kindle publishing.",
            },
          ].map((s, i) => (
            <div
              key={i}
              className="card card-hover"
              style={{
                display: "flex",
                gap: "24px",
                padding: "28px 32px",
                border: "1.5px solid var(--border-mid)",
                background: "var(--onyx)",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  background: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
              >
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: "700",
                    color: "var(--void)",
                  }}
                >
                  {s.n}
                </span>
              </div>
              <div>
                <h3
                  style={{
                    fontWeight: "700",
                    fontSize: "17px",
                    marginBottom: "8px",
                    color: 'var(--text-primary)',
                  }}
                >
                  {s.title}
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: "1.6" }}>
                  {s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section
        style={{ padding: "0 48px 100px", maxWidth: "960px", margin: "0 auto" }}
      >
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <span style={{ fontSize: "11px", color: "var(--sapphire)", fontWeight: "800", letterSpacing: "0.15em", textTransform: "uppercase" }}>Features</span>
          <h2 className="serif" style={{ fontSize: "36px", color: "var(--text-primary)", marginTop: "8px" }}>Full Editorial Suite</h2>
        </div>
        
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "20px",
          }}
        >
          {[
            {
              icon: Zap,
              title: "AI-Powered Writing",
              desc: "Deep narrative planning creates organic chapters with consistent flow and tone.",
            },
            {
              icon: Download,
              title: "PDF & Word Export",
              desc: "Fully paginated PDFs and style-formatted DOCX outputs standard for print.",
            },
            {
              icon: RefreshCw,
              title: "Resume Processing",
              desc: "If backend timeouts occur, simple one-click retry recovers exact draft stage.",
            },
            {
              icon: Shield,
              title: "Secured Vault",
              desc: "Firebase user security makes sure your proprietary manuscripts are yours alone.",
            },
            {
              icon: BookOpen,
              title: "Versatile Genres",
              desc: "From poetry and research papers to fiction novellas and instructional guides.",
            },
            {
              icon: Layers,
              title: "Layout Engine",
              desc: "Format page trim sizes, outer margins, lines per page, and drop caps visually.",
            },
          ].map((f, i) => (
            <div
              key={i}
              className="card card-hover"
              style={{
                background: "var(--onyx)",
                padding: "32px 28px",
                border: "1.5px solid var(--border-mid)",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  background: "var(--sapphire-dim)",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "20px",
                  border: "1px solid rgba(37, 99, 235, 0.15)",
                }}
              >
                <f.icon size={18} color="var(--sapphire)" />
              </div>
              <h3
                style={{
                  fontWeight: "700",
                  fontSize: "15px",
                  marginBottom: "8px",
                  color: 'var(--text-primary)',
                }}
              >
                {f.title}
              </h3>
              <p style={{ color: "var(--text-tertiary)", fontSize: "13px", lineHeight: "1.5" }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section
        style={{
          background: "var(--text-primary)",
          padding: "100px 48px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Glow overlay */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.15, pointerEvents: "none",
          background: "radial-gradient(circle at center, var(--sapphire) 0%, transparent 60%)"
        }} />
        
        <h2
          className="serif fade-in"
          style={{
            fontSize: "52px",
            fontWeight: "400",
            color: "var(--void)",
            letterSpacing: "-0.02em",
            marginBottom: "20px",
            position: "relative",
            zIndex: 2,
          }}
        >
          Ready to Write Your Book?
        </h2>
        <p style={{ color: "var(--ash)", fontSize: "16px", marginBottom: "40px", maxWidth: "540px", margin: "0 auto 40px", lineHeight: 1.6, position: "relative", zIndex: 2 }}>
          The blank page is a thing of the past. Join writers using Publixo AI to bring their manuscript to life.
        </p>
        <Link href="/login?signup=true" style={{ position: "relative", zIndex: 2 }}>
          <button
            style={{
              background: "var(--void)",
              color: "var(--text-primary)",
              border: "none",
              borderRadius: "12px",
              padding: "16px 36px",
              fontSize: "14px",
              fontWeight: "700",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
              transition: "transform 0.2s",
            }}
            onMouseOver={e => e.currentTarget.style.transform = "translateY(-2px)"}
            onMouseOut={e => e.currentTarget.style.transform = "translateY(0)"}
          >
            Start Writing Free <ArrowRight size={16} />
          </button>
        </Link>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1.5px solid var(--border-mid)",
          padding: "32px 48px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(255, 255, 255, 0.4)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
            color: "var(--text-tertiary)",
            fontWeight: "600",
          }}
        >
          <FileText size={14} />
          Publixo AI
        </div>
        <div
          style={{
            display: "flex",
            gap: "24px",
            fontSize: "13px",
            color: "var(--text-tertiary)",
          }}
        >
          <span style={{ cursor: "pointer", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color="var(--text-primary)"} onMouseOut={e => e.currentTarget.style.color="var(--text-tertiary)"}>Privacy Policy</span>
          <span style={{ cursor: "pointer", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color="var(--text-primary)"} onMouseOut={e => e.currentTarget.style.color="var(--text-tertiary)"}>Terms of Service</span>
          <span style={{ cursor: "pointer", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color="var(--text-primary)"} onMouseOut={e => e.currentTarget.style.color="var(--text-tertiary)"}>Documentation</span>
        </div>
        <span style={{ fontSize: "12px", color: "var(--ash)" }}>
          © 2026 Publixo AI Suite
        </span>
      </footer>
    </div>
  );
}
