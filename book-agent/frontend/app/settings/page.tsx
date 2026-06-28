"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, logout } from "@/lib/firebase";
import {
    ArrowLeft,
    Settings,
    Shield,
    Database,
    Key,
    User as UserIcon,
    LogOut,
    ExternalLink,
    CheckCircle,
} from "lucide-react";

export default function SettingsPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [twoFactor, setTwoFactor] = useState(true);
    const [defaultFormat, setDefaultFormat] = useState("docx");
    const [wppDefault, setWppDefault] = useState(350);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) router.push("/login");
            else setUser(u);
        });
        return () => unsub();
    }, [router]);

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2400);
    };

    return (
        <div style={{ minHeight: "100vh", background: "var(--void)", fontFamily: "'DM Sans', sans-serif", color: "var(--text-primary)", position: "relative" }}>
            <div className="grid-overlay" />

            {/* Nav */}
            <nav className="glass" style={{
                borderBottom: "1.5px solid var(--border-mid)",
                padding: "0 40px", height: "60px",
                display: "flex", alignItems: "center", justifyItems: "center",
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
                        <Settings size={14} color="var(--void)" />
                    </div>
                    <span style={{ fontWeight: "800", fontSize: "14px", color: "var(--text-primary)" }}>Settings</span>
                </div>
            </nav>

            <main style={{ maxWidth: "860px", margin: "0 auto", padding: "64px 32px 96px", position: "relative", zIndex: 2 }}>
                
                {/* Page header */}
                <div style={{ marginBottom: "40px" }}>
                    <h1 className="serif" style={{ fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
                        Preferences & Identity
                    </h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
                        Configure your user profile, default layout configurations, and model credentials.
                    </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
                    
                    {/* Profile Panel */}
                    <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <UserIcon size={14} color="var(--sapphire)" />
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                Profile Settings
                            </span>
                        </div>

                        {/* Avatar */}
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
                            <div style={{
                                width: "48px", height: "48px", borderRadius: "10px",
                                background: "var(--text-primary)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: "18px", fontFamily: "serif",
                                color: "var(--void)", fontWeight: "700", flexShrink: 0,
                            }}>
                                {user?.displayName?.[0] || user?.email?.[0]?.toUpperCase() || "?"}
                            </div>
                            <div>
                                <h4 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>
                                    {user?.displayName || "Anonymous Publisher"}
                                </h4>
                                <p style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "2px" }}>
                                    {user?.email}
                                </p>
                            </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <div>
                                <label className="field-label">Display Name</label>
                                <input type="text" defaultValue={user?.displayName || ""} placeholder="Your name" className="input-field" />
                            </div>
                            <div>
                                <label className="field-label">Email Address</label>
                                <input type="email" value={user?.email || ""} readOnly className="input-field" style={{ opacity: 0.6, cursor: "not-allowed" }} />
                            </div>
                        </div>
                    </div>

                    {/* Account Prefs Panel */}
                    <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <Database size={14} color="var(--sapphire)" />
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                Account Preferences
                            </span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            <div>
                                <label className="field-label">Default Format</label>
                                <select value={defaultFormat} onChange={e => setDefaultFormat(e.target.value)} className="input-field">
                                    <option value="docx">DOCX (Manuscript)</option>
                                    <option value="pdf">PDF (Print Ready)</option>
                                    <option value="both">Both PDF + DOCX</option>
                                </select>
                            </div>

                            <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                                    <span style={{ fontWeight: "700" }}>Words Per Page:</span>
                                    <span style={{ color: "var(--sapphire)", fontWeight: "700" }}>{wppDefault} words</span>
                                </div>
                                <input type="range" min={100} max={600} step={25} value={wppDefault} onChange={e => setWppDefault(Number(e.target.value))} style={{ width: "100%" }} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Second row: Security & Credentials */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "32px" }}>
                    
                    {/* Security Toggle Switch Panel */}
                    <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <Shield size={14} color="var(--sapphire)" />
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                Security & Access
                            </span>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Two-Factor Auth</p>
                                <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>Require confirmation code on email</p>
                            </div>

                            {/* Sliding Check Switch */}
                            <div
                                onClick={() => setTwoFactor(!twoFactor)}
                                style={{
                                    width: "44px", height: "24px", borderRadius: "12px",
                                    background: twoFactor ? "var(--sapphire)" : "var(--border-strong)",
                                    position: "relative", cursor: "pointer", transition: "background 0.2s"
                                }}
                            >
                                <div style={{
                                    width: "18px", height: "18px", borderRadius: "50%",
                                    background: "var(--void)", position: "absolute", top: "3px",
                                    left: twoFactor ? "23px" : "3px", transition: "left 0.2s"
                                }} />
                            </div>
                        </div>
                    </div>

                    {/* API credentials mock */}
                    <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <Key size={14} color="var(--sapphire)" />
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                Model Access Credentials
                            </span>
                        </div>
                        <div>
                            <label className="field-label">Custom Gemini API Key</label>
                            <input type="password" value="••••••••••••••••••••" readOnly className="input-field" style={{ opacity: 0.6 }} />
                        </div>
                    </div>
                </div>

                {/* Save Feedback */}
                {saved && (
                    <div className="fade-in" style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)",
                        borderRadius: "10px", padding: "12px 16px", marginBottom: "20px",
                        fontSize: "13px", color: "var(--emerald)", fontWeight: "600",
                    }}>
                        <CheckCircle size={15} /> Preferences saved successfully.
                    </div>
                )}

                {/* Action buttons */}
                <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={handleSave} className="btn-dark" style={{ padding: "10px 24px", fontSize: "13px", borderRadius: "10px" }}>
                        Save Changes
                    </button>
                    <button onClick={() => logout().then(() => router.push("/login"))} className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 24px", fontSize: "13px", borderRadius: "10px", borderColor: "var(--crimson)", color: "var(--crimson)" }}>
                        <LogOut size={13} /> Sign Out
                    </button>
                </div>
            </main>
        </div>
    );
}
