"use client";
import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, FileText, ArrowRight } from "lucide-react";
import { loginWithEmail, signupWithEmail, loginWithGoogle, auth } from "@/lib/firebase";
import { onAuthStateChanged, getRedirectResult } from "firebase/auth";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSignup = searchParams.get("signup") === "true";
  const [mode, setMode] = useState<"login" | "signup">(isSignup ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [staySignedIn, setStaySignedIn] = useState(false);
  const formCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => { if (user) router.push("/dashboard"); });
    getRedirectResult(auth).catch(err => {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    });
    return () => unsub();
  }, [router]);

  const parseFirebaseError = (err: any): string => {
    const code = err?.code || err?.message || "";
    if (code.includes("auth/weak-password")) {
      return "The password is too weak. It must be at least 6 characters long.";
    }
    if (code.includes("auth/email-already-in-use")) {
      return "This email address is already in use by another account.";
    }
    if (code.includes("auth/invalid-email")) {
      return "The email address is badly formatted.";
    }
    if (
      code.includes("auth/user-not-found") ||
      code.includes("auth/wrong-password") ||
      code.includes("auth/invalid-credential")
    ) {
      return "Incorrect email or password. Please check your credentials or sign up if you don't have an account.";
    }
    if (code.includes("auth/operation-not-allowed")) {
      return "Email/password authentication is not enabled. Please sign in with Google or contact support.";
    }
    if (code.includes("auth/too-many-requests")) {
      return "Too many failed attempts. Access to this account has been temporarily disabled.";
    }
    return (err instanceof Error ? err.message : "Authentication failed")
      .replace("Firebase: ", "")
      .replace(/\(auth\/.*\)/, "")
      .trim();
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      if (mode === "login") {
        await loginWithEmail(email, password);
      } else {
        if (!name.trim()) {
          setError("Please enter your full name to register.");
          setLoading(false);
          return;
        }
        await signupWithEmail(email, password, name.trim());
      }
      router.push("/dashboard");
    } catch (err: any) {
      setError(parseFirebaseError(err));
    } finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    setLoading(true); setError("");
    try { await loginWithGoogle(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Google sign-in failed"); setLoading(false); }
  };

  // Direct 3D Tilt handler for Form Card
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!formCardRef.current) return;
    const card = formCardRef.current;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    const angleX = (yc - y) / 25; // light vertical tilt
    const angleY = (x - xc) / 25; // light horizontal tilt
    card.style.transform = `perspective(1000px) rotateX(${angleX}deg) rotateY(${angleY}deg) scale(1.01)`;
  };

  const handleMouseLeave = () => {
    if (!formCardRef.current) return;
    const card = formCardRef.current;
    card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)";
  };

  const IS = mode === "signup";

  return (
    <div style={{ minHeight: "100vh", display: "flex", fontFamily: "'DM Sans', sans-serif", background: "var(--void)", position: "relative" }}>
      <div className="grid-overlay" />

      {/* ── LEFT panel ─────────────────────────────────── */}
      <div style={{
        flex: "0 0 45%", position: "relative", overflow: "hidden",
        background: "var(--obsidian)",
        display: "flex", flexDirection: "column",
        borderRight: "1.5px solid var(--border-mid)",
      }}>
        {/* Glow effects */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 70% 60% at 20% 70%, rgba(37,99,235,0.08) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 80% 20%, rgba(139,92,246,0.05) 0%, transparent 60%)",
        }} />

        {/* Decorative book icon */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0.04, pointerEvents: "none" }} className="float-animation">
          <svg width="340" height="340" viewBox="0 0 100 80" fill="none">
            <path d="M50 8 L50 75" stroke="var(--text-primary)" strokeWidth="1.5" />
            <path d="M50 8 C35 6 15 12 5 18 L5 72 C15 66 35 70 50 72" stroke="var(--text-primary)" strokeWidth="1.5" fill="none" />
            <path d="M50 8 C65 6 85 12 95 18 L95 72 C85 66 65 70 50 72" stroke="var(--text-primary)" strokeWidth="1.5" fill="none" />
            <path d="M15 25 L45 22 M15 33 L45 30 M15 41 L45 38 M15 49 L45 46" stroke="var(--text-primary)" strokeWidth="0.8" opacity="0.6" />
            <path d="M55 22 L85 25 M55 30 L85 33 M55 38 L85 41 M55 46 L85 49" stroke="var(--text-primary)" strokeWidth="0.8" opacity="0.6" />
          </svg>
        </div>

        {/* Logo */}
        <div style={{ position: "relative", zIndex: 3, padding: "36px 44px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "32px", height: "32px",
              background: "var(--text-primary)",
              borderRadius: "8px",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
            }}>
              <FileText size={16} color="var(--void)" />
            </div>
            <span style={{ color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: "800", letterSpacing: "-0.01em" }}>
              Publixo AI
            </span>
          </div>
        </div>

        {/* Bottom Quote panel */}
        <div style={{ position: "relative", zIndex: 3, padding: "44px", marginTop: "auto" }}>
          <div style={{ width: "32px", height: "2px", background: "var(--sapphire)", marginBottom: "24px" }} />
          <blockquote className="serif" style={{
            fontSize: "clamp(26px, 3vw, 38px)",
            fontStyle: "italic",
            fontWeight: "400",
            color: "var(--text-primary)",
            lineHeight: "1.2",
            marginBottom: "20px",
            maxWidth: "400px",
          }}>
            &ldquo;Words are the threads of reality.&rdquo;
          </blockquote>
          <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "var(--text-tertiary)", textTransform: "uppercase" }}>
            Enterprise Editorial Suite
          </div>

          {/* Compliance */}
          <div style={{ marginTop: "40px", display: "flex", gap: "20px" }}>
            {["256-bit encryption", "SOC 2 compliant", "99.9% uptime"].map(item => (
              <div key={item} style={{
                fontSize: "11px", color: "var(--text-tertiary)",
                display: "flex", alignItems: "center", gap: "6px",
              }}>
                <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--sapphire)" }} />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT form ─────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "48px 60px",
        overflowY: "auto",
        zIndex: 2,
      }} className="card-3d-container">
        <div 
          ref={formCardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="card card-3d"
          style={{ 
            width: "100%", 
            maxWidth: "440px",
            background: "var(--onyx)",
            padding: "40px",
            border: "1.5px solid var(--border-mid)",
            boxShadow: "0 20px 50px -15px rgba(37,99,235,0.06)",
            borderRadius: "20px",
          }}
        >
          {IS ? (
            // ── Signup ─────────────────────────────────
            <>
              <h1 className="serif" style={{
                fontSize: "36px", fontWeight: "400",
                color: "var(--text-primary)", letterSpacing: "-0.02em",
                lineHeight: "1.15", marginBottom: "8px",
              }}>
                Create your<br />workspace
              </h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "28px" }}>
                Begin your editorial journey today.
              </p>

              {error && (
                <div style={{
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.18)",
                  borderRadius: "8px", padding: "11px 14px",
                  fontSize: "13px", color: "var(--crimson)", marginBottom: "20px",
                }}>{error}</div>
              )}

              <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label className="field-label">Full Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="Alex Sterling" className="input-field" />
                </div>
                <div>
                  <label className="field-label">Work Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required placeholder="editor@company.com" className="input-field" />
                </div>
                <div>
                  <label className="field-label">Password</label>
                  <div style={{ position: "relative" }}>
                    <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                      required placeholder="••••••••" className="input-field" style={{ paddingRight: "44px" }} />
                    <button type="button" onClick={() => setShowPass(!showPass)} style={{
                      position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)",
                      display: "flex", padding: 0,
                    }}>
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn-dark" style={{
                  width: "100%", padding: "13px 24px", fontSize: "14px",
                  justifyContent: "center", marginTop: "4px",
                  opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer",
                }}>
                  {loading ? "Creating workspace…" : (<>Create Account <ArrowRight size={14} /></>)}
                </button>
              </form>

              {/* Google SSO */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "20px 0" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-mid)" }} />
                <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", color: "var(--text-tertiary)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  Or signup with
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-mid)" }} />
              </div>

              <button onClick={handleGoogle} disabled={loading} className="btn-ghost" style={{
                width: "100%", justifyItems: "center", justifyContent: "center", padding: "11px 16px",
                opacity: loading ? 0.6 : 1, gap: "10px"
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google
              </button>

              <p style={{ marginTop: "24px", fontSize: "13px", color: "var(--text-secondary)" }}>
                Already have an account?{" "}
                <button onClick={() => { setMode("login"); setError(""); }} style={{
                  background: "none", border: "none", color: "var(--sapphire)",
                  cursor: "pointer", fontSize: "13px", fontWeight: "600",
                }}>Sign In</button>
              </p>
            </>
          ) : (
            // ── Login ──────────────────────────────────
            <>
              <h1 className="serif" style={{
                fontSize: "36px", fontWeight: "400",
                color: "var(--text-primary)", letterSpacing: "-0.02em",
                lineHeight: "1.15", marginBottom: "8px",
              }}>
                Welcome back
              </h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "28px" }}>
                Access your manuscripts and AI suite.
              </p>

              {error && (
                <div style={{
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.18)",
                  borderRadius: "8px", padding: "11px 14px",
                  fontSize: "13px", color: "var(--crimson)", marginBottom: "20px",
                }}>{error}</div>
              )}

              <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label className="field-label">Email Address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required placeholder="editor@editorial-ai.com" className="input-field" />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
                    <label className="field-label" style={{ margin: 0 }}>Password</label>
                    <button type="button" style={{
                      background: "none", border: "none", fontSize: "12px",
                      color: "var(--sapphire)", cursor: "pointer", fontWeight: "600",
                    }}>Forgot?</button>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                      required placeholder="••••••••" className="input-field" style={{ paddingRight: "44px" }} />
                    <button type="button" onClick={() => setShowPass(!showPass)} style={{
                      position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)",
                      display: "flex", padding: 0,
                    }}>
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: "9px", cursor: "pointer" }}>
                  <input type="checkbox" checked={staySignedIn} onChange={e => setStaySignedIn(e.target.checked)}
                    style={{ width: "14px", height: "14px", accentColor: "var(--sapphire)", cursor: "pointer" }} />
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Stay signed in</span>
                </label>

                <button type="submit" disabled={loading} className="btn-dark" style={{
                  width: "100%", padding: "13px 24px", fontSize: "14px",
                  justifyContent: "center",
                  opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer",
                }}>
                  {loading ? "Signing in…" : (<>Sign In <ArrowRight size={14} /></>)}
                </button>
              </form>

              {/* SSO divider */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "20px 0" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-mid)" }} />
                <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", color: "var(--text-tertiary)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  Or continue with
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-mid)" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
                <button onClick={handleGoogle} disabled={loading} className="btn-ghost" style={{
                  justifyContent: "center", padding: "11px 16px",
                  opacity: loading ? 0.6 : 1, gap: "10px"
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Google
                </button>
              </div>

              <p style={{ marginTop: "24px", fontSize: "13px", color: "var(--text-secondary)" }}>
                New to Publixo AI?{" "}
                <button onClick={() => { setMode("signup"); setError(""); }} style={{
                  background: "none", border: "none", color: "var(--sapphire)",
                  cursor: "pointer", fontSize: "13px", fontWeight: "600",
                }}>Create an account</button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "var(--void)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "24px", height: "24px", border: "2px solid rgba(37,99,235,0.2)", borderTopColor: "var(--sapphire)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
