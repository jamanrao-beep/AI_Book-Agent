"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/firebase";
import {
  LayoutDashboard,
  BookOpen,
  Library,
  Settings,
  Plus,
  FileText,
  LogOut,
} from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/books", label: "My Books", icon: BookOpen },
    { href: "/dashboard/library", label: "Library", icon: Library },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="sidebar">
      {/* Brand */}
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "2px" }}>
          <div style={{
            width: "28px", height: "28px",
            background: "linear-gradient(135deg, #3B6FFF 0%, #6B93FF 100%)",
            borderRadius: "7px",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(59,111,255,0.4)",
          }}>
            <FileText size={14} color="white" />
          </div>
          <span style={{
            fontWeight: "700", fontSize: "14px",
            letterSpacing: "-0.01em", color: "#F0F2F8",
            fontFamily: "'Geist', sans-serif",
          }}>
            Editorial AI
          </span>
        </div>
        <p style={{
          fontSize: "10px", color: "#4A5468",
          marginLeft: "38px", letterSpacing: "0.08em",
          textTransform: "uppercase", fontFamily: "'Geist', sans-serif",
          fontWeight: "500",
        }}>
          Enterprise Suite
        </p>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, paddingTop: "12px" }}>
        <div style={{ padding: "0 8px 8px", fontSize: "10px", fontWeight: "600", letterSpacing: "0.08em", color: "#4A5468", textTransform: "uppercase", marginLeft: "8px", marginBottom: "4px" }}>
          Navigation
        </div>
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`nav-item ${isActive ? "active" : ""}`}
            >
              <Icon size={15} />
              {label}
              {isActive && (
                <div style={{
                  marginLeft: "auto", width: "5px", height: "5px",
                  borderRadius: "50%", background: "#3B6FFF",
                }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* New Book CTA */}
      <div style={{ padding: "12px 12px 16px" }}>
        <Link href="/dashboard/books?new=1" style={{ textDecoration: "none" }}>
          <button style={{
            width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "8px",
            background: "linear-gradient(135deg, #3B6FFF 0%, #5B85FF 100%)",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "10px 16px",
            fontSize: "13px", fontWeight: "600",
            cursor: "pointer",
            fontFamily: "'Geist', sans-serif",
            boxShadow: "0 2px 12px rgba(59,111,255,0.3)",
            transition: "all 0.2s",
          }}>
            <Plus size={14} />
            New Book
          </button>
        </Link>

        {/* Sign out */}
        <button
          onClick={() => logout().then(() => router.push("/login"))}
          style={{
            width: "100%", marginTop: "6px",
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "8px",
            background: "transparent",
            color: "#4A5468",
            border: "1px solid rgba(255,255,255,0.055)",
            borderRadius: "8px",
            padding: "8px 16px",
            fontSize: "12px", fontWeight: "500",
            cursor: "pointer",
            fontFamily: "'Geist', sans-serif",
            transition: "all 0.2s",
          }}
          onMouseOver={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#8A94A8";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
          }}
          onMouseOut={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#4A5468";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.055)";
          }}
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </div>
  );
}
