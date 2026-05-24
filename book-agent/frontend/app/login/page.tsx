"use client";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { loginWithEmail, signupWithEmail, loginWithGoogle, auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => { if (user) router.push("/dashboard"); });
    return () => unsub();
  }, [router]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      if (mode === "login") await loginWithEmail(email, password);
      else await signupWithEmail(email, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : "Authentication failed").replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim());
    } finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    setLoading(true); setError("");
    try { await loginWithGoogle(); router.push("/dashboard"); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Google sign-in failed"); }
    finally { setLoading(false); }
  };

  const IS = mode === "signup";

  return (
    <div style={{ minHeight: "100vh", display: "flex", fontFamily: "'DM Sans',sans-serif" }}>
      {/* LEFT dark panel */}
      <div style={{ flex: "0 0 58%", position: "relative", overflow: "hidden", background: "#0D0D0D", display: "flex", flexDirection: "column" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(ellipse 60% 50% at 30% 60%, rgba(43,78,255,0.12) 0%, transparent 70%), radial-gradient(ellipse 40% 60% at 70% 30%, rgba(255,255,255,0.04) 0%, transparent 60%)" }} />
        <div style={{ position: "absolute", inset: 0, opacity: 0.35, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`, backgroundSize: "120px 120px", mixBlendMode: "overlay" }} />
        {/* Decorative lines */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: "100% 80px", zIndex: 1 }} />
        {/* Large open book icon top-right */}
        <div style={{ position: "absolute", top: "32px", right: "32px", zIndex: 2, opacity: 0.12 }}>
          <svg width="200" height="200" viewBox="0 0 100 80" fill="none">
            <path d="M50 8 L50 75" stroke="#F5F2EC" strokeWidth="2" />
            <path d="M50 8 C35 6 15 12 5 18 L5 72 C15 66 35 70 50 72" stroke="#F5F2EC" strokeWidth="2" fill="none" />
            <path d="M50 8 C65 6 85 12 95 18 L95 72 C85 66 65 70 50 72" stroke="#F5F2EC" strokeWidth="2" fill="none" />
            <path d="M15 25 L45 22 M15 33 L45 30 M15 41 L45 38 M15 49 L45 46" stroke="#F5F2EC" strokeWidth="1" opacity="0.7" />
            <path d="M55 22 L85 25 M55 30 L85 33 M55 38 L85 41 M55 46 L85 49" stroke="#F5F2EC" strokeWidth="1" opacity="0.7" />
          </svg>
        </div>
        {/* Logo */}
        <div style={{ position: "relative", zIndex: 3, padding: "36px 44px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "30px", height: "30px", background: "#F5F2EC", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v1.5H2V3zm0 3h12v1.5H2V6zm0 3h8v1.5H2V9zm0 3h10v1.5H2V12z" fill="#1A1612" /></svg>
            </div>
            <span style={{ color: "#F5F2EC", fontFamily: "'EB Garamond',serif", fontSize: "18px", fontWeight: "600" }}>Editorial AI</span>
          </div>
        </div>
        {/* Bottom quote */}
        <div style={{ position: "relative", zIndex: 3, padding: "44px", marginTop: "auto" }}>
          <div style={{ width: "36px", height: "2px", background: "rgba(255,255,255,0.25)", marginBottom: "20px" }} />
          <blockquote style={{ fontFamily: "'EB Garamond',serif", fontSize: "clamp(22px,3vw,34px)", fontStyle: "italic", fontWeight: "500", color: "#F5F2EC", lineHeight: "1.25", marginBottom: "16px", maxWidth: "440px" }}>
            &ldquo;Words are the threads of reality.&rdquo;
          </blockquote>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "10px", fontWeight: "700", letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>Enterprise Editorial Suite</div>
        </div>
      </div>

      {/* RIGHT form */}
      <div style={{ flex: 1, background: "#FAFAF8", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 52px", overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: "380px" }}>
          {IS ? (
            <>
              <h1 style={{ fontFamily: "'EB Garamond',serif", fontSize: "38px", fontWeight: "700", color: "#1A1612", letterSpacing: "-0.02em", lineHeight: "1.1", marginBottom: "8px" }}>Create your<br />workspace</h1>
              <p style={{ color: "#7A6F66", fontSize: "14px", marginBottom: "32px", fontFamily: "'DM Sans',sans-serif" }}>Enter your credentials to begin your editorial journey.</p>
              {error && <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: "4px", padding: "11px 13px", fontSize: "13px", color: "#B91C1C", marginBottom: "18px" }}>{error}</div>}
              <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <label className="field-label">Full Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Julien Mercer" className="input-field" style={{ padding: "13px 14px" }} />
                </div>
                <div>
                  <label className="field-label">Work Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="editor@editorial.ai" className="input-field" style={{ padding: "13px 14px" }} />
                </div>
                <div>
                  <label className="field-label">Password</label>
                  <div style={{ position: "relative" }}>
                    <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" className="input-field" style={{ padding: "13px 40px 13px 14px" }} />
                    <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#B8AFA8", display: "flex" }}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading} style={{ background: "#1A1612", color: "#F5F2EC", border: "none", borderRadius: "4px", padding: "14px 24px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontFamily: "'DM Sans',sans-serif", marginTop: "4px" }}>
                  {loading ? "Creating..." : (<>Create Account <span style={{ fontSize: "15px", letterSpacing: 0 }}>→</span></>)}
                </button>
              </form>
              <p style={{ marginTop: "22px", fontSize: "14px", color: "#7A6F66" }}>
                Already have an account?{" "}
                <button onClick={() => { setMode("login"); setError(""); }} style={{ background: "none", border: "none", color: "#2B4EFF", cursor: "pointer", fontSize: "14px", fontWeight: "500" }}>Sign In</button>
              </p>
              <p style={{ marginTop: "24px", fontSize: "11px", color: "#B8AFA8", lineHeight: "1.6", borderTop: "1px solid #E2DDD8", paddingTop: "18px" }}>
                By signing up, you agree to our <span style={{ color: "#7A6F66", textDecoration: "underline", cursor: "pointer" }}>Terms of Service</span> and <span style={{ color: "#7A6F66", textDecoration: "underline", cursor: "pointer" }}>Privacy Policy</span>. Data processing managed via secure Editorial AI nodes.
              </p>
              <div style={{ marginTop: "24px", display: "flex", alignItems: "center", gap: "12px", borderTop: "1px solid #E2DDD8", paddingTop: "18px" }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: "#3D3530", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" fill="#F5F2EC" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#F5F2EC" strokeWidth="1.5" fill="none" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: "9px", fontWeight: "700", letterSpacing: "0.1em", color: "#B8AFA8", textTransform: "uppercase", marginBottom: "2px" }}>Enterprise Verified</div>
                  <div style={{ fontSize: "13px", color: "#3D3530" }}>Trusted by global newsrooms.</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "28px" }}>
                <div style={{ width: "26px", height: "26px", background: "#1A1612", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v1.5H2V3zm0 3h12v1.5H2V6zm0 3h8v1.5H2V9zm0 3h10v1.5H2V12z" fill="#F5F2EC" /></svg>
                </div>
                <span style={{ fontFamily: "'EB Garamond',serif", fontSize: "17px", fontWeight: "600", color: "#1A1612" }}>Editorial AI</span>
              </div>
              <h1 style={{ fontFamily: "'EB Garamond',serif", fontSize: "44px", fontWeight: "700", color: "#1A1612", letterSpacing: "-0.025em", lineHeight: "1.1", marginBottom: "8px" }}>Welcome Back</h1>
              <p style={{ color: "#7A6F66", fontSize: "14px", marginBottom: "32px" }}>Access your manuscripts and the AI suite.</p>
              {error && <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: "4px", padding: "11px 13px", fontSize: "13px", color: "#B91C1C", marginBottom: "18px" }}>{error}</div>}
              <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label className="field-label">Email Address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="editor@editorial-ai.com" className="input-field" style={{ padding: "13px 14px" }} />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <label className="field-label" style={{ margin: 0 }}>Password</label>
                    <button type="button" style={{ background: "none", border: "none", fontSize: "13px", color: "#2B4EFF", cursor: "pointer", fontWeight: "500" }}>Forgot?</button>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" className="input-field" style={{ padding: "13px 40px 13px 14px" }} />
                    <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#B8AFA8", display: "flex" }}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "9px", cursor: "pointer" }}>
                  <input type="checkbox" checked={staySignedIn} onChange={e => setStaySignedIn(e.target.checked)} style={{ width: "14px", height: "14px", accentColor: "#1A1612", cursor: "pointer" }} />
                  <span style={{ fontSize: "14px", color: "#3D3530" }}>Stay signed in</span>
                </label>
                <button type="submit" disabled={loading} style={{ background: "#1A1612", color: "#F5F2EC", border: "none", borderRadius: "4px", padding: "14px 24px", fontSize: "14px", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginTop: "4px" }}>
                  {loading ? "Signing in..." : (<>Sign In <span style={{ fontSize: "16px" }}>→</span></>)}
                </button>
              </form>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "20px 0" }}>
                <div style={{ flex: 1, height: "1px", background: "#E2DDD8" }} />
                <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", color: "#B8AFA8", textTransform: "uppercase", whiteSpace: "nowrap" }}>Or use single sign-on</span>
                <div style={{ flex: 1, height: "1px", background: "#E2DDD8" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <button onClick={handleGoogle} disabled={loading} style={{ background: "#FAFAF8", border: "1px solid #E2DDD8", borderRadius: "4px", padding: "11px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#3D3530", transition: "all 0.15s" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                  Google
                </button>
                <button disabled style={{ background: "#FAFAF8", border: "1px solid #E2DDD8", borderRadius: "4px", padding: "11px 16px", fontSize: "13px", fontWeight: "500", cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#B8AFA8" }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="#C8C0B8" strokeWidth="1.5" /><path d="M5 8h6M8 5v6" stroke="#C8C0B8" strokeWidth="1.5" /></svg>
                  SSO
                </button>
              </div>
              <p style={{ marginTop: "22px", fontSize: "14px", color: "#7A6F66" }}>
                New to Editorial AI?{" "}
                <button onClick={() => { setMode("signup"); setError(""); }} style={{ background: "none", border: "none", color: "#2B4EFF", cursor: "pointer", fontSize: "14px", fontWeight: "500" }}>Create an account</button>
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
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#F5F2EC", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontFamily: "'DM Sans',sans-serif", color: "#7A6F66" }}>Loading...</span></div>}>
      <LoginContent />
    </Suspense>
  );
}