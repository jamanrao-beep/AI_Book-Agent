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
      <div
        style={{ padding: "24px 20px 20px", borderBottom: "1px solid #e8e8e4" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "2px",
          }}
        >
          <div
            style={{
              width: "30px",
              height: "30px",
              background: "#1a1a1a",
              borderRadius: "6px",
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
              fontSize: "16px",
              letterSpacing: "-0.01em",
            }}
          >
            Editorial AI
          </span>
        </div>
        <p
          style={{
            fontSize: "11px",
            color: "#888",
            marginLeft: "40px",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Enterprise Suite
        </p>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, paddingTop: "16px" }}>
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item ${pathname === href ? "active" : ""}`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      {/* New Book CTA */}
      <div style={{ padding: "16px" }}>
        <Link href="/dashboard/books?new=1">
          <button
            className="btn-dark"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              borderRadius: "8px",
            }}
          >
            <Plus size={16} />
            New Book
          </button>
        </Link>
      </div>
    </div>
  );
}
