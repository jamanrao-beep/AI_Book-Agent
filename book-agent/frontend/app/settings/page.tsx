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
    ToggleLeft,
    ToggleRight,
    User as UserIcon,
    LogOut,
    ExternalLink,
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
                        background: "rgba(138,148,168,0.1)", border: "1px solid rgba(138,148,168,0.18)",
                        borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Settings size={13} color="#555555" />
                    </div>
                    <span style={{ fontWeight: "600", fontSize: "14px" }}>Settings</span>
                </div>
            </nav>

            <main style={{ maxWidth: "820px", margin: "0 auto", padding: "48px 32px 80px" }}>

                {/* Header */}
                <div style={{ marginBottom: "40px" }}>
                    <h1 style={{
                        fontFamily: "'Playfair Display', serif",
                        fontSize: "34px", fontWeight: "400",
                        letterSpacing: "-0.02em", marginBottom: "6px",
                    }}>
                        Preferences & Identity
                    </h1>
                    <p style={{ color: "#555555", fontSize: "14px" }}>
                        Configure your editorial environment and AI behavioral parameters
                    </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>

                    {/* Profile settings */}
                    <div style={{ background: "#faf8f5", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "14px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <UserIcon size={14} color="#555555" />
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#737373", textTransform: "uppercase" }}>
                                Profile Settings
                            </span>
                        </div>

                        {/* Avatar + info */}
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
                            <div style={{
                                width: "52px", height: "52px", borderRadius: "12px",
                                background: "linear-gradient(135deg, #3B6FFF, #9B6DFF)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: "20px", fontFamily: "'Playfair Display', serif",
                                color: "#2a2929", fontWeight: "400", flexShrink: 0,
                            }}>
                                {user?.displayName?.[0] || user?.email?.[0]?.toUpperCase() || "?"}
                            </div>
                            <div>
                                <div style={{ fontSize: "15px", fontWeight: "600" }}>
                                    {user?.displayName || "Anonymous User"}
                                </div>
                                <div style={{ fontSize: "12px", color: "#555555", marginTop: "2px" }}>
                                    {user?.email}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <div>
                                <label className="field-label">Full Name</label>
                                <input
                                    type="text"
                                    defaultValue={user?.displayName || ""}
                                    placeholder="Your full name"
                                    className="input-field"
                                />
                            </div>
                            <div>
                                <label className="field-label">Primary Email</label>
                                <input
                                    type="email"
                                    value={user?.email || ""}
                                    readOnly
                                    className="input-field"
                                    style={{ opacity: 0.6, cursor: "not-allowed" }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Account preferences */}
                    <div style={{ background: "#faf8f5", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "14px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <Database size={14} color="#555555" />
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#737373", textTransform: "uppercase" }}>
                                Account Preferences
                            </span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            <div>
                                <label className="field-label">Default Output Format</label>
                                <select
                                    value={defaultFormat}
                                    onChange={e => setDefaultFormat(e.target.value)}
                                    className="input-field"
                                >
                                    <option value="docx">DOCX (Manuscript)</option>
                                    <option value="pdf">PDF (Print Ready)</option>
                                    <option value="both">Both PDF + DOCX</option>
                                </select>
                            </div>

                            <div>
                                <label className="field-label">
                                    Words Per Page (Avg){" "}
                                    <span style={{ color: "#3B6FFF", fontWeight: "700", textTransform: "none", letterSpacing: 0, fontSize: "12px" }}>
                                        {wppDefault}
                                    </span>
                                </label>
                                <input
                                    type="range" min={100} max={600} step={25}
                                    value={wppDefault} onChange={e => setWppDefault(Number(e.target.value))}
                                    style={{ width: "100%", marginTop: "8px" }}
                                />
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#737373", marginTop: "4px" }}>
                                    <span>100</span><span>Used for progress estimation</span><span>600</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>

                    {/* Security */}
                    <div style={{ background: "#faf8f5", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "14px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <Shield size={14} color="#555555" />
                                <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#737373", textTransform: "uppercase" }}>
                                    Security & Access
                                </span>
                            </div>
                            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10D98A" }} />
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            <div style={{
                                background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)",
                                borderRadius: "10px", padding: "14px 16px",
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                            }}>
                                <div>
                                    <div style={{ fontWeight: "600", fontSize: "14px" }}>Password</div>
                                    <div style={{ fontSize: "11px", color: "#737373", marginTop: "2px" }}>Last changed 4 months ago</div>
                                </div>
                                <button style={{
                                    background: "rgba(59,111,255,0.1)", border: "1px solid rgba(59,111,255,0.2)",
                                    borderRadius: "7px", padding: "7px 14px",
                                    color: "#6B93FF", fontSize: "12px", fontWeight: "600", cursor: "pointer",
                                }}>Change</button>
                            </div>

                            <div style={{
                                background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)",
                                borderRadius: "10px", padding: "14px 16px",
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                            }}>
                                <div>
                                    <div style={{ fontWeight: "600", fontSize: "14px" }}>Two-factor authentication</div>
                                    <div style={{ fontSize: "11px", color: "#737373", marginTop: "2px" }}>Security key or mobile app</div>
                                </div>
                                <button
                                    onClick={() => setTwoFactor(!twoFactor)}
                                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                                >
                                    {twoFactor
                                        ? <div style={{ width: "40px", height: "22px", borderRadius: "11px", background: "#3B6FFF", position: "relative", transition: "all 0.2s" }}>
                                            <div style={{ position: "absolute", right: "3px", top: "3px", width: "16px", height: "16px", borderRadius: "50%", background: "white" }} />
                                        </div>
                                        : <div style={{ width: "40px", height: "22px", borderRadius: "11px", background: "rgba(0,0,0,0.08)", position: "relative", transition: "all 0.2s" }}>
                                            <div style={{ position: "absolute", left: "3px", top: "3px", width: "16px", height: "16px", borderRadius: "50%", background: "rgba(0,0,0,0.4)" }} />
                                        </div>
                                    }
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* API & Integrations */}
                    <div style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: "14px", padding: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                            <Key size={14} color="#555555" />
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#737373", textTransform: "uppercase" }}>
                                API & Integrations
                            </span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            <div style={{
                                background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)",
                                borderRadius: "10px", padding: "14px 16px",
                                display: "flex", alignItems: "center", gap: "12px",
                            }}>
                                <div style={{
                                    width: "34px", height: "34px", flexShrink: 0,
                                    background: "rgba(16,217,138,0.1)", border: "1px solid rgba(16,217,138,0.2)",
                                    borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10D98A" }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: "600", fontSize: "13px" }}>Groq API Status</div>
                                    <div style={{ fontSize: "11px", color: "#10D98A", marginTop: "2px" }}>Operational · Latency 42ms</div>
                                </div>
                                <button style={{
                                    background: "none", border: "1px solid rgba(0,0,0,0.08)",
                                    borderRadius: "7px", padding: "6px 12px",
                                    color: "#555555", fontSize: "12px", cursor: "pointer",
                                    display: "flex", alignItems: "center", gap: "4px",
                                }}>
                                    Manage <ExternalLink size={11} />
                                </button>
                            </div>

                            <div style={{
                                background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)",
                                borderRadius: "10px", padding: "14px 16px",
                                display: "flex", alignItems: "center", gap: "12px",
                            }}>
                                <div style={{
                                    width: "34px", height: "34px", flexShrink: 0,
                                    background: "rgba(59,111,255,0.1)", border: "1px solid rgba(59,111,255,0.2)",
                                    borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                    <Database size={14} color="#6B93FF" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: "600", fontSize: "13px" }}>Data & Archiving</div>
                                    <div style={{ fontSize: "11px", color: "#737373", marginTop: "2px" }}>Last export 2 days ago</div>
                                </div>
                                <button style={{
                                    background: "rgba(59,111,255,0.1)", border: "1px solid rgba(59,111,255,0.2)",
                                    borderRadius: "7px", padding: "6px 12px",
                                    color: "#6B93FF", fontSize: "12px", fontWeight: "600", cursor: "pointer",
                                }}>
                                    Export
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Save button */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginBottom: "32px" }}>
                    <button className="btn-ghost" onClick={() => router.push("/dashboard")}>
                        Cancel
                    </button>
                    <button
                        className="btn-dark"
                        onClick={handleSave}
                        style={{ padding: "11px 28px" }}
                    >
                        {saved ? "✓ Saved" : "Save Changes"}
                    </button>
                </div>

                {/* Danger zone */}
                <div style={{
                    background: "rgba(255,77,106,0.04)",
                    border: "1px solid rgba(255,77,106,0.15)",
                    borderRadius: "14px", padding: "24px",
                }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#FF4D6A", textTransform: "uppercase", marginBottom: "12px" }}>
                        Danger Zone
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                            <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "4px" }}>Deactivate Workspace</div>
                            <div style={{ fontSize: "13px", color: "#555555" }}>
                                Temporarily disable your Publixo AI account and freeze all active manuscript tokens.
                            </div>
                        </div>
                        <button style={{
                            background: "none", border: "1px solid rgba(255,77,106,0.3)",
                            borderRadius: "8px", padding: "9px 18px",
                            color: "#FF4D6A", fontSize: "13px", fontWeight: "600", cursor: "pointer",
                            whiteSpace: "nowrap", marginLeft: "16px",
                            transition: "all 0.2s",
                        }}
                            onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,77,106,0.08)"; }}
                            onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                        >
                            Deactivate Account
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    marginTop: "32px", paddingTop: "24px",
                    borderTop: "1px solid rgba(0,0,0,0.06)",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    fontSize: "12px", color: "#737373",
                }}>
                    <span>© 2025 Publixo AI Suite · v2.4.0-Stable</span>
                    <div style={{ display: "flex", gap: "16px" }}>
                        <span style={{ cursor: "pointer" }}>Privacy Policy</span>
                        <span style={{ cursor: "pointer" }}>Terms of Excellence</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "#10D98A" }}>
                            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10D98A" }} />
                            Secure Session Active
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
