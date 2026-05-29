"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Upload, CheckCircle, Download, Sparkles, LayoutTemplate, X,
    FileText, Archive, BookMarked, ChevronDown, ChevronUp, Ruler, Paintbrush,
    MessageSquare, Type, AlignJustify, Wand2, BookOpen, Settings2, Info,
    Globe, Printer, BookCopy, ListOrdered, ChevronRight, Layers, FileOutput,
    SlidersHorizontal, PenTool, LayoutPanelLeft, RefreshCw, Star, Save,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Home Screen Mode ──────────────────────────────────────────────────────────
type AppMode = "home" | "author" | "advanced";

// ─── Page Presets ─────────────────────────────────────────────────────────────
const PAGE_PRESETS = [
    { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
    { label: "A5 (148 × 210 mm)", w: 148, h: 210 },
    { label: "US Letter (216 × 279 mm)", w: 216, h: 279 },
    { label: "US Trade 6×9 (152 × 229 mm)", w: 152, h: 229 },
    { label: "Pocket 4×6 (102 × 152 mm)", w: 102, h: 152 },
    { label: "Square (210 × 210 mm)", w: 210, h: 210 },
    { label: "Custom", w: 0, h: 0 },
];

// ─── Languages ────────────────────────────────────────────────────────────────
const LANGUAGES = [
    { value: "english", label: "English" },
    { value: "hindi", label: "Hindi (हिन्दी)" },
    { value: "tamil", label: "Tamil (தமிழ்)" },
    { value: "telugu", label: "Telugu (తెలుగు)" },
    { value: "bengali", label: "Bengali (বাংলা)" },
    { value: "marathi", label: "Marathi (मराठी)" },
    { value: "gujarati", label: "Gujarati (ગુજરાતી)" },
    { value: "punjabi", label: "Punjabi (ਪੰਜਾਬੀ)" },
    { value: "malayalam", label: "Malayalam (മലയാളം)" },
    { value: "kannada", label: "Kannada (ಕನ್ನಡ)" },
    { value: "urdu", label: "Urdu (اردو)" },
    { value: "french", label: "French" },
    { value: "spanish", label: "Spanish" },
    { value: "german", label: "German" },
    { value: "arabic", label: "Arabic (عربي)" },
    { value: "chinese", label: "Chinese (中文)" },
    { value: "japanese", label: "Japanese (日本語)" },
    { value: "other", label: "Other" },
];

// ─── Print Platforms ──────────────────────────────────────────────────────────
const PRINT_PLATFORMS = [
    { key: "kdp", label: "Amazon KDP", desc: "Kindle Direct Publishing", icon: "📦", hint: "6×9 or 5×8, 300 DPI, no bleed for text-only" },
    { key: "ingram", label: "IngramSpark", desc: "Global POD distribution", icon: "🌐", hint: "Supports bleed, offset printing standards" },
    { key: "offset", label: "Offset Print", desc: "Traditional bulk printing", icon: "🖨️", hint: "Full bleed, CMYK, press-ready PDF/X-1a" },
    { key: "digital", label: "Digital / Screen", desc: "E-book, screen reading", icon: "💻", hint: "RGB, screen-optimised, no bleed required" },
    { key: "other", label: "Other / Generic", desc: "Generic print-ready", icon: "📄", hint: "Standard margins, generic print safe" },
];

// ─── Book Types ───────────────────────────────────────────────────────────────
const BOOK_TYPES = [
    { key: "novel", icon: "📖", label: "Novel", subtitle: "Fiction / Story", description: "Clean readable layout, flowing text, drop caps", accent: "#6366f1", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.3)", defaultSize: { label: "5×8 (127 × 203 mm)", w: 127, h: 203 }, aiHint: "5×8 trim size is most popular for novels", designHint: "Classic readable serif typography with generous margins and drop caps" },
    { key: "poetry", icon: "✍️", label: "Poetry / Shayari", subtitle: "Verse / Lyric / Ghazal", description: "Preserved line breaks, elegant spacing", accent: "#ec4899", bg: "rgba(236,72,153,0.08)", border: "rgba(236,72,153,0.3)", defaultSize: { label: "5×8 (127 × 203 mm)", w: 127, h: 203 }, aiHint: "5×8 is the perfect intimate size for poetry", designHint: "Romance — elegant serif, generous whitespace, preserved poetic line breaks" },
    { key: "academic", icon: "🎓", label: "Academic / Educational", subtitle: "Textbook / Study Material", description: "Structured headings, references, clean hierarchy", accent: "#0ea5e9", bg: "rgba(14,165,233,0.08)", border: "rgba(14,165,233,0.3)", defaultSize: { label: "A4 (210 × 297 mm)", w: 210, h: 297 }, aiHint: "A4 or 6×9 works best for academic books", designHint: "School Guide Style — clean headers, structured layout, academic typography" },
    { key: "biography", icon: "👤", label: "Biography / Memoir", subtitle: "Life story / Autobiography", description: "Elegant narrative layout, photo-friendly", accent: "#14b8a6", bg: "rgba(20,184,166,0.08)", border: "rgba(20,184,166,0.3)", defaultSize: { label: "US Trade 6×9 (152 × 229 mm)", w: 152, h: 229 }, aiHint: "6×9 is the standard for biographies and memoirs", designHint: "Editorial narrative — clean serif, generous margins, photo-plate friendly" },
    { key: "children", icon: "👶", label: "Children's Book", subtitle: "Stories / Picture Books", description: "Large fonts, image spaces, playful layout", accent: "#10b981", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.3)", defaultSize: { label: "Square (210 × 210 mm)", w: 210, h: 210 }, aiHint: "Square format is fun and popular for children's books", designHint: "Children's book — large playful fonts, pastel colours, wide margins for illustrations" },
    { key: "religious", icon: "🕌", label: "Religious / Spiritual", subtitle: "Scripture / Discourse / Devotional", description: "Decorative headings, ornate chapter dividers", accent: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.3)", defaultSize: { label: "A5 (148 × 210 mm)", w: 148, h: 210 }, aiHint: "A5 is the traditional size for religious texts", designHint: "Bhagavad Gita Style — warm cream pages, decorative ornaments, classic serif" },
    { key: "business", icon: "💼", label: "Business / Self-help", subtitle: "Motivational / Professional", description: "Modern clean design, bold headings", accent: "#8b5cf6", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.3)", defaultSize: { label: "US Trade 6×9 (152 × 229 mm)", w: 152, h: 229 }, aiHint: "6×9 is the professional standard for business books", designHint: "Modern minimalist — clean sans-serif, bold chapter headings, structured layout" },
    { key: "custom", icon: "✏️", label: "Custom / Other", subtitle: "Define your own style", description: "Describe exactly what you want", accent: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.3)", defaultSize: { label: "A4 (210 × 297 mm)", w: 210, h: 297 }, aiHint: "You'll provide a custom description — AI will follow your exact instructions", designHint: "" },
];

// ─── Visual Templates ─────────────────────────────────────────────────────────
const VISUAL_TEMPLATES = [
    { key: "classic_novel", name: "Classic Novel", emoji: "📚", desc: "Premchand Novel Style", colors: ["#f5f0e8", "#2d2016", "#8b4513", "#c8a96e"], mood: "Timeless · Warm · Literary", designText: "Classic cream pages with serif fonts, drop caps and ornamental chapter dividers" },
    { key: "premium_hardcover", name: "Premium Hardcover", emoji: "🏆", desc: "Luxury Edition Style", colors: ["#0f0f0f", "#e8d5b0", "#c8a200", "#666666"], mood: "Luxury · Dark · Gold", designText: "Luxury dark theme with gold accents, wide margins and elegant typography" },
    { key: "modern_minimal", name: "Modern Minimal", emoji: "⚡", desc: "Contemporary Clean", colors: ["#ffffff", "#1a1a2e", "#4a90d9", "#e8eaed"], mood: "Clean · Modern · Crisp", designText: "Modern minimalist with clean sans-serif typography and subtle accents" },
    { key: "sanskrit_style", name: "Sanskrit / Vedic", emoji: "🕉️", desc: "Bhagavad Gita Style", colors: ["#fef9f0", "#5c3d11", "#d4a017", "#8b6914"], mood: "Sacred · Traditional · Gold", designText: "Traditional sacred style — warm saffron accents, ornate headings, classic serif" },
    { key: "school_guide", name: "School Guide", emoji: "📝", desc: "Academic Textbook", colors: ["#f8fafc", "#0f172a", "#2563eb", "#e2e8f0"], mood: "Clear · Structured · Academic", designText: "School Guide Style — structured headers, clean sans-serif, academic layout" },
    { key: "thriller_dark", name: "Thriller Dark", emoji: "🌑", desc: "High Contrast Mystery", colors: ["#111827", "#f9fafb", "#ef4444", "#374151"], mood: "Dark · Intense · Dramatic", designText: "Thriller — high contrast dark pages, sharp modern layout, dramatic headings" },
    { key: "retro_vintage", name: "Retro Vintage", emoji: "🗞️", desc: "Old-style Antique", colors: ["#f5ead0", "#3d2b1f", "#8b4513", "#c4a76e"], mood: "Nostalgic · Warm · Antique", designText: "Retro vintage — warm sepia tones, old-style fonts, diagonal motifs" },
    { key: "poetry_bloom", name: "Poetry Bloom", emoji: "🌸", desc: "Romance / Shayari Style", colors: ["#fff0f5", "#4a1942", "#d63384", "#f8c8d8"], mood: "Romantic · Delicate · Poetic", designText: "Romance — blush tones, italic serif, floral ornaments, poetic spacing" },
    { key: "custom", name: "Custom / Other", emoji: "✏️", desc: "Describe your own style", colors: ["#1e293b", "#e2e8f0", "#f59e0b", "#475569"], mood: "Your Vision · AI Executed", designText: "" },
];

// ─── Size Visual Options ──────────────────────────────────────────────────────
const SIZE_VISUAL = [
    { key: "5x8", label: "5 × 8", desc: "Novel size", w: 127, h: 203, popular: "Novels" },
    { key: "55x85", label: "5.5 × 8.5", desc: "Standard", w: 140, h: 216, popular: "Self-help" },
    { key: "6x9", label: "6 × 9", desc: "Trade size", w: 152, h: 229, popular: "Business" },
    { key: "A4", label: "A4", desc: "Print/Academic", w: 210, h: 297, popular: "Academic" },
    { key: "custom", label: "Custom", desc: "Any size", w: 0, h: 0, popular: "" },
];

// ─── Font Prefs ───────────────────────────────────────────────────────────────
const FONT_PREFS = [
    { key: "modern", label: "Modern", font: "Helvetica", desc: "Clean sans-serif" },
    { key: "traditional", label: "Traditional", font: "Times-Roman", desc: "Classic serif" },
    { key: "premium", label: "Premium", font: "Times-Italic", desc: "Elegant italic" },
    { key: "readable", label: "Easy to Read", font: "Helvetica", desc: "High readability" },
    { key: "custom", label: "Custom", font: "", desc: "Describe your own" },
];

// ─── Spacing Options ──────────────────────────────────────────────────────────
const SPACING_OPTS = [
    { key: "compact", label: "Compact", value: "1.3", desc: "More text per page" },
    { key: "balanced", label: "Balanced", value: "1.5", desc: "Recommended", popular: true },
    { key: "spacious", label: "Spacious", value: "1.8", desc: "Airy, easy reading" },
    { key: "custom", label: "Custom", value: "", desc: "Describe your own" },
];

// ─── Advanced font options ────────────────────────────────────────────────────
const FONT_OPTIONS = [
    { label: "AI Choice (auto)", value: "" },
    { label: "Times Roman (classic serif)", value: "Times-Roman" },
    { label: "Times Italic (italic serif)", value: "Times-Italic" },
    { label: "Helvetica (clean sans-serif)", value: "Helvetica" },
    { label: "Helvetica Oblique (oblique sans)", value: "Helvetica-Oblique" },
    { label: "Courier (monospace)", value: "Courier" },
];

const LINE_SPACING_OPTIONS = [
    { label: "AI Choice (auto)", value: "" },
    { label: "Tight (1.2×)", value: "1.2" },
    { label: "Normal (1.4×)", value: "1.4" },
    { label: "Comfortable (1.6×)", value: "1.6" },
    { label: "Relaxed (1.8×)", value: "1.8" },
    { label: "Double (2.0×)", value: "2.0" },
];

const CHAPTER_START_OPTIONS = [
    { label: "AI decides", value: "" },
    { label: "Right-hand page (recto)", value: "right_page" },
    { label: "Left-hand page (verso)", value: "left_page" },
    { label: "Any page (no blank pages)", value: "any_page" },
];

const HEADING_DESIGN_OPTIONS = [
    { label: "AI decides", value: "" },
    { label: "Centered, large, decorative", value: "centered_decorative" },
    { label: "Left-aligned, bold, clean", value: "left_bold_clean" },
    { label: "ALL CAPS with rule line", value: "allcaps_rule" },
    { label: "Italic elegant", value: "italic_elegant" },
    { label: "Numbered chapters", value: "numbered" },
    { label: "Small caps with ornament", value: "smallcaps_ornament" },
];

// ─── Front/Back Matter items ──────────────────────────────────────────────────
const FRONT_MATTER_ITEMS = [
    { key: "title_page", label: "Title Page" },
    { key: "copyright_page", label: "Copyright Page" },
    { key: "dedication", label: "Dedication" },
    { key: "foreword", label: "Foreword" },
    { key: "preface", label: "Preface" },
    { key: "acknowledgement", label: "Acknowledgements" },
    { key: "toc", label: "Table of Contents" },
];

const BACK_MATTER_ITEMS = [
    { key: "about_author", label: "About the Author" },
    { key: "about_publisher", label: "About the Publisher" },
    { key: "references", label: "References" },
    { key: "bibliography", label: "Bibliography" },
    { key: "index", label: "Index" },
    { key: "other_books", label: "Other Books by Author" },
];

// ─── Saved Templates ──────────────────────────────────────────────────────────
interface SavedTemplate {
    id: string;
    name: string;
    createdAt: string;
    settings: Record<string, unknown>;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface LayoutConcept {
    style_name: string;
    page_bg: string;
    text_color: string;
    chapter_title_color: string;
    accent_color: string;
    body_font: string;
    body_font_size: number;
    line_spacing: number;
    first_para_indent_mm?: number;
    margin_top_mm: number;
    margin_bottom_mm: number;
    margin_left_mm: number;
    margin_right_mm: number;
    chapter_font: string;
    chapter_font_size: number;
    chapter_prefix: string;
    show_drop_cap: boolean;
    ornament: string;
    header_text: string;
    show_page_numbers: boolean;
    // Advanced fields
    paragraph_spacing_mm?: number;
    gutter_mm?: number;
    mirror_margins?: boolean;
    color_mode?: string;
    bleed_mm?: number;
    chapter_start?: string;
    page_number_start?: number;
    page_number_style?: string;
    heading_design?: string;
    section_breaks?: boolean;
    footer_left_text?: string;
    footer_right_pagenum?: boolean;
    front_matter?: string[];
    back_matter?: string[];
    _book_type?: string;
    _book_type_label?: string;
}

interface LayoutResult {
    job_id: string;
    title: string;
    style_name: string;
    concept: LayoutConcept;
    chapter_count: number;
    chapter_titles: string[];
    book_type: string;
    book_type_label: string;
    pdf_url: string;
    docx_url: string;
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "13px",
    color: "#e2e8f0",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
};

const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: "0.06em",
    display: "block",
    marginBottom: "6px",
};

const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
    appearance: "none" as React.CSSProperties["appearance"],
};

