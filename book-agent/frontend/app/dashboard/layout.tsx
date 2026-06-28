"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.push("/login");
      } else {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--void)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'DM Sans', sans-serif",
          color: "var(--text-primary)",
        }}
      >
        <div style={{ position: "relative", marginBottom: "20px" }}>
          <Loader
            size={36}
            style={{
              animation: "spin 1.4s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite",
              color: "var(--sapphire)",
              filter: "drop-shadow(0 0 8px rgba(37, 99, 235, 0.35))",
            }}
          />
        </div>
        <p style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.6 }}>
          Verifying Session
        </p>
        <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--sapphire)", animation: "pulse 1.2s infinite ease-in-out" }} />
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--sapphire)", animation: "pulse 1.2s infinite ease-in-out 0.2s" }} />
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--sapphire)", animation: "pulse 1.2s infinite ease-in-out 0.4s" }} />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