// ─── Reusable Components ───────────────────────────────────────────────────────
function CollapsibleSection({ title, icon, children, defaultOpen = false }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" }}>
            <button onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "rgba(255,255,255,0.03)", border: "none", color: "#e2e8f0", cursor: "pointer", fontSize: "13px", fontWeight: "700" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>{icon}<span>{title}</span></div>
                {open ? <ChevronUp size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
            </button>
            {open && <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>{children}</div>}
        </div>
    );
}

function MatterCheckbox({ items, selected, onChange }: { items: { key: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void; label: string }) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {items.map((item) => {
                const checked = selected.includes(item.key);
                return (
                    <label key={item.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: checked ? "rgba(245,158,11,0.1)" : "rgba(0,0,0,0.2)", border: `1px solid ${checked ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "8px", cursor: "pointer", fontSize: "12px", color: checked ? "#fbbf24" : "#64748b", transition: "all 0.15s" }}>
                        <input type="checkbox" checked={checked} onChange={() => { if (checked) onChange(selected.filter((k) => k !== item.key)); else onChange([...selected, item.key]); }} style={{ accentColor: "#f59e0b" }} />
                        {item.label}
                    </label>
                );
            })}
        </div>
    );
}

function TriToggle({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
    return (
        <div>
            <span style={labelStyle}>{label}</span>
            <div style={{ display: "flex", gap: "6px" }}>
                {([null, true, false] as const).map((v) => (
                    <button key={String(v)} onClick={() => onChange(v)} style={{ flex: 1, padding: "7px 0", borderRadius: "7px", border: `1px solid ${value === v ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`, background: value === v ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.2)", color: value === v ? "#fbbf24" : "#64748b", fontSize: "11px", fontWeight: "700", cursor: "pointer", transition: "all 0.15s" }}>
                        {v === null ? "AI" : v ? "On" : "Off"}
                    </button>
                ))}
            </div>
        </div>
    );
}

function focusBorder(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    e.currentTarget.style.borderColor = "rgba(245,158,11,0.5)";
}
function blurBorder(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeScreen({ onSelect }: { onSelect: (m: AppMode) => void }) {
    return (
        <div style={{ minHeight: "100vh", background: "#0c0f1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 40px", fontFamily: "'DM Sans', sans-serif" }}>
            <div style={{ textAlign: "center", marginBottom: "56px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "24px", padding: "8px 20px", marginBottom: "24px" }}>
                    <div style={{ width: "28px", height: "28px", background: "linear-gradient(135deg,#f59e0b,#d97706)", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <LayoutTemplate size={14} color="white" />
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: "800", color: "#fbbf24", letterSpacing: "0.08em" }}>EDITORIAL AI · BOOK LAYOUT DESIGNER</span>
                </div>
                <h1 style={{ fontSize: "52px", fontWeight: "900", letterSpacing: "-0.04em", color: "#e2e8f0", marginBottom: "16px", fontFamily: "'Playfair Display', serif", lineHeight: "1.05" }}>
                    Design Your Book<br /><span style={{ color: "#f59e0b" }}>Like a Publisher</span>
                </h1>
                <p style={{ color: "#64748b", fontSize: "16px", lineHeight: "1.7", maxWidth: "520px", margin: "0 auto" }}>
                    Choose your experience. Authors get one-click AI formatting. Professionals get full publishing-grade control.
                </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", maxWidth: "820px", width: "100%" }}>
                {/* Author Mode */}
                <button onClick={() => onSelect("author")} style={{ background: "rgba(99,102,241,0.07)", border: "2px solid rgba(99,102,241,0.25)", borderRadius: "20px", padding: "40px 36px", textAlign: "left", cursor: "pointer", transition: "all 0.25s", position: "relative", overflow: "hidden" }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.6)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.12)"; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.25)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.07)"; }}>
                    <div style={{ fontSize: "42px", marginBottom: "18px" }}>👤</div>
                    <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#e2e8f0", marginBottom: "8px", fontFamily: "'Playfair Display', serif" }}>Author Mode</h2>
                    <p style={{ fontSize: "12px", fontWeight: "700", color: "#6366f1", marginBottom: "16px", letterSpacing: "0.06em" }}>SIMPLE · GUIDED · ONE-CLICK</p>
                    <p style={{ fontSize: "14px", color: "#64748b", lineHeight: "1.6", marginBottom: "24px" }}>Best for authors who want AI to handle the entire formatting process automatically. No technical knowledge needed.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "28px" }}>
                        {["Upload manuscript → AI does everything", "Auto-detect chapters & headings", "Generate TOC, title pages, footers", "One-click print-ready PDF + DOCX"].map((t, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#94a3b8" }}>
                                <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#6366f1", flexShrink: 0 }} /> {t}
                            </div>
                        ))}
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: "10px", padding: "10px 20px", fontSize: "14px", fontWeight: "700", color: "#a5b4fc" }}>
                        Get Started <ChevronRight size={15} />
                    </div>
                </button>

                {/* Advanced Mode */}
                <button onClick={() => onSelect("advanced")} style={{ background: "rgba(245,158,11,0.06)", border: "2px solid rgba(245,158,11,0.2)", borderRadius: "20px", padding: "40px 36px", textAlign: "left", cursor: "pointer", transition: "all 0.25s", position: "relative", overflow: "hidden" }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(245,158,11,0.55)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.1)"; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(245,158,11,0.2)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,158,11,0.06)"; }}>
                    <div style={{ fontSize: "42px", marginBottom: "18px" }}>⚙️</div>
                    <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#e2e8f0", marginBottom: "8px", fontFamily: "'Playfair Display', serif" }}>Advanced Mode</h2>
                    <p style={{ fontSize: "12px", fontWeight: "700", color: "#f59e0b", marginBottom: "16px", letterSpacing: "0.06em" }}>PROFESSIONAL · CUSTOMISABLE · AI COMMAND</p>
                    <p style={{ fontSize: "14px", color: "#64748b", lineHeight: "1.6", marginBottom: "24px" }}>For publishers, editors, designers and advanced users who require complete control over layout and print-production settings.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "28px" }}>
                        {["Custom trim size, margins, gutter & bleed", "Mirror margins & section breaks", "Front & back matter configuration", "Print platform packages: KDP, IngramSpark"].map((t, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#94a3b8" }}>
                                <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#f59e0b", flexShrink: 0 }} /> {t}
                            </div>
                        ))}
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: "10px", padding: "10px 20px", fontSize: "14px", fontWeight: "700", color: "#fbbf24" }}>
                        Open Advanced Mode <ChevronRight size={15} />
                    </div>
                </button>
            </div>

            <p style={{ marginTop: "40px", color: "#334155", fontSize: "12px", textAlign: "center" }}>
                Powered by GPT-4o · Typeset with ReportLab · Output: PDF · DOCX · EPUB
            </p>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function LayoutDesignerPage() {
    const router = useRouter();

    // ── App mode ──────────────────────────────────────────────────────────────
    const [appMode, setAppMode] = useState<AppMode>("home");

    // ── Upload ────────────────────────────────────────────────────────────────
    const [file, setFile] = useState<File | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    // ── Basic fields ──────────────────────────────────────────────────────────
    const [bookTitle, setBookTitle] = useState("");
    const [language, setLanguage] = useState("english");
    const [bookTypeKey, setBookTypeKey] = useState<string | null>(null);
    const [customBookTypeDesc, setCustomBookTypeDesc] = useState("");
    const [templateKey, setTemplateKey] = useState<string | null>(null);
    const [customTemplateDesc, setCustomTemplateDesc] = useState("");
    const [printPlatform, setPrintPlatform] = useState<string>("kdp");

    // ── Author wizard ─────────────────────────────────────────────────────────
    const [selectedSizeKey, setSelectedSizeKey] = useState<string>("A4");
    const [fontPrefKey, setFontPrefKey] = useState<string>("traditional");
    const [spacingKey, setSpacingKey] = useState<string>("balanced");
    const [customSizeW, setCustomSizeW] = useState(210);
    const [customSizeH, setCustomSizeH] = useState(297);
    const [customFontDesc, setCustomFontDesc] = useState("");
    const [customSpacingDesc, setCustomSpacingDesc] = useState("");

    // ── Advanced page settings ────────────────────────────────────────────────
    const [presetIndex, setPresetIndex] = useState(0);
    const [customW, setCustomW] = useState(210);
    const [customH, setCustomH] = useState(297);

    // ── Typography overrides ──────────────────────────────────────────────────
    const [bodyFont, setBodyFont] = useState("");
    const [chapterFont, setChapterFont] = useState("");
    const [bodyFontSize, setBodyFontSize] = useState("");
    const [chapterFontSize, setChapterFontSize] = useState("");
    const [lineSpacing, setLineSpacing] = useState("");
    const [marginTop, setMarginTop] = useState("");
    const [marginBottom, setMarginBottom] = useState("");
    const [marginLeft, setMarginLeft] = useState("");
    const [marginRight, setMarginRight] = useState("");
    const [dropCap, setDropCap] = useState<boolean | null>(null);
    const [pageNumbers, setPageNumbers] = useState<boolean | null>(null);

    // ── Advanced layout controls ──────────────────────────────────────────────
    const [mirrorMargins, setMirrorMargins] = useState<boolean | null>(null);
    const [gutterMm, setGutterMm] = useState("");
    const [bleedMm, setBleedMm] = useState("");
    const [chapterStart, setChapterStart] = useState("");
    const [sectionBreaks, setSectionBreaks] = useState<boolean | null>(null);
    const [headerCustomText, setHeaderCustomText] = useState("");
    const [pageNumberStart, setPageNumberStart] = useState("");
    const [pageNumberStyle, setPageNumberStyle] = useState("");

    // ── Footer settings (new — always-on) ────────────────────────────────────
    const [footerBookName, setFooterBookName] = useState(true);   // bottom-left
    const [footerPageNumber, setFooterPageNumber] = useState(true); // bottom-right
    const [footerCustomLeft, setFooterCustomLeft] = useState(""); // custom text override for left
    const [footerCustomRight, setFooterCustomRight] = useState(""); // custom text override for right

    // ── Typography advanced ───────────────────────────────────────────────────
    const [paragraphSpacingMm, setParagraphSpacingMm] = useState("");
    const [indentMm, setIndentMm] = useState("");
    const [headingDesign, setHeadingDesign] = useState("");
    const [customStylePreset, setCustomStylePreset] = useState("");

    // ── Print production ──────────────────────────────────────────────────────
    const [colorMode, setColorMode] = useState<"bw" | "color" | "">("");
    const [paperProfile, setPaperProfile] = useState("");

    // ── Front / Back matter ───────────────────────────────────────────────────
    const [frontMatter, setFrontMatter] = useState<string[]>(["title_page", "copyright_page", "toc"]);
    const [backMatter, setBackMatter] = useState<string[]>(["about_author"]);

    // ── AI Command Box ────────────────────────────────────────────────────────
    const [aiCommand, setAiCommand] = useState("");
    const AI_COMMAND_EXAMPLES = [
        "Create a premium fiction layout.",
        "Format as a university textbook.",
        "Use mirror margins and start each chapter on a right-hand page.",
        "Create a poetry book with large margins and centered titles.",
        "Follow Chicago style formatting.",
    ];

    // ── Design instructions (shared) ──────────────────────────────────────────
    const [designInstructions, setDesignInstructions] = useState("");

    // ── Template management ───────────────────────────────────────────────────
    const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
    const [templateName, setTemplateName] = useState("");
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);

    // ── Job state ─────────────────────────────────────────────────────────────
    const [jobId, setJobId] = useState<string | null>(null);
    const [stage, setStage] = useState("");
    const [pct, setPct] = useState(0);
    const [statusMsg, setStatusMsg] = useState("");
    const [result, setResult] = useState<LayoutResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // ── Advanced panels ───────────────────────────────────────────────────────
    const [showTypoPanel, setShowTypoPanel] = useState(false);

    // ── Derived ───────────────────────────────────────────────────────────────
    const bookType = BOOK_TYPES.find((t) => t.key === bookTypeKey);
    const template = VISUAL_TEMPLATES.find((t) => t.key === templateKey);
    const selectedSize = SIZE_VISUAL.find((s) => s.key === selectedSizeKey) ?? SIZE_VISUAL[2];
    const fontPref = FONT_PREFS.find((f) => f.key === fontPrefKey) ?? FONT_PREFS[1];
    const spacing = SPACING_OPTS.find((s) => s.key === spacingKey) ?? SPACING_OPTS[1];
    const isAdvanced = appMode === "advanced";

    const preset = PAGE_PRESETS[presetIndex];
    const isCustomPreset = preset.label === "Custom";
    const isCustomSizeKey = selectedSizeKey === "custom";

    const _rawPageW = isAdvanced ? (isCustomPreset ? customW : preset.w) : (isCustomSizeKey ? customSizeW : selectedSize.w);
    const _rawPageH = isAdvanced ? (isCustomPreset ? customH : preset.h) : (isCustomSizeKey ? customSizeH : selectedSize.h);
    const pageW = Math.max(50, Math.min(600, _rawPageW || 210));
    const pageH = Math.max(50, Math.min(600, _rawPageH || 297));

    const activeOverrides = [bodyFont, chapterFont, bodyFontSize, chapterFontSize, lineSpacing, marginTop, marginBottom, marginLeft, marginRight, gutterMm, bleedMm, paragraphSpacingMm, indentMm].filter(Boolean).length + (dropCap !== null ? 1 : 0) + (pageNumbers !== null ? 1 : 0) + (mirrorMargins !== null ? 1 : 0);

    // ── Build AI design instructions ──────────────────────────────────────────
    function buildDesignInstructions(): string {
        // AI command box takes highest priority
        if (aiCommand.trim()) {
            // Still inject footer instructions into AI command
            const footerInstructions = buildFooterInstructions();
            return aiCommand.trim() + (footerInstructions ? " " + footerInstructions : "");
        }
        if (designInstructions.trim()) return designInstructions.trim();

        const parts: string[] = [];

        // Language
        const lang = LANGUAGES.find(l => l.value === language);
        if (lang && language !== "english") parts.push(`Book language: ${lang.label}. Use appropriate Unicode fonts.`);

        // Print platform
        const platform = PRINT_PLATFORMS.find(p => p.key === printPlatform);
        if (platform) parts.push(`Target print platform: ${platform.label}. ${platform.hint}.`);

        // Template
        if (templateKey === "custom" && customTemplateDesc.trim()) parts.push(customTemplateDesc.trim());
        else if (template && templateKey !== "custom") parts.push(template.designText);
        else if (bookTypeKey === "custom" && customBookTypeDesc.trim()) parts.push(`Book type: ${customBookTypeDesc.trim()}`);
        else if (bookType) parts.push(bookType.designHint);

        // Spacing (author mode)
        if (!isAdvanced) {
            if (spacingKey === "custom" && customSpacingDesc.trim()) parts.push(`spacing preference: ${customSpacingDesc.trim()}`);
            else if (spacingKey === "compact") parts.push("compact tight spacing");
            else if (spacingKey === "spacious") parts.push("spacious airy layout");
            if (fontPrefKey === "custom" && customFontDesc.trim()) parts.push(`font preference: ${customFontDesc.trim()}`);
        }

        // Advanced layout controls
        if (mirrorMargins === true) parts.push("Use mirror margins (inside/outside gutter) for double-sided printing.");
        if (gutterMm) parts.push(`Gutter size: ${gutterMm}mm for binding.`);
        if (bleedMm) parts.push(`Bleed: ${bleedMm}mm on all sides.`);
        if (chapterStart === "right_page") parts.push("Start every chapter on a right-hand (recto) page.");
        else if (chapterStart === "left_page") parts.push("Start every chapter on a left-hand (verso) page.");
        else if (chapterStart === "any_page") parts.push("Chapters may start on any page (no blank pages).");
        if (sectionBreaks === true) parts.push("Use visible section breaks between major sections.");
        if (headerCustomText.trim()) parts.push(`Header text: "${headerCustomText.trim()}" on left/right pages.`);
        if (pageNumberStart) parts.push(`Page numbering starts at page ${pageNumberStart}.`);
        if (pageNumberStyle === "roman") parts.push("Use roman numerals (i, ii, iii) for front matter.");

        // Footer: always include footer instructions based on settings
        parts.push(buildFooterInstructions());

        // Typography advanced
        if (paragraphSpacingMm) parts.push(`Paragraph spacing: ${paragraphSpacingMm}mm.`);
        if (indentMm) parts.push(`First-line indent: ${indentMm}mm.`);
        if (headingDesign) {
            const hd = HEADING_DESIGN_OPTIONS.find(h => h.value === headingDesign);
            if (hd && hd.value) parts.push(`Chapter heading design: ${hd.label}.`);
        }
        if (customStylePreset.trim()) parts.push(`Style preset: ${customStylePreset.trim()}.`);

        // Print production
        if (colorMode === "bw") parts.push("Black & white interior only. No colour ink.");
        else if (colorMode === "color") parts.push("Full colour interior. Optimise for colour printing.");
        if (paperProfile.trim()) parts.push(`Paper profile: ${paperProfile.trim()}.`);

        // Front matter — include all items in the text instruction for AI awareness
        if (frontMatter.length > 0) {
            const labels = frontMatter.map(k => FRONT_MATTER_ITEMS.find(i => i.key === k)?.label ?? k);
            parts.push(`Include front matter: ${labels.join(", ")}.`);
        }
        if (!frontMatter.includes("toc")) parts.push("Do NOT generate a Table of Contents.");

        // Back matter
        if (backMatter.length > 0) {
            const labels = backMatter.map(k => BACK_MATTER_ITEMS.find(i => i.key === k)?.label ?? k);
            parts.push(`Include back matter: ${labels.join(", ")}.`);
        }

        return parts.filter(Boolean).join(" ");
    }

    function buildFooterInstructions(): string {
        const leftText = footerCustomLeft.trim() || (footerBookName ? "book title" : "");
        const rightText = footerCustomRight.trim() || (footerPageNumber ? "page number" : "");
        const parts: string[] = [];
        if (leftText) parts.push(`Footer bottom-left: ${leftText}`);
        if (rightText) parts.push(`footer bottom-right: ${rightText}`);
        if (parts.length === 0) return "No footer required.";
        return parts.join(", ") + " on ALL pages including chapter starts.";
    }

    // ── Drag & Drop ───────────────────────────────────────────────────────────
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) validateAndSetFile(f);
    }, []);

    function validateAndSetFile(f: File) {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        if (!["pdf", "docx", "zip"].includes(ext)) { setError("Only PDF, DOCX, or ZIP files are supported."); return; }
        if (f.size > 150 * 1024 * 1024) { setError("File is too large. Maximum 150 MB."); return; }
        setFile(f);
        setError(null);
        if (!bookTitle) setBookTitle(f.name.replace(/\.(pdf|docx|zip)$/i, "").replace(/[_-]/g, " "));
    }

    // ── Poll ──────────────────────────────────────────────────────────────────
    function startPolling(jid: string) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/layout/${jid}/status`);
                const data = await res.json();
                setStage(data.stage); setPct(data.pct); setStatusMsg(data.message);
                if (data.stage === "done" && data.result) {
                    clearInterval(pollRef.current!); pollRef.current = null;
                    setResult(data.result); setLoading(false);
                } else if (data.stage === "error") {
                    clearInterval(pollRef.current!); pollRef.current = null;
                    setError(data.message || "Layout generation failed."); setLoading(false);
                }
            } catch { /* transient network error */ }
        }, 1800);
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    async function handleSubmit() {
        if (!file) { setError("Please upload a book file first."); return; }
        setError(null); setLoading(true); setResult(null);
        setStage("queued"); setPct(0); setStatusMsg("Uploading…");

        try {
            const form = new FormData();
            form.append("file", file);
            form.append("page_width_mm", pageW.toString());
            form.append("page_height_mm", pageH.toString());
            form.append("book_title", bookTitle.trim());
            form.append("design_instructions", buildDesignInstructions());

            if (bookTypeKey && bookTypeKey !== "custom") form.append("book_type", bookTypeKey);
            if (templateKey && templateKey !== "custom") form.append("visual_template", templateKey);

            const effectiveBodyFont = bodyFont || (!isAdvanced && fontPrefKey !== "custom" ? fontPref.font : "");
            const effectiveLineSpacing = lineSpacing || (!isAdvanced && spacingKey !== "custom" ? spacing.value : "");
            if (effectiveBodyFont) form.append("body_font", effectiveBodyFont);
            if (chapterFont) form.append("chapter_font", chapterFont);
            if (bodyFontSize) form.append("body_font_size", bodyFontSize);
            if (chapterFontSize) form.append("chapter_font_size", chapterFontSize);
            if (effectiveLineSpacing) form.append("line_spacing", effectiveLineSpacing);
            if (marginTop) form.append("margin_top_mm", marginTop);
            if (marginBottom) form.append("margin_bottom_mm", marginBottom);
            if (marginLeft) form.append("margin_left_mm", marginLeft);
            if (marginRight) form.append("margin_right_mm", marginRight);
            if (dropCap !== null) form.append("show_drop_cap", String(dropCap));
            // Always send show_page_numbers based on footer setting
            const effectivePageNumbers = pageNumbers !== null ? pageNumbers : footerPageNumber;
            form.append("show_page_numbers", String(effectivePageNumbers));

            // ── Footer ────────────────────────────────────────────────────────
            const effectiveFooterLeft = footerCustomLeft.trim() || (footerBookName ? bookTitle.trim() || "" : "");
            if (effectiveFooterLeft) form.append("footer_left_text", effectiveFooterLeft);
            form.append("footer_right_pagenum", String(effectivePageNumbers));

            // ── Advanced layout overrides ─────────────────────────────────────
            if (mirrorMargins !== null) form.append("mirror_margins", String(mirrorMargins));
            if (gutterMm) form.append("gutter_mm", gutterMm);
            if (paragraphSpacingMm) form.append("paragraph_spacing_mm", paragraphSpacingMm);
            if (indentMm) form.append("indent_mm", indentMm);
            if (colorMode) form.append("color_mode", colorMode);
            if (bleedMm) form.append("bleed_mm", bleedMm);
            if (chapterStart) form.append("chapter_start", chapterStart);
            if (pageNumberStart) form.append("page_number_start", pageNumberStart);
            if (pageNumberStyle) form.append("page_number_style", pageNumberStyle);
            if (headerCustomText.trim()) form.append("header_custom_text", headerCustomText.trim());
            if (headingDesign) form.append("heading_design", headingDesign);
            if (sectionBreaks !== null) form.append("section_breaks", String(sectionBreaks));
            // front/back matter as JSON arrays — send the full list including toc
            // (toc key is handled natively by the backend renderer)
            form.append("front_matter", JSON.stringify(frontMatter));
            form.append("back_matter", JSON.stringify(backMatter));

            const res = await fetch(`${API_BASE}/design-layout`, { method: "POST", body: form });
            if (!res.ok) { const err = await res.json().catch(() => ({ detail: "Server error" })); throw new Error(err.detail || `HTTP ${res.status}`); }
            const { job_id } = await res.json();
            setJobId(job_id);
            startPolling(job_id);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "An unexpected error occurred.");
            setLoading(false);
        }
    }

    // ── Save template ─────────────────────────────────────────────────────────
    function saveTemplate() {
        if (!templateName.trim()) return;
        const tmpl: SavedTemplate = {
            id: Date.now().toString(),
            name: templateName.trim(),
            createdAt: new Date().toLocaleDateString(),
            settings: { bookTypeKey, templateKey, printPlatform, bodyFont, chapterFont, bodyFontSize, chapterFontSize, lineSpacing, marginTop, marginBottom, marginLeft, marginRight, mirrorMargins, gutterMm, bleedMm, chapterStart, headingDesign, colorMode, frontMatter, backMatter, footerBookName, footerPageNumber, footerCustomLeft, footerCustomRight },
        };
        setSavedTemplates([...savedTemplates, tmpl]);
        setTemplateName("");
        setShowSaveTemplate(false);
    }

    function loadTemplate(tmpl: SavedTemplate) {
        const s = tmpl.settings as Record<string, unknown>;
        if (s.bookTypeKey) setBookTypeKey(s.bookTypeKey as string);
        if (s.templateKey) setTemplateKey(s.templateKey as string);
        if (s.printPlatform) setPrintPlatform(s.printPlatform as string);
        if (s.bodyFont) setBodyFont(s.bodyFont as string);
        if (s.chapterFont) setChapterFont(s.chapterFont as string);
        if (s.bodyFontSize) setBodyFontSize(s.bodyFontSize as string);
        if (s.chapterFontSize) setChapterFontSize(s.chapterFontSize as string);
        if (s.lineSpacing) setLineSpacing(s.lineSpacing as string);
        if (s.marginTop) setMarginTop(s.marginTop as string);
        if (s.marginBottom) setMarginBottom(s.marginBottom as string);
        if (s.marginLeft) setMarginLeft(s.marginLeft as string);
        if (s.marginRight) setMarginRight(s.marginRight as string);
        if (s.gutterMm) setGutterMm(s.gutterMm as string);
        if (s.bleedMm) setBleedMm(s.bleedMm as string);
        if (s.chapterStart) setChapterStart(s.chapterStart as string);
        if (s.headingDesign) setHeadingDesign(s.headingDesign as string);
        if (s.colorMode) setColorMode(s.colorMode as "bw" | "color" | "");
        if (s.frontMatter) setFrontMatter(s.frontMatter as string[]);
        if (s.backMatter) setBackMatter(s.backMatter as string[]);
        if (s.footerBookName !== undefined) setFooterBookName(s.footerBookName as boolean);
        if (s.footerPageNumber !== undefined) setFooterPageNumber(s.footerPageNumber as boolean);
        if (s.footerCustomLeft) setFooterCustomLeft(s.footerCustomLeft as string);
        if (s.footerCustomRight) setFooterCustomRight(s.footerCustomRight as string);
    }

    // ── Reset ─────────────────────────────────────────────────────────────────
    function reset() {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setFile(null); setJobId(null); setResult(null); setError(null); setLoading(false);
        setStage(""); setPct(0); setStatusMsg(""); setBookTitle("");
        setBookTypeKey(null); setTemplateKey(null); setSelectedSizeKey("A4");
        setBodyFont(""); setChapterFont(""); setBodyFontSize(""); setChapterFontSize("");
        setLineSpacing(""); setMarginTop(""); setMarginBottom(""); setMarginLeft(""); setMarginRight("");
        setDropCap(null); setPageNumbers(null); setDesignInstructions(""); setAiCommand("");
        setCustomBookTypeDesc(""); setCustomTemplateDesc(""); setCustomFontDesc(""); setCustomSpacingDesc("");
        setCustomSizeW(210); setCustomSizeH(297);
        setMirrorMargins(null); setGutterMm(""); setBleedMm(""); setChapterStart(""); setSectionBreaks(null);
        setHeaderCustomText(""); setPageNumberStart(""); setPageNumberStyle("");
        setParagraphSpacingMm(""); setIndentMm(""); setHeadingDesign(""); setCustomStylePreset("");
        setColorMode(""); setPaperProfile("");
        setFrontMatter(["title_page", "copyright_page", "toc"]); setBackMatter(["about_author"]);
        setFooterBookName(true); setFooterPageNumber(true); setFooterCustomLeft(""); setFooterCustomRight("");
    }

    const STAGE_LABELS: Record<string, string> = { queued: "Queued", extracting: "Extracting text…", parsing: "Detecting chapters…", designing: "AI designing layout…", rendering: "Typesetting PDF…", rendering_docx: "Generating DOCX…", done: "Done!", error: "Error" };

    // ── Home screen ───────────────────────────────────────────────────────────
    if (appMode === "home") return <HomeScreen onSelect={(m) => setAppMode(m)} />;

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div style={{ minHeight: "100vh", background: "#0c0f1a", fontFamily: "'DM Sans', sans-serif", color: "#e2e8f0" }}>

            {/* ── Nav ── */}
            <nav style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 40px", height: "60px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(12,15,26,0.95)", backdropFilter: "blur(12px)", zIndex: 50 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", background: "linear-gradient(135deg,#f59e0b,#d97706)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <LayoutTemplate size={16} color="white" />
                    </div>
                    <span style={{ fontWeight: "700", fontSize: "15px", letterSpacing: "-0.01em" }}>Editorial AI</span>
                    <div style={{ marginLeft: "8px", background: isAdvanced ? "rgba(245,158,11,0.15)" : "rgba(99,102,241,0.15)", border: `1px solid ${isAdvanced ? "rgba(245,158,11,0.4)" : "rgba(99,102,241,0.4)"}`, borderRadius: "6px", padding: "2px 10px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.06em", color: isAdvanced ? "#fbbf24" : "#a5b4fc" }}>
                        {isAdvanced ? "⚙️ ADVANCED" : "👤 AUTHOR"}
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button onClick={() => { reset(); setAppMode("home"); }} style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 14px", color: "#94a3b8", fontSize: "12px", cursor: "pointer", transition: "color 0.2s" }} onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }} onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}>
                        <Layers size={13} /> Switch Mode
                    </button>
                    <button onClick={() => router.push("/dashboard")} style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 14px", color: "#94a3b8", fontSize: "13px", cursor: "pointer" }} onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }} onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}>
                        <ArrowLeft size={14} /> Dashboard
                    </button>
                </div>
            </nav>

            <main style={{ maxWidth: "940px", margin: "0 auto", padding: "52px 40px" }}>

                {/* Page header */}
                <div style={{ marginBottom: "40px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "20px", padding: "4px 14px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#fbbf24", marginBottom: "18px" }}>
                        <Wand2 size={11} /> {isAdvanced ? "ADVANCED PUBLISHING MODE" : "AI AUTHOR ASSISTANT"}
                    </div>
                    <h1 style={{ fontSize: "38px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'Playfair Display', serif", lineHeight: "1.1", marginBottom: "10px" }}>
                        {isAdvanced ? "Professional Book Layout" : "Design Your Book Layout"}
                    </h1>
                    <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6" }}>
                        {isAdvanced ? "Full publishing-grade control with AI-powered customisation and command." : "Upload your manuscript — AI handles everything else."}
                    </p>
                </div>

                {/* Error banner */}
                {error && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "12px", padding: "16px 20px", marginBottom: "28px" }}>
                        <X size={16} color="#ef4444" style={{ marginTop: "1px", flexShrink: 0 }} />
                        <div style={{ fontSize: "13px", color: "#fca5a5", lineHeight: "1.5" }}>{error}</div>
                        <button onClick={() => setError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", flexShrink: 0 }}><X size={14} /></button>
                    </div>
                )}

                {/* ── RESULT SCREEN ── */}
                {result ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                        {/* Success header */}
                        <div style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(245,158,11,0.05) 100%)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "20px", padding: "32px 36px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                                <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <CheckCircle size={22} color="#10b981" />
                                </div>
                                <div>
                                    <div style={{ fontSize: "18px", fontWeight: "800", color: "#e2e8f0" }}>Layout Ready!</div>
                                    <div style={{ fontSize: "12px", color: "#64748b" }}>{result.chapter_count} chapter{result.chapter_count !== 1 ? "s" : ""} typeset · Style: {result.style_name}</div>
                                </div>
                            </div>

                            {/* Layout concept preview */}
                            {result.concept && (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "24px" }}>
                                    {[
                                        { label: "Page Background", value: result.concept.page_bg, isColor: true },
                                        { label: "Text Color", value: result.concept.text_color, isColor: true },
                                        { label: "Accent Color", value: result.concept.accent_color, isColor: true },
                                        { label: "Body Font", value: result.concept.body_font, isColor: false },
                                        { label: "Body Size", value: `${result.concept.body_font_size}pt`, isColor: false },
                                        { label: "Line Spacing", value: `${result.concept.line_spacing}×`, isColor: false },
                                        { label: "Drop Caps", value: result.concept.show_drop_cap ? "Yes" : "No", isColor: false },
                                        { label: "Page Numbers", value: result.concept.show_page_numbers ? "Yes" : "No", isColor: false },
                                    ].map((item, i) => (
                                        <div key={i} style={{ background: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "10px 12px" }}>
                                            <div style={{ fontSize: "9px", fontWeight: "700", color: "#475569", letterSpacing: "0.06em", marginBottom: "4px" }}>{item.label}</div>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                {item.isColor && <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: item.value, border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0 }} />}
                                                <span style={{ fontSize: "11px", fontWeight: "700", color: "#94a3b8" }}>{item.value}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Footer preview */}
                            <div style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "10px", padding: "12px 16px", marginBottom: "24px" }}>
                                <div style={{ fontSize: "10px", fontWeight: "700", color: "#f59e0b", letterSpacing: "0.06em", marginBottom: "8px" }}>📄 FOOTER (ALL PAGES)</div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "12px", color: "#64748b" }}>⬅ {footerCustomLeft || (footerBookName ? result.title || "Book Title" : "—")}</span>
                                    <span style={{ fontSize: "11px", color: "#334155" }}>· · ·</span>
                                    <span style={{ fontSize: "12px", color: "#64748b" }}>{footerCustomRight || (footerPageNumber ? "Page 1" : "—")} ➡</span>
                                </div>
                            </div>

                            {/* Chapter list */}
                            {result.chapter_titles && result.chapter_titles.length > 0 && (
                                <div style={{ marginBottom: "24px" }}>
                                    <div style={{ fontSize: "11px", fontWeight: "700", color: "#475569", letterSpacing: "0.06em", marginBottom: "10px" }}>CHAPTERS DETECTED</div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                        {result.chapter_titles.slice(0, 12).map((t, i) => (
                                            <div key={i} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", color: "#64748b" }}>{t}</div>
                                        ))}
                                        {result.chapter_titles.length > 12 && <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", color: "#64748b" }}>+{result.chapter_titles.length - 12} more</div>}
                                    </div>
                                </div>
                            )}

                            {/* Download buttons */}
                            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                                <a href={`${API_BASE}${result.pdf_url}`} download style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "linear-gradient(135deg,#f59e0b,#d97706)", color: "#0c0f1a", borderRadius: "12px", padding: "14px 24px", fontSize: "14px", fontWeight: "800", textDecoration: "none", transition: "opacity 0.2s" }} onMouseOver={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = "0.88"; }} onMouseOut={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = "1"; }}>
                                    <Download size={16} /> Download PDF
                                </a>
                                <a href={`${API_BASE}${result.docx_url}`} download style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(99,102,241,0.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.4)", borderRadius: "12px", padding: "14px 24px", fontSize: "14px", fontWeight: "800", textDecoration: "none", transition: "opacity 0.2s" }} onMouseOver={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = "0.88"; }} onMouseOut={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = "1"; }}>
                                    <FileText size={16} /> Download DOCX
                                </a>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.04)", color: "#334155", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "14px 24px", fontSize: "14px", fontWeight: "700" }}>
                                    📱 EPUB <span style={{ fontSize: "10px", color: "#475569", background: "rgba(255,255,255,0.05)", borderRadius: "4px", padding: "2px 6px" }}>soon</span>
                                </div>
                                {isAdvanced && (
                                    <>
                                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.04)", color: "#334155", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "14px 24px", fontSize: "14px", fontWeight: "700" }}>
                                            📦 KDP Package <span style={{ fontSize: "10px", color: "#475569", background: "rgba(255,255,255,0.05)", borderRadius: "4px", padding: "2px 6px" }}>soon</span>
                                        </div>
                                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.04)", color: "#334155", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "14px 24px", fontSize: "14px", fontWeight: "700" }}>
                                            🌐 IngramSpark <span style={{ fontSize: "10px", color: "#475569", background: "rgba(255,255,255,0.05)", borderRadius: "4px", padding: "2px 6px" }}>soon</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: "12px" }}>
                            <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "12px 20px", color: "#94a3b8", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                                <RefreshCw size={14} /> Design Another Book
                            </button>
                        </div>
                    </div>
                ) : loading ? (
                    /* ── PROGRESS SCREEN ── */
                    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "20px", padding: "48px 40px", textAlign: "center" }}>
                        <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                            <Wand2 size={24} color="#f59e0b" style={{ animation: "spin 2s linear infinite" }} />
                        </div>
                        <div style={{ fontSize: "20px", fontWeight: "800", color: "#e2e8f0", marginBottom: "8px" }}>
                            {STAGE_LABELS[stage] || "Processing…"}
                        </div>
                        <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "32px" }}>{statusMsg}</div>
                        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: "8px", height: "6px", overflow: "hidden", marginBottom: "12px" }}>
                            <div style={{ height: "100%", background: "linear-gradient(90deg,#f59e0b,#d97706)", width: `${pct}%`, transition: "width 0.5s ease", borderRadius: "8px" }} />
                        </div>
                        <div style={{ fontSize: "12px", color: "#475569" }}>{pct}% complete</div>
                        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "28px", flexWrap: "wrap" }}>
                            {Object.entries(STAGE_LABELS).filter(([k]) => k !== "error").map(([k, v]) => (
                                <div key={k} style={{ fontSize: "10px", fontWeight: "700", padding: "4px 10px", borderRadius: "6px", background: stage === k ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.03)", color: stage === k ? "#fbbf24" : "#334155", border: `1px solid ${stage === k ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.05)"}` }}>{v}</div>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* ── FORM ── */
                    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

                        {/* ── File Upload ── */}
                        <section>
                            <div onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onClick={() => !file && fileInputRef.current?.click()} style={{ border: `2px dashed ${dragging ? "rgba(245,158,11,0.6)" : file ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: "16px", padding: "40px 32px", textAlign: "center", cursor: file ? "default" : "pointer", transition: "all 0.2s", background: dragging ? "rgba(245,158,11,0.04)" : file ? "rgba(16,185,129,0.03)" : "rgba(255,255,255,0.01)" }}>
                                {file ? (
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px" }}>
                                        <div style={{ width: "44px", height: "44px", background: "rgba(16,185,129,0.1)", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            <FileText size={22} color="#10b981" />
                                        </div>
                                        <div style={{ textAlign: "left" }}>
                                            <div style={{ fontSize: "14px", fontWeight: "700", color: "#e2e8f0" }}>{file.name}</div>
                                            <div style={{ fontSize: "12px", color: "#64748b" }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); setFile(null); }} style={{ marginLeft: "12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "6px 10px", color: "#f87171", cursor: "pointer", fontSize: "12px" }}>Remove</button>
                                    </div>
                                ) : (
                                    <>
                                        <Upload size={28} color="#475569" style={{ marginBottom: "12px" }} />
                                        <div style={{ fontSize: "15px", fontWeight: "700", color: "#94a3b8", marginBottom: "6px" }}>Drop your manuscript here</div>
                                        <div style={{ fontSize: "12px", color: "#475569" }}>PDF, DOCX, or ZIP · up to 150 MB</div>
                                    </>
                                )}
                            </div>
                            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.zip" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f); }} />
                        </section>

                        {/* ── Book Title & Language ── */}
                        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                            <div>
                                <label style={labelStyle}>BOOK TITLE</label>
                                <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="Enter your book title…" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} />
                            </div>
                            <div>
                                <label style={labelStyle}>LANGUAGE</label>
                                <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                    {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                            </div>
                        </section>

                        {/* ── Book Type ── */}
                        <section>
                            <label style={labelStyle}>BOOK TYPE</label>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                                {BOOK_TYPES.map((bt) => {
                                    const sel = bookTypeKey === bt.key;
                                    return (
                                        <button key={bt.key} onClick={() => {
                                            setBookTypeKey(sel ? null : bt.key);
                                            if (!sel && bt.defaultSize) {
                                                const sz = SIZE_VISUAL.find(s => s.w === bt.defaultSize.w && s.h === bt.defaultSize.h);
                                                if (sz) setSelectedSizeKey(sz.key);
                                                if (isAdvanced) {
                                                    const pg = PAGE_PRESETS.findIndex(p => p.w === bt.defaultSize.w && p.h === bt.defaultSize.h);
                                                    if (pg >= 0) setPresetIndex(pg);
                                                }
                                            }
                                        }} style={{ padding: "12px 10px", background: sel ? bt.bg : "rgba(0,0,0,0.2)", border: `1px solid ${sel ? bt.border : "rgba(255,255,255,0.07)"}`, borderRadius: "10px", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                                            <div style={{ fontSize: "18px", marginBottom: "4px" }}>{bt.icon}</div>
                                            <div style={{ fontSize: "11px", fontWeight: "700", color: sel ? bt.accent : "#94a3b8" }}>{bt.label}</div>
                                            <div style={{ fontSize: "9px", color: "#475569", marginTop: "2px" }}>{bt.subtitle}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            {bookTypeKey === "custom" && (
                                <textarea value={customBookTypeDesc} onChange={(e) => setCustomBookTypeDesc(e.target.value)} placeholder="Describe your book type and style in detail…" rows={2} style={{ ...inputStyle, marginTop: "10px", fontSize: "13px", resize: "vertical", lineHeight: "1.5", fontFamily: "inherit" }} onFocus={focusBorder} onBlur={blurBorder} />
                            )}
                        </section>

                        {/* ── Book Size ── */}
                        <section>
                            <label style={labelStyle}>BOOK SIZE</label>
                            {!isAdvanced ? (
                                <>
                                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        {SIZE_VISUAL.map((s) => {
                                            const sel = selectedSizeKey === s.key;
                                            return (
                                                <button key={s.key} onClick={() => setSelectedSizeKey(s.key)} style={{ padding: "10px 16px", background: sel ? "rgba(245,158,11,0.12)" : "rgba(0,0,0,0.2)", border: `1px solid ${sel ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: "10px", cursor: "pointer", textAlign: "center", minWidth: "80px" }}>
                                                    <div style={{ fontSize: "13px", fontWeight: "800", color: sel ? "#fbbf24" : "#e2e8f0" }}>{s.label}</div>
                                                    <div style={{ fontSize: "9px", color: "#64748b", marginTop: "2px" }}>{s.desc}</div>
                                                    {s.popular && <div style={{ fontSize: "8px", color: "#475569", marginTop: "3px" }}>{s.popular}</div>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {isCustomSizeKey && (
                                        <div style={{ display: "flex", gap: "12px", marginTop: "10px" }}>
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>WIDTH (mm)</label>
                                                <input type="number" value={customSizeW} onChange={(e) => setCustomSizeW(Number(e.target.value))} style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={50} max={600} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>HEIGHT (mm)</label>
                                                <input type="number" value={customSizeH} onChange={(e) => setCustomSizeH(Number(e.target.value))} style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={50} max={600} />
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                        <div>
                                            <label style={labelStyle}>PAGE PRESET</label>
                                            <select value={presetIndex} onChange={(e) => setPresetIndex(Number(e.target.value))} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                                {PAGE_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
                                            </select>
                                        </div>
                                        {isCustomPreset && (
                                            <>
                                                <div>
                                                    <label style={labelStyle}>WIDTH (mm)</label>
                                                    <input type="number" value={customW} onChange={(e) => setCustomW(Number(e.target.value))} style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={50} max={600} />
                                                </div>
                                                <div>
                                                    <label style={labelStyle}>HEIGHT (mm)</label>
                                                    <input type="number" value={customH} onChange={(e) => setCustomH(Number(e.target.value))} style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={50} max={600} />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    <div style={{ marginTop: "8px", fontSize: "12px", color: "#475569" }}>
                                        Final size: {pageW} × {pageH} mm
                                    </div>
                                </>
                            )}
                        </section>

                        {/* ── Visual Template ── */}
                        <section>
                            <label style={labelStyle}>INTERIOR STYLE TEMPLATE</label>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                                {VISUAL_TEMPLATES.map((t) => {
                                    const sel = templateKey === t.key;
                                    return (
                                        <button key={t.key} onClick={() => setTemplateKey(sel ? null : t.key)} style={{ padding: "14px", background: sel ? "rgba(245,158,11,0.08)" : "rgba(0,0,0,0.2)", border: `1px solid ${sel ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "10px", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                                <span style={{ fontSize: "18px" }}>{t.emoji}</span>
                                                <span style={{ fontSize: "12px", fontWeight: "700", color: sel ? "#fbbf24" : "#e2e8f0" }}>{t.name}</span>
                                            </div>
                                            <div style={{ display: "flex", gap: "3px", marginBottom: "6px" }}>
                                                {t.colors.map((c, i) => <div key={i} style={{ width: "14px", height: "14px", borderRadius: "3px", background: c, border: "1px solid rgba(255,255,255,0.1)" }} />)}
                                            </div>
                                            <div style={{ fontSize: "9px", color: "#475569" }}>{t.mood}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            {templateKey === "custom" && (
                                <textarea value={customTemplateDesc} onChange={(e) => setCustomTemplateDesc(e.target.value)} placeholder="Describe your style (e.g. dark navy cover with gold lettering, vintage typography)…" rows={2} style={{ ...inputStyle, marginTop: "10px", fontSize: "13px", resize: "vertical", lineHeight: "1.5", fontFamily: "inherit" }} onFocus={focusBorder} onBlur={blurBorder} />
                            )}
                        </section>

                        {/* ── Print Platform ── */}
                        <section>
                            <label style={labelStyle}>PRINT PLATFORM</label>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                {PRINT_PLATFORMS.map((p) => {
                                    const sel = printPlatform === p.key;
                                    return (
                                        <button key={p.key} onClick={() => setPrintPlatform(p.key)} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", background: sel ? "rgba(245,158,11,0.1)" : "rgba(0,0,0,0.2)", border: `1px solid ${sel ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "10px", cursor: "pointer", transition: "all 0.15s" }}>
                                            <span style={{ fontSize: "16px" }}>{p.icon}</span>
                                            <div style={{ textAlign: "left" }}>
                                                <div style={{ fontSize: "12px", fontWeight: "700", color: sel ? "#fbbf24" : "#94a3b8" }}>{p.label}</div>
                                                <div style={{ fontSize: "9px", color: "#475569" }}>{p.desc}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            {printPlatform && (
                                <div style={{ marginTop: "8px", fontSize: "11px", color: "#475569", display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Info size={11} /> {PRINT_PLATFORMS.find(p => p.key === printPlatform)?.hint}
                                </div>
                            )}
                        </section>

                        {/* ── Author Mode: Font & Spacing ── */}
                        {!isAdvanced && (
                            <>
                                <section>
                                    <label style={labelStyle}>FONT PREFERENCE</label>
                                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        {FONT_PREFS.map((f) => {
                                            const sel = fontPrefKey === f.key;
                                            return (
                                                <button key={f.key} onClick={() => setFontPrefKey(f.key)} style={{ padding: "10px 16px", background: sel ? "rgba(99,102,241,0.12)" : "rgba(0,0,0,0.2)", border: `1px solid ${sel ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "10px", cursor: "pointer" }}>
                                                    <div style={{ fontSize: "12px", fontWeight: "700", color: sel ? "#a5b4fc" : "#94a3b8" }}>{f.label}</div>
                                                    <div style={{ fontSize: "9px", color: "#475569" }}>{f.desc}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {fontPrefKey === "custom" && (
                                        <input value={customFontDesc} onChange={(e) => setCustomFontDesc(e.target.value)} placeholder="Describe your font preference…" style={{ ...inputStyle, marginTop: "10px" }} onFocus={focusBorder} onBlur={blurBorder} />
                                    )}
                                </section>
                                <section>
                                    <label style={labelStyle}>LINE SPACING</label>
                                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        {SPACING_OPTS.map((s) => {
                                            const sel = spacingKey === s.key;
                                            return (
                                                <button key={s.key} onClick={() => setSpacingKey(s.key)} style={{ padding: "10px 16px", background: sel ? "rgba(99,102,241,0.12)" : "rgba(0,0,0,0.2)", border: `1px solid ${sel ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "10px", cursor: "pointer", position: "relative" }}>
                                                    <div style={{ fontSize: "12px", fontWeight: "700", color: sel ? "#a5b4fc" : "#94a3b8" }}>{s.label}</div>
                                                    <div style={{ fontSize: "9px", color: "#475569" }}>{s.desc}</div>
                                                    {s.popular && <div style={{ position: "absolute", top: "-6px", right: "-4px", background: "#6366f1", borderRadius: "4px", padding: "1px 5px", fontSize: "8px", color: "white", fontWeight: "800" }}>✓</div>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {spacingKey === "custom" && (
                                        <input value={customSpacingDesc} onChange={(e) => setCustomSpacingDesc(e.target.value)} placeholder="Describe your spacing preference…" style={{ ...inputStyle, marginTop: "10px" }} onFocus={focusBorder} onBlur={blurBorder} />
                                    )}
                                </section>
                            </>
                        )}

                        {/* ── FOOTER SETTINGS (always visible for both modes) ── */}
                        <section style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: "14px", padding: "20px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                                <BookMarked size={14} color="#f59e0b" />
                                <span style={{ fontSize: "13px", fontWeight: "700", color: "#fbbf24" }}>Footer Settings</span>
                                <span style={{ fontSize: "10px", color: "#475569", background: "rgba(245,158,11,0.1)", borderRadius: "4px", padding: "2px 7px" }}>All Pages</span>
                            </div>
                            <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "14px" }}>The footer appears on every page including chapter starts. Bottom-left shows the book name; bottom-right shows the page number.</p>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                                        <label style={{ ...labelStyle, marginBottom: 0 }}>BOTTOM-LEFT (Book Name)</label>
                                        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                                            <input type="checkbox" checked={footerBookName} onChange={(e) => setFooterBookName(e.target.checked)} style={{ accentColor: "#f59e0b" }} />
                                            <span style={{ fontSize: "11px", color: footerBookName ? "#fbbf24" : "#475569" }}>Enabled</span>
                                        </label>
                                    </div>
                                    <input value={footerCustomLeft} onChange={(e) => setFooterCustomLeft(e.target.value)} placeholder={footerBookName ? bookTitle || "Book title (auto)" : "Disabled"} disabled={!footerBookName} style={{ ...inputStyle, opacity: footerBookName ? 1 : 0.4 }} onFocus={focusBorder} onBlur={blurBorder} />
                                    <div style={{ fontSize: "10px", color: "#334155", marginTop: "4px" }}>Leave blank to use book title automatically</div>
                                </div>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                                        <label style={{ ...labelStyle, marginBottom: 0 }}>BOTTOM-RIGHT (Page Number)</label>
                                        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                                            <input type="checkbox" checked={footerPageNumber} onChange={(e) => setFooterPageNumber(e.target.checked)} style={{ accentColor: "#f59e0b" }} />
                                            <span style={{ fontSize: "11px", color: footerPageNumber ? "#fbbf24" : "#475569" }}>Enabled</span>
                                        </label>
                                    </div>
                                    <input value={footerCustomRight} onChange={(e) => setFooterCustomRight(e.target.value)} placeholder={footerPageNumber ? "Page number (auto)" : "Disabled"} disabled={!footerPageNumber} style={{ ...inputStyle, opacity: footerPageNumber ? 1 : 0.4 }} onFocus={focusBorder} onBlur={blurBorder} />
                                    <div style={{ fontSize: "10px", color: "#334155", marginTop: "4px" }}>Leave blank for automatic page numbering</div>
                                </div>
                            </div>
                            {/* Preview */}
                            <div style={{ marginTop: "14px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid rgba(255,255,255,0.05)" }}>
                                <span style={{ fontSize: "11px", color: "#64748b", fontStyle: "italic" }}>{footerCustomLeft || (footerBookName ? (bookTitle || "Your Book Title") : "—")}</span>
                                <span style={{ fontSize: "9px", color: "#334155" }}>· Footer Preview ·</span>
                                <span style={{ fontSize: "11px", color: "#64748b" }}>{footerCustomRight || (footerPageNumber ? "42" : "—")}</span>
                            </div>
                        </section>

                        {/* ── ADVANCED OPTIONS ── */}
                        {isAdvanced && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                                    <Settings2 size={14} color="#f59e0b" />
                                    <span style={{ fontSize: "13px", fontWeight: "800", color: "#fbbf24", letterSpacing: "0.04em" }}>ADVANCED OPTIONS</span>
                                    {activeOverrides > 0 && <div style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "10px", padding: "2px 8px", fontSize: "10px", color: "#fbbf24", fontWeight: "700" }}>{activeOverrides} active</div>}
                                </div>

                                {/* AI Command Box */}
                                <CollapsibleSection title="AI Command Box" icon={<MessageSquare size={14} color="#f59e0b" />} defaultOpen={true}>
                                    <p style={{ fontSize: "12px", color: "#64748b" }}>Give natural-language instructions. AI will interpret and apply formatting automatically.</p>
                                    <textarea value={aiCommand} onChange={(e) => setAiCommand(e.target.value)} placeholder={`Examples:\n• "Create a premium fiction layout."\n• "Format as a university textbook."\n• "Use mirror margins and start each chapter on a right-hand page."\n• "Follow Chicago style formatting."`} rows={5} style={{ ...inputStyle, fontSize: "13px", resize: "vertical", lineHeight: "1.55", fontFamily: "inherit", padding: "12px 14px" }} onFocus={focusBorder} onBlur={blurBorder} />
                                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                        {AI_COMMAND_EXAMPLES.map((ex, i) => (
                                            <button key={i} onClick={() => setAiCommand(ex)} style={{ fontSize: "10px", padding: "4px 10px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "6px", color: "#94a3b8", cursor: "pointer" }}>{ex}</button>
                                        ))}
                                    </div>
                                </CollapsibleSection>

                                {/* Advanced Layout Controls */}
                                <CollapsibleSection title="Advanced Layout Controls" icon={<Ruler size={14} color="#f59e0b" />}>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                        <TriToggle label="Mirror Margins (Double-sided)" value={mirrorMargins} onChange={setMirrorMargins} />
                                        <TriToggle label="Section Breaks" value={sectionBreaks} onChange={setSectionBreaks} />
                                        <div>
                                            <label style={labelStyle}>GUTTER SIZE (mm)</label>
                                            <input type="number" value={gutterMm} onChange={(e) => setGutterMm(e.target.value)} placeholder="AI decides" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={0} max={50} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>BLEED (mm)</label>
                                            <input type="number" value={bleedMm} onChange={(e) => setBleedMm(e.target.value)} placeholder="0 (no bleed)" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={0} max={10} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>CHAPTER START</label>
                                            <select value={chapterStart} onChange={(e) => setChapterStart(e.target.value)} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                                {CHAPTER_START_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>PAGE NUMBER STYLE</label>
                                            <select value={pageNumberStyle} onChange={(e) => setPageNumberStyle(e.target.value)} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                                <option value="">Arabic (1, 2, 3…)</option>
                                                <option value="roman">Roman (i, ii, iii…)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>PAGE NUMBERING STARTS AT</label>
                                            <input type="number" value={pageNumberStart} onChange={(e) => setPageNumberStart(e.target.value)} placeholder="1" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={1} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>HEADER TEXT</label>
                                            <input value={headerCustomText} onChange={(e) => setHeaderCustomText(e.target.value)} placeholder="e.g. My Book Title" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} />
                                        </div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                                        {[
                                            { label: "MARGIN TOP (mm)", val: marginTop, set: setMarginTop },
                                            { label: "MARGIN BOTTOM (mm)", val: marginBottom, set: setMarginBottom },
                                            { label: "MARGIN LEFT (mm)", val: marginLeft, set: setMarginLeft },
                                            { label: "MARGIN RIGHT (mm)", val: marginRight, set: setMarginRight },
                                        ].map((m, i) => (
                                            <div key={i}>
                                                <label style={labelStyle}>{m.label}</label>
                                                <input type="number" value={m.val} onChange={(e) => m.set(e.target.value)} placeholder="AI" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={0} max={100} />
                                            </div>
                                        ))}
                                    </div>
                                </CollapsibleSection>

                                {/* Typography Controls */}
                                <CollapsibleSection title="Typography Controls" icon={<Type size={14} color="#f59e0b" />}>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                                        <div>
                                            <label style={labelStyle}>BODY FONT</label>
                                            <select value={bodyFont} onChange={(e) => setBodyFont(e.target.value)} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                                {FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>CHAPTER HEADING FONT</label>
                                            <select value={chapterFont} onChange={(e) => setChapterFont(e.target.value)} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                                {FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>BODY FONT SIZE (pt)</label>
                                            <input type="number" value={bodyFontSize} onChange={(e) => setBodyFontSize(e.target.value)} placeholder="AI decides" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={8} max={24} step={0.5} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>CHAPTER FONT SIZE (pt)</label>
                                            <input type="number" value={chapterFontSize} onChange={(e) => setChapterFontSize(e.target.value)} placeholder="AI decides" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={10} max={72} step={0.5} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>LINE SPACING</label>
                                            <select value={lineSpacing} onChange={(e) => setLineSpacing(e.target.value)} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                                {LINE_SPACING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>PARAGRAPH SPACING (mm)</label>
                                            <input type="number" value={paragraphSpacingMm} onChange={(e) => setParagraphSpacingMm(e.target.value)} placeholder="AI decides" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={0} max={20} step={0.5} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>FIRST-LINE INDENT (mm)</label>
                                            <input type="number" value={indentMm} onChange={(e) => setIndentMm(e.target.value)} placeholder="AI decides" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} min={0} max={20} step={0.5} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>CHAPTER HEADING DESIGN</label>
                                            <select value={headingDesign} onChange={(e) => setHeadingDesign(e.target.value)} style={selectStyle} onFocus={focusBorder} onBlur={blurBorder}>
                                                {HEADING_DESIGN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <TriToggle label="Drop Caps" value={dropCap} onChange={setDropCap} />
                                        <TriToggle label="Page Numbers" value={pageNumbers} onChange={setPageNumbers} />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>CUSTOM STYLE PRESET</label>
                                        <input value={customStylePreset} onChange={(e) => setCustomStylePreset(e.target.value)} placeholder="e.g. Chicago Manual of Style, APA, MLA…" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} />
                                    </div>
                                </CollapsibleSection>

                                {/* Print Production Controls */}
                                <CollapsibleSection title="Print Production Controls" icon={<Printer size={14} color="#f59e0b" />}>
                                    <div>
                                        <label style={labelStyle}>COLOR MODE</label>
                                        <div style={{ display: "flex", gap: "8px" }}>
                                            {[{ key: "", label: "AI decides" }, { key: "bw", label: "⚫ Black & White" }, { key: "color", label: "🌈 Full Color" }].map(opt => (
                                                <button key={opt.key} onClick={() => setColorMode(opt.key as "bw" | "color" | "")} style={{ flex: 1, padding: "10px", background: colorMode === opt.key ? "rgba(245,158,11,0.12)" : "rgba(0,0,0,0.2)", border: `1px solid ${colorMode === opt.key ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "700", color: colorMode === opt.key ? "#fbbf24" : "#64748b" }}>
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label style={labelStyle}>PAPER PROFILE</label>
                                        <input value={paperProfile} onChange={(e) => setPaperProfile(e.target.value)} placeholder="e.g. 60# cream, 80# white, 90gsm…" style={inputStyle} onFocus={focusBorder} onBlur={blurBorder} />
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                        {[
                                            { label: "Amazon KDP Ready", color: "#f59e0b" },
                                            { label: "IngramSpark Ready", color: "#0ea5e9" },
                                            { label: "Offset Printing Ready", color: "#10b981" },
                                            { label: "CMYK Color Profile", color: "#8b5cf6" },
                                        ].map((opt, i) => (
                                            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                                                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: opt.color, flexShrink: 0 }} />
                                                <span style={{ fontSize: "11px", color: "#64748b" }}>{opt.label}</span>
                                                <span style={{ marginLeft: "auto", fontSize: "9px", color: "#334155", background: "rgba(255,255,255,0.04)", padding: "1px 5px", borderRadius: "4px" }}>via instructions</span>
                                            </div>
                                        ))}
                                    </div>
                                </CollapsibleSection>

                                {/* Front Matter Controls */}
                                <CollapsibleSection title="Front Matter" icon={<BookCopy size={14} color="#f59e0b" />} defaultOpen={true}>
                                    <p style={{ fontSize: "12px", color: "#64748b" }}>Select pages to include at the beginning of your book. AI will generate content where needed.</p>
                                    <MatterCheckbox items={FRONT_MATTER_ITEMS} selected={frontMatter} onChange={setFrontMatter} label="Include in Front Matter" />
                                </CollapsibleSection>

                                {/* Back Matter Controls */}
                                <CollapsibleSection title="Back Matter" icon={<ListOrdered size={14} color="#f59e0b" />}>
                                    <p style={{ fontSize: "12px", color: "#64748b" }}>Select pages to include at the end of your book.</p>
                                    <MatterCheckbox items={BACK_MATTER_ITEMS} selected={backMatter} onChange={setBackMatter} label="Include in Back Matter" />
                                </CollapsibleSection>

                                {/* Template Management */}
                                <CollapsibleSection title="Template Management" icon={<Save size={14} color="#f59e0b" />}>
                                    <p style={{ fontSize: "12px", color: "#64748b" }}>Save your current settings as a reusable template.</p>
                                    {!showSaveTemplate ? (
                                        <button onClick={() => setShowSaveTemplate(true)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "8px", padding: "10px 16px", color: "#fbbf24", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                                            <Save size={13} /> Save Current Settings as Template
                                        </button>
                                    ) : (
                                        <div style={{ display: "flex", gap: "8px" }}>
                                            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name…" style={{ ...inputStyle, flex: 1 }} onFocus={focusBorder} onBlur={blurBorder} />
                                            <button onClick={saveTemplate} style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: "8px", padding: "10px 16px", color: "#fbbf24", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Save</button>
                                            <button onClick={() => setShowSaveTemplate(false)} style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "10px 14px", color: "#64748b", fontSize: "12px", cursor: "pointer" }}>Cancel</button>
                                        </div>
                                    )}
                                    {savedTemplates.length > 0 && (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                            <label style={labelStyle}>SAVED TEMPLATES</label>
                                            {savedTemplates.map((tmpl) => (
                                                <div key={tmpl.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px" }}>
                                                    <div>
                                                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#e2e8f0" }}>{tmpl.name}</div>
                                                        <div style={{ fontSize: "10px", color: "#475569" }}>{tmpl.createdAt}</div>
                                                    </div>
                                                    <div style={{ display: "flex", gap: "6px" }}>
                                                        <button onClick={() => loadTemplate(tmpl)} style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "6px", padding: "6px 12px", color: "#a5b4fc", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>Load</button>
                                                        <button onClick={() => setSavedTemplates(savedTemplates.filter(t => t.id !== tmpl.id))} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", padding: "6px 10px", color: "#f87171", fontSize: "11px", cursor: "pointer" }}>✕</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CollapsibleSection>

                                {/* Custom Design Instructions */}
                                <CollapsibleSection title="Custom Design Instructions" icon={<PenTool size={14} color="#f59e0b" />}>
                                    <p style={{ fontSize: "12px", color: "#64748b" }}>Fine-tune with free-form instructions (used only if AI Command Box is empty).</p>
                                    <textarea value={designInstructions} onChange={(e) => setDesignInstructions(e.target.value)} placeholder="e.g. Classic cream pages with generous margins, drop caps, and subtle ornamental dividers…" rows={4} style={{ ...inputStyle, fontSize: "13px", resize: "vertical", lineHeight: "1.55", fontFamily: "inherit", padding: "12px 14px" }} onFocus={focusBorder} onBlur={blurBorder} />
                                </CollapsibleSection>
                            </div>
                        )}

                        {/* ── AI Smart Suggestion (Author mode) ── */}
                        {!isAdvanced && file && (
                            <section style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.07) 0%, rgba(99,102,241,0.04) 100%)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "14px", padding: "20px 24px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                                    <Wand2 size={14} color="#f59e0b" />
                                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#fbbf24" }}>AI will automatically</span>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                                    {[
                                        "Detect chapters and headings",
                                        "Create title page & copyright",
                                        "Generate table of contents",
                                        "Apply suitable Unicode fonts",
                                        "Configure print-safe margins",
                                        "Format images and tables",
                                        `Footer: ${footerCustomLeft || (footerBookName ? (bookTitle || "book name") : "none")} (left)`,
                                        `Footer: ${footerCustomRight || (footerPageNumber ? "page number" : "none")} (right)`,
                                    ].map((item, i) => (
                                        <div key={i} style={{ fontSize: "12px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                                            <span style={{ color: "#f59e0b" }}>✓</span> {item}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* ── Main Submit Button ── */}
                        <button onClick={handleSubmit} disabled={!file} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", background: file ? "linear-gradient(135deg, #f59e0b, #d97706)" : "rgba(245,158,11,0.2)", color: file ? "#0c0f1a" : "#64748b", border: "none", borderRadius: "14px", padding: "18px 32px", fontSize: "17px", fontWeight: "800", cursor: file ? "pointer" : "not-allowed", transition: "opacity 0.2s", width: "100%", boxShadow: file ? "0 8px 32px rgba(245,158,11,0.3)" : "none" }}
                            onMouseOver={(e) => { if (file) (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
                            onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}>
                            <Wand2 size={19} />
                            {file
                                ? (isAdvanced ? "Generate Professional Book Layout" : "Generate My Book Layout")
                                : "Upload Your Manuscript First"}
                        </button>

                        {/* Output format indicators */}
                        <div style={{ display: "flex", justifyContent: "center", gap: "16px", flexWrap: "wrap" }}>
                            {[
                                { icon: "📄", label: "Print-Ready PDF", ready: true },
                                { icon: "📝", label: "DOCX", ready: true },
                                { icon: "📱", label: "EPUB", ready: false },
                                ...(isAdvanced ? [{ icon: "📦", label: "KDP Package", ready: false }, { icon: "🌐", label: "IngramSpark Package", ready: false }] : []),
                            ].map((fmt, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: fmt.ready ? "#64748b" : "#334155" }}>
                                    <span style={{ fontSize: "13px" }}>{fmt.icon}</span>
                                    {fmt.label}
                                    {!fmt.ready && <span style={{ fontSize: "9px", color: "#475569", background: "rgba(255,255,255,0.05)", borderRadius: "4px", padding: "1px 5px" }}>soon</span>}
                                </div>
                            ))}
                        </div>

                        <p style={{ textAlign: "center", fontSize: "12px", color: "#334155" }}>
                            Powered by GPT-4o · Typeset with ReportLab · Footer: book name (left) + page number (right) on all pages
                        </p>
                    </div>
                )}
            </main>

            <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        select option { background: #1e293b; color: #e2e8f0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
      `}</style>
        </div>
    );
}