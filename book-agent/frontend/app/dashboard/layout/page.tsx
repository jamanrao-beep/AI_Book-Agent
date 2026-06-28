"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { parseFriendlyError } from "@/lib/api";
import {
    ArrowLeft, Upload, CheckCircle, Download, Sparkles, LayoutTemplate, X,
    FileText, Archive, BookMarked, ChevronDown, ChevronUp, Ruler, Paintbrush,
    MessageSquare, Type, AlignJustify, Wand2, BookOpen, Settings2, Info,
    Globe, Printer, BookCopy, ListOrdered, ChevronRight, Layers, FileOutput,
    PenTool, RefreshCw, Save,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Home Screen Mode ──────────────────────────────────────────────────────────
type AppMode = "home" | "author" | "advanced";

// ─── Unit System ──────────────────────────────────────────────────────────────
type DimUnit = "mm" | "inch" | "pt";
const UNIT_LABELS: Record<DimUnit, string> = { mm: "mm", inch: "in", pt: "pt" };

function toMm(val: number, unit: DimUnit): number {
    if (unit === "mm") return val;
    if (unit === "inch") return val * 25.4;
    if (unit === "pt") return val * 0.352778;
    return val;
}
function fromMm(val: number, unit: DimUnit): number {
    if (unit === "mm") return Math.round(val * 10) / 10;
    if (unit === "inch") return parseFloat((val / 25.4).toFixed(2));
    if (unit === "pt") return parseFloat((val * 2.83465).toFixed(1));
    return val;
}
function parseDimToMm(raw: string, unit: DimUnit): string {
    const n = parseFloat(raw);
    if (isNaN(n)) return "";
    return toMm(n, unit).toFixed(4);
}

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
    { key: "novel", icon: "📖", label: "Novel", subtitle: "Fiction / Story", description: "Clean readable layout, flowing text, drop caps", accent: "var(--violet)", bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.18)", defaultSize: { label: "5×8 (127 × 203 mm)", w: 127, h: 203 }, aiHint: "5×8 trim size is most popular for novels", designHint: "Classic readable serif typography with generous margins and drop caps" },
    { key: "poetry", icon: "✍️", label: "Poetry / Shayari", subtitle: "Verse / Lyric / Ghazal", description: "Preserved line breaks, elegant spacing", accent: "var(--crimson)", bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.18)", defaultSize: { label: "5×8 (127 × 203 mm)", w: 127, h: 203 }, aiHint: "5×8 is the perfect intimate size for poetry", designHint: "Romance — elegant serif, generous whitespace, preserved poetic line breaks" },
    { key: "academic", icon: "🎓", label: "Academic / Educational", subtitle: "Textbook / Study Material", description: "Structured headings, references, clean hierarchy", accent: "var(--sapphire)", bg: "var(--sapphire-dim)", border: "var(--border-strong)", defaultSize: { label: "A4 (210 × 297 mm)", w: 210, h: 297 }, aiHint: "A4 or 6×9 works best for academic books", designHint: "School Guide Style — clean headers, structured layout, academic typography" },
    { key: "biography", icon: "👤", label: "Biography / Memoir", subtitle: "Life story / Autobiography", description: "Elegant narrative layout, photo-friendly", accent: "var(--emerald)", bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.18)", defaultSize: { label: "US Trade 6×9 (152 × 229 mm)", w: 152, h: 229 }, aiHint: "6×9 is the standard for biographies and memoirs", designHint: "Editorial narrative — clean serif, generous margins, photo-plate friendly" },
    { key: "children", icon: "👶", label: "Children's Book", subtitle: "Stories / Picture Books", description: "Large fonts, image spaces, playful layout", accent: "var(--amber)", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.18)", defaultSize: { label: "Square (210 × 210 mm)", w: 210, h: 210 }, aiHint: "Square format is fun and popular for children's books", designHint: "Children's book — large playful fonts, pastel colors, wide margins for illustrations" },
    { key: "religious", icon: "🕌", label: "Religious / Spiritual", subtitle: "Scripture / Discourse / Devotional", description: "Decorative headings, ornate chapter dividers", accent: "#d4a017", bg: "rgba(212,160,23,0.06)", border: "rgba(212,160,23,0.18)", defaultSize: { label: "A5 (148 × 210 mm)", w: 148, h: 210 }, aiHint: "A5 is the traditional size for religious texts", designHint: "Bhagavad Gita Style — warm cream pages, decorative ornaments, classic serif" },
    { key: "business", icon: "💼", label: "Business / Self-help", subtitle: "Motivational / Professional", description: "Modern clean design, bold headings", accent: "#6366f1", bg: "rgba(99,102,241,0.06)", border: "rgba(99,102,241,0.18)", defaultSize: { label: "US Trade 6×9 (152 × 229 mm)", w: 152, h: 229 }, aiHint: "6×9 is the professional standard for business books", designHint: "Modern minimalist — clean sans-serif, bold chapter headings, structured layout" },
    { key: "custom", icon: "✏️", label: "Custom / Other", subtitle: "Define your own style", description: "Describe exactly what you want", accent: "var(--mist)", bg: "var(--surface-hover)", border: "var(--border-mid)", defaultSize: { label: "A4 (210 × 297 mm)", w: 210, h: 297 }, aiHint: "You'll provide a custom description — AI will follow your exact instructions", designHint: "" },
];

// ─── Visual Templates ─────────────────────────────────────────────────────────
const VISUAL_TEMPLATES = [
    { key: "classic_novel", name: "Classic Novel", emoji: "📚", desc: "Premchand Novel Style", colors: ["#f5f0e8", "#2d2016", "#8b4513", "#c8a96e"], mood: "Timeless · Warm · Literary", designText: "Classic cream pages with serif fonts, drop caps and ornamental chapter dividers" },
    { key: "premium_hardcover", name: "Premium Hardcover", emoji: "🏆", desc: "Luxury Edition Style", colors: ["#0f0f0f", "#e8d5b0", "#c8a200", "#666666"], mood: "Luxury · Dark · Gold", designText: "Luxury dark theme with gold accents, wide margins and elegant typography" },
    { key: "modern_minimal", name: "Modern Minimal", emoji: "⚡", desc: "Contemporary Clean", colors: ["#ffffff", "#1a1a2e", "#4a90d9", "#e8eaed"], mood: "Clean · Modern · Crisp", designText: "Modern minimalist with clean sans-serif typography and subtle accents" },
    { key: "sanskrit_style", name: "Sanskrit / Vedic", emoji: "🕉️", desc: "Bhagavad Gita Style", colors: ["#fef9f0", "#5c3d11", "#d4a017", "#8b6914"], mood: "Sacred · Traditional · Gold", designText: "Traditional sacred style — warm saffron accents, ornate headings, classic serif" },
    { key: "school_guide", name: "School Guide", emoji: "📝", desc: "Academic Textbook", colors: ["#f8fafc", "#0f172a", "#2563eb", "#555555"], mood: "Clear · Structured · Academic", designText: "School Guide Style — structured headers, clean sans-serif, academic layout" },
    { key: "thriller_dark", name: "Thriller Dark", emoji: "🌑", desc: "High Contrast Mystery", colors: ["#111827", "#f9fafb", "#ef4444", "#374151"], mood: "Dark · Intense · Dramatic", designText: "Thriller — high contrast dark pages, sharp modern layout, dramatic headings" },
    { key: "retro_vintage", name: "Retro Vintage", emoji: "🗞️", desc: "Old-style Antique", colors: ["#f5ead0", "#3d2b1f", "#8b4513", "#c4a76e"], mood: "Nostalgic · Warm · Antique", designText: "Retro vintage — warm sepia tones, old-style fonts, diagonal motifs" },
    { key: "poetry_bloom", name: "Poetry Bloom", emoji: "🌸", desc: "Romance / Shayari Style", colors: ["#fff0f5", "#4a1942", "#d63384", "#f8c8d8"], mood: "Romantic · Delicate · Poetic", designText: "Romance — blush tones, italic serif, floral ornaments, poetic spacing" },
    { key: "custom", name: "Custom / Other", emoji: "✏️", desc: "Describe your own style", colors: ["#737373", "#555555", "#f59e0b", "#475569"], mood: "Your Vision · AI Executed", designText: "" },
];

// ─── Size Visual Options ──────────────────────────────────────────────────────
const SIZE_VISUAL = [
    { key: "5x8", label: "5 × 8", desc: "Novel size", w: 127, h: 203, popular: "Novels" },
    { key: "55x85", label: "5.5 × 8.5", desc: "Standard", w: 140, h: 216, popular: "Self-help" },
    { key: "6x9", label: "6 × 9", desc: "Trade size", w: 152, h: 229, popular: "Business" },
    { key: "A4", label: "A4", desc: "Print/Academic", w: 210, h: 297, popular: "Academic" },
    { key: "custom", label: "Custom Size", desc: "Any size", w: 0, h: 0, popular: "" },
];

// ─── Font Prefs ───────────────────────────────────────────────────────────────
const FONT_PREFS = [
    { key: "modern", label: "Modern", font: "Helvetica", desc: "Clean sans-serif" },
    { key: "traditional", label: "Traditional", font: "Times-Roman", desc: "Classic serif" },
    { key: "premium", label: "Premium", font: "Times-Italic", desc: "Elegant italic" },
    { key: "readable", label: "Easy to Read", font: "Helvetica", desc: "High readability" },
    { key: "custom", label: "Custom Font", font: "", desc: "Describe your own" },
];

// ─── Spacing Options ──────────────────────────────────────────────────────────
const SPACING_OPTS = [
    { key: "compact", label: "Compact", value: "1.3", desc: "More text per page" },
    { key: "balanced", label: "Balanced", value: "1.5", desc: "Recommended", popular: true },
    { key: "spacious", label: "Spacious", value: "1.8", desc: "Airy, easy reading" },
    { key: "custom", label: "Custom Spacing", value: "", desc: "Describe your own" },
];

// ─── Advanced font options ────────────────────────────────────────────────────
const FONT_OPTIONS = [
    { label: "AI Choice (auto)", value: "" },
    { label: "Times Roman (classic serif)", value: "Times-Roman" },
    { label: "Times Italic (italic serif)", value: "Times-Italic" },
    { label: "Helvetica (clean sans-serif)", value: "Helvetica" },
    { label: "Helvetica Oblique (oblique sans)", value: "Helvetica-Oblique" },
    { label: "Courier (monospace)", value: "Courier" },
    { label: "Custom…", value: "__custom__" },
];

const LINE_SPACING_OPTIONS = [
    { label: "AI Choice (auto)", value: "" },
    { label: "Tight (1.2×)", value: "1.2" },
    { label: "Normal (1.4×)", value: "1.4" },
    { label: "Comfortable (1.6×)", value: "1.6" },
    { label: "Relaxed (1.8×)", value: "1.8" },
    { label: "Double (2.0×)", value: "2.0" },
    { label: "Custom…", value: "__custom__" },
];

const CHAPTER_START_OPTIONS = [
    { label: "AI decides", value: "" },
    { label: "Right-hand page (recto)", value: "right_page" },
    { label: "Left-hand page (verso)", value: "left_page" },
    { label: "Any page (no blank pages)", value: "any_page" },
    { label: "Custom…", value: "__custom__" },
];

const HEADING_DESIGN_OPTIONS = [
    { label: "AI decides", value: "" },
    { label: "Centered, large, decorative", value: "centered_decorative" },
    { label: "Left-aligned, bold, clean", value: "left_bold_clean" },
    { label: "ALL CAPS with rule line", value: "allcaps_rule" },
    { label: "Italic elegant", value: "italic_elegant" },
    { label: "Numbered chapters", value: "numbered" },
    { label: "Small caps with ornament", value: "smallcaps_ornament" },
    { label: "Custom…", value: "__custom__" },
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
    footer_middle_text?: string;
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

// ─── Reusable Components ───────────────────────────────────────────────────────
function PageSizePreview({ w, h, unit, margins, title }: {
    w: number;
    h: number;
    unit: DimUnit;
    margins?: { top: number; bottom: number; left: number; right: number };
    title?: string;
}) {
    const pageW = w > 0 ? w : 140;
    const pageH = h > 0 ? h : 216;

    const maxDim = 180;
    const scale = pageH > pageW ? maxDim / pageH : maxDim / pageW;
    const pxW = pageW * scale;
    const pxH = pageH * scale;

    return (
        <div style={{
            background: "var(--onyx)",
            border: "1.5px solid var(--border-mid)",
            borderRadius: "16px",
            padding: "36px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            minHeight: "260px",
            margin: "12px 0 24px",
        }}>
            {/* Top Width Ruler */}
            <div style={{
                position: "absolute", top: "12px", left: "50%", transform: "translateX(-50%)",
                width: `${pxW}px`, display: "flex", flexDirection: "column", alignItems: "center"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "9px", fontWeight: "700", color: "var(--text-secondary)" }}>
                    <span>|</span>
                    <span style={{ background: "var(--onyx)", padding: "0 6px" }}>{pageW} {UNIT_LABELS[unit]}</span>
                    <span>|</span>
                </div>
                <div style={{ width: "100%", height: "1px", background: "var(--border-strong)", marginTop: "2px" }} />
            </div>

            {/* Left Height Ruler */}
            <div style={{
                position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
                height: `${pxH}px`, display: "flex", alignItems: "center"
            }}>
                <div style={{ height: "100%", width: "1px", background: "var(--border-strong)", marginRight: "6px" }} />
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", fontSize: "9px", fontWeight: "700", color: "var(--text-secondary)", writingMode: "vertical-lr" }}>
                    <span>|</span>
                    <span style={{ background: "var(--onyx)", padding: "4px 0", transform: "rotate(-90deg)" }}>{pageH} {UNIT_LABELS[unit]}</span>
                    <span>|</span>
                </div>
            </div>

            {/* Page mockup sheet */}
            <div style={{
                width: `${pxW}px`,
                height: `${pxH}px`,
                background: "var(--void)",
                border: "1.5px solid var(--border-strong)",
                borderRadius: "4px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
                position: "relative",
                transform: "translate(10px, 10px)",
                overflow: "hidden",
            }}>
                {/* Book spine visual side shadow */}
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "6px", background: "linear-gradient(90deg, rgba(0,0,0,0.08) 0%, transparent 100%)" }} />
                
                {/* Mimic margins */}
                {margins && (() => {
                    const t = margins.top * scale;
                    const b = margins.bottom * scale;
                    const l = margins.left * scale;
                    const r = margins.right * scale;
                    return (
                        <div style={{
                            position: "absolute",
                            top: `${t}px`, bottom: `${b}px`,
                            left: `${l}px`, right: `${r}px`,
                            border: "1px dashed rgba(37,99,235,0.15)",
                            display: "flex", flexDirection: "column", justifyContent: "space-between",
                            padding: "6px",
                        }}>
                            {/* Lines of text */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                <div style={{ height: "2.5px", width: "80%", background: "var(--border-mid)", borderRadius: "1px" }} />
                                <div style={{ height: "2.5px", width: "95%", background: "var(--border-mid)", borderRadius: "1px" }} />
                                <div style={{ height: "2.5px", width: "90%", background: "var(--border-mid)", borderRadius: "1px" }} />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                <div style={{ height: "2.5px", width: "95%", background: "var(--border-mid)", borderRadius: "1px" }} />
                                <div style={{ height: "2.5px", width: "60%", background: "var(--border-mid)", borderRadius: "1px" }} />
                            </div>
                        </div>
                    );
                })()}

                {/* Mimic footer */}
                <div style={{ position: "absolute", bottom: "8px", left: "10px", right: "10px", display: "flex", justifyContent: "space-between", fontSize: "6px", color: "var(--text-tertiary)", transform: "scale(0.85)" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{title || "Book Title"}</span>
                    <span>42</span>
                </div>
            </div>
        </div>
    );
}

function CollapsibleSection({ title, icon, children, defaultOpen = false }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ border: "1.5px solid var(--border-mid)", borderRadius: "14px", overflow: "hidden", background: "var(--onyx)", marginBottom: "8px" }}>
            <button onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "transparent", border: "none", color: "var(--text-primary)", cursor: "pointer", fontSize: "13px", fontWeight: "700" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>{icon}<span>{title}</span></div>
                {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {open && <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px", borderTop: "1.5px solid var(--border-mid)", background: "var(--void)" }}>{children}</div>}
        </div>
    );
}

function MatterCheckbox({ items, selected, onChange }: { items: { key: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {items.map((item) => {
                const checked = selected.includes(item.key);
                return (
                    <label key={item.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: checked ? "var(--sapphire-dim)" : "var(--onyx)", border: `1.5px solid ${checked ? "var(--sapphire)" : "var(--border-mid)"}`, borderRadius: "8px", cursor: "pointer", fontSize: "12px", color: "var(--text-primary)", transition: "all 0.15s" }}>
                        <input type="checkbox" checked={checked} onChange={() => { if (checked) onChange(selected.filter((k) => k !== item.key)); else onChange([...selected, item.key]); }} style={{ accentColor: "var(--sapphire)" }} />
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
            <span className="field-label">{label}</span>
            <div style={{ display: "flex", gap: "6px" }}>
                {([null, true, false] as const).map((v) => (
                    <button key={String(v)} onClick={() => onChange(v)} style={{ flex: 1, padding: "7px 0", borderRadius: "7px", border: `1px solid ${value === v ? "var(--sapphire)" : "var(--border-mid)"}`, background: value === v ? "var(--sapphire)" : "var(--onyx)", color: value === v ? "var(--void)" : "var(--text-primary)", fontSize: "11px", fontWeight: "700", cursor: "pointer", transition: "all 0.15s" }}>
                        {v === null ? "AI" : v ? "On" : "Off"}
                    </button>
                ))}
            </div>
        </div>
    );
}

function UnitSelector({ value, onChange }: { value: DimUnit; onChange: (u: DimUnit) => void }) {
    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "2px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "8px", padding: "3px" }}>
            {(["mm", "inch", "pt"] as DimUnit[]).map((u) => (
                <button key={u} onClick={() => onChange(u)} style={{ padding: "4px 10px", borderRadius: "6px", border: "none", background: value === u ? "var(--text-primary)" : "transparent", color: value === u ? "var(--void)" : "var(--text-primary)", fontSize: "11px", fontWeight: "700", cursor: "pointer", transition: "all 0.15s" }}>
                    {UNIT_LABELS[u]}
                </button>
            ))}
        </div>
    );
}

// ─── Main Page Component ──────────────────────────────────────────────────────
export default function LayoutDesignerPage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    const [appMode, setAppMode] = useState<AppMode>("home");
    const [file, setFile] = useState<File | null>(null);
    const [dragging, setDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [stage, setStage] = useState("");
    const [pct, setPct] = useState(0);
    const [statusMsg, setStatusMsg] = useState("");
    const [result, setResult] = useState<LayoutResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);

    // Form fields
    const [bookTitle, setBookTitle] = useState("");
    const [language, setLanguage] = useState("english");
    const [bookTypeKey, setBookTypeKey] = useState<string | null>(null);
    const [templateKey, setTemplateKey] = useState<string | null>(null);
    const [printPlatform, setPrintPlatform] = useState("kdp");
    const [dimUnit, setDimUnit] = useState<DimUnit>("mm");

    // Standard preset states
    const [selectedSizeKey, setSelectedSizeKey] = useState("A4");
    const [fontPrefKey, setFontPrefKey] = useState("traditional");
    const [spacingKey, setSpacingKey] = useState("balanced");

    // Advanced presets/rules states
    const [presetIndex, setPresetIndex] = useState(0);
    const [customW, setCustomW] = useState(210);
    const [customH, setCustomH] = useState(297);
    const [customSizeW, setCustomSizeW] = useState(210);
    const [customSizeH, setCustomSizeH] = useState(297);

    // Advanced typography configs
    const [bodyFont, setBodyFont] = useState("");
    const [chapterFont, setChapterFont] = useState("");
    const [bodyFontSize, setBodyFontSize] = useState("");
    const [chapterFontSize, setChapterFontSize] = useState("");
    const [lineSpacing, setLineSpacing] = useState("");

    const [customLineSpacing, setCustomLineSpacing] = useState("");
    const [customBodyFont, setCustomBodyFont] = useState("");
    const [customChapterFont, setCustomChapterFont] = useState("");

    // Advanced layout sizes
    const [marginTop, setMarginTop] = useState("");
    const [marginBottom, setMarginBottom] = useState("");
    const [marginLeft, setMarginLeft] = useState("");
    const [marginRight, setMarginRight] = useState("");
    const [gutterMm, setGutterMm] = useState("");
    const [bleedMm, setBleedMm] = useState("");
    const [paragraphSpacingMm, setParagraphSpacingMm] = useState("");
    const [indentMm, setIndentMm] = useState("");

    // Layout toggles
    const [dropCap, setDropCap] = useState<boolean | null>(null);
    const [pageNumbers, setPageNumbers] = useState<boolean | null>(null);
    const [mirrorMargins, setMirrorMargins] = useState<boolean | null>(null);
    const [sectionBreaks, setSectionBreaks] = useState<boolean | null>(null);

    // Header/Footer rules
    const [headerCustomText, setHeaderCustomText] = useState("");
    const [pageNumberStart, setPageNumberStart] = useState("");
    const [pageNumberStyle, setPageNumberStyle] = useState("");
    const [customPageNumberStyle, setCustomPageNumberStyle] = useState("");
    const [chapterStart, setChapterStart] = useState("");
    const [customChapterStart, setCustomChapterStart] = useState("");
    const [headingDesign, setHeadingDesign] = useState("");
    const [customHeadingDesign, setCustomHeadingDesign] = useState("");

    // Front/Back Matter configuration
    const [frontMatter, setFrontMatter] = useState<string[]>(["title_page", "copyright_page", "toc"]);
    const [backMatter, setBackMatter] = useState<string[]>(["about_author"]);

    // Production settings
    const [colorMode, setColorMode] = useState<"bw" | "color" | "">("");
    const [paperProfile, setPaperProfile] = useState("");

    // Saved templates lists
    const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
    const [templateName, setTemplateName] = useState("");
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);

    // Free form custom design box states
    const [aiCommand, setAiCommand] = useState("");
    const [designInstructions, setDesignInstructions] = useState("");

    const [customBookTypeDesc, setCustomBookTypeDesc] = useState("");
    const [customTemplateDesc, setCustomTemplateDesc] = useState("");
    const [customFontDesc, setCustomFontDesc] = useState("");
    const [customSpacingDesc, setCustomSpacingDesc] = useState("");

    const isAdvanced = appMode === "advanced";

    // ── Calculations ──────────────────────────────────────────────────────────
    const preset = PAGE_PRESETS[presetIndex] || PAGE_PRESETS[0];
    const isCustomPreset = preset.label === "Custom";

    const selectedSize = SIZE_VISUAL.find((s) => s.key === selectedSizeKey) || SIZE_VISUAL[0];
    const isCustomSizeKey = selectedSize.key === "custom";

    const pageW = isAdvanced
        ? (isCustomPreset ? customW : preset.w)
        : (isCustomSizeKey ? customSizeW : selectedSize.w);
    const pageH = isAdvanced
        ? (isCustomPreset ? customH : preset.h)
        : (isCustomSizeKey ? customSizeH : selectedSize.h);

    const fontPref = FONT_PREFS.find((f) => f.key === fontPrefKey) || FONT_PREFS[0];
    const spacing = SPACING_OPTS.find((s) => s.key === spacingKey) || SPACING_OPTS[0];

    const activeOverrides = [
        bodyFont, chapterFont, bodyFontSize, chapterFontSize, lineSpacing,
        marginTop, marginBottom, marginLeft, marginRight, gutterMm, bleedMm,
        chapterStart, headingDesign, colorMode, paperProfile, paragraphSpacingMm,
        indentMm, pageNumberStart, pageNumberStyle, mirrorMargins !== null,
        sectionBreaks !== null, headerCustomText,
    ].filter((x) => x !== "" && x !== null && x !== undefined).length;

    // ── Footer custom fields ──
    const [footerBookName, setFooterBookName] = useState(true);
    const [footerPageNumber, setFooterPageNumber] = useState(true);
    const [footerCustomLeft, setFooterCustomLeft] = useState("");
    const [footerCustomMiddle, setFooterCustomMiddle] = useState("");
    const [footerCustomRight, setFooterCustomRight] = useState("");

    // Clean polls
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // ── File Validators ───────────────────────────────────────────────────────
    function validateAndSetFile(f: File) {
        const allowed = ["pdf", "docx", "zip", "txt", "md", "rtf"];
        const ext = f.name.split(".").pop()?.toLowerCase();
        if (!allowed.includes(ext || "")) {
            setError("Please upload a .pdf, .docx, .zip, .txt, .md, or .rtf file.");
            return;
        }
        if (f.size > 150 * 1024 * 1024) {
            setError("File must be under 150 MB.");
            return;
        }
        setError(null);
        setFile(f);
        setResult(null);

        // Guessed book title
        if (ext !== "zip" && !bookTitle) {
            const guess = f.name
                .replace(/\.[^.]+$/, "")
                .replace(/[_-]/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
            setBookTitle(guess);
        }
    }

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) validateAndSetFile(f);
    };

    // ── Polling logic ─────────────────────────────────────────────────────────
    const startPolling = (jobId: string) => {
        let errs = 0;
        pollRef.current = setInterval(async () => {
            try {
                const r = await fetch(`${API_BASE}/design-layout/${jobId}/status`);
                if (!r.ok) return;
                errs = 0;
                const d = await r.json();
                setStage(d.stage);
                setPct(d.pct);
                setStatusMsg(d.message);

                if (d.stage === "done" && d.result) {
                    clearInterval(pollRef.current!);
                    setResult(d.result);
                    setLoading(false);
                }
                if (d.stage === "error") {
                    clearInterval(pollRef.current!);
                    setError(d.message || "Layout design failed.");
                    setLoading(false);
                }
            } catch (e: unknown) {
                errs++;
                if (errs >= 6) {
                    clearInterval(pollRef.current!);
                    setError("Lost connection to layout backend: " + parseFriendlyError(e));
                    setLoading(false);
                }
            }
        }, 2500);
    };

    // ── Submit logic ──────────────────────────────────────────────────────────
    async function handleSubmit() {
        if (!file) return;
        setLoading(true);
        setError(null);
        setResult(null);
        setStage("queued");
        setPct(0);
        setStatusMsg("Submitting manuscript files…");

        try {
            const form = new FormData();
            
            // Build custom design description prompt block
            const buildDesignInstructions = () => {
                let p = designInstructions.trim();
                if (aiCommand.trim()) {
                    p = `[AI COMMAND]: ${aiCommand.trim()}\n\n${p}`;
                }
                if (!isAdvanced) {
                    // Inject standard modes rules
                    const typeObj = BOOK_TYPES.find(b => b.key === bookTypeKey);
                    const tmplObj = VISUAL_TEMPLATES.find(t => t.key === templateKey);
                    if (typeObj?.designHint) p += `\n- Format matching: ${typeObj.designHint}`;
                    if (tmplObj?.designText) p += `\n- Visual style template instructions: ${tmplObj.designText}`;
                    if (fontPrefKey === "custom" && customFontDesc) p += `\n- Font requirement: ${customFontDesc}`;
                    if (spacingKey === "custom" && customSpacingDesc) p += `\n- Spacing requirement: ${customSpacingDesc}`;
                } else {
                    if (bookTypeKey === "custom" && customBookTypeDesc) p += `\n- Genre layout spec: ${customBookTypeDesc}`;
                    if (templateKey === "custom" && customTemplateDesc) p += `\n- Theme layout spec: ${customTemplateDesc}`;
                }
                return p.trim();
            };

            const dimToMm = (val: string) => parseDimToMm(val, dimUnit);

            const pageSizeWmm = isAdvanced
                ? (isCustomPreset ? toMm(customW, dimUnit) : preset.w)
                : (isCustomSizeKey ? toMm(customSizeW, dimUnit) : selectedSize.w);
            const pageSizeHmm = isAdvanced
                ? (isCustomPreset ? toMm(customH, dimUnit) : preset.h)
                : (isCustomSizeKey ? toMm(customSizeH, dimUnit) : selectedSize.h);

            form.append("file", file);
            form.append("page_width_mm", String(Math.max(50, Math.min(600, pageSizeWmm || 210))));
            form.append("page_height_mm", String(Math.max(50, Math.min(600, pageSizeHmm || 297))));
            form.append("book_title", bookTitle.trim());
            form.append("design_instructions", buildDesignInstructions());

            if (bookTypeKey && bookTypeKey !== "custom") form.append("book_type", bookTypeKey);
            if (templateKey && templateKey !== "custom") form.append("visual_template", templateKey);

            // Resolve custom fonts
            const resolvedBodyFont = bodyFont === "__custom__" ? customBodyFont : bodyFont;
            const resolvedChapterFont = chapterFont === "__custom__" ? customChapterFont : chapterFont;
            const resolvedLineSpacing = lineSpacing === "__custom__" ? customLineSpacing
                : lineSpacing || (!isAdvanced && spacingKey !== "custom" ? spacing.value : "");

            const effectiveBodyFont = resolvedBodyFont || (!isAdvanced && fontPrefKey !== "custom" ? fontPref.font : "");
            if (effectiveBodyFont) form.append("body_font", effectiveBodyFont);
            if (resolvedChapterFont) form.append("chapter_font", resolvedChapterFont);
            if (bodyFontSize) form.append("body_font_size", bodyFontSize);
            if (chapterFontSize) form.append("chapter_font_size", chapterFontSize);
            if (resolvedLineSpacing) form.append("line_spacing", resolvedLineSpacing);

            if (marginTop) form.append("margin_top_mm", dimToMm(marginTop) || marginTop);
            if (marginBottom) form.append("margin_bottom_mm", dimToMm(marginBottom) || marginBottom);
            if (marginLeft) form.append("margin_left_mm", dimToMm(marginLeft) || marginLeft);
            if (marginRight) form.append("margin_right_mm", dimToMm(marginRight) || marginRight);
            if (dropCap !== null) form.append("show_drop_cap", String(dropCap));
            
            const effectivePageNumbers = pageNumbers !== null ? pageNumbers : footerPageNumber;
            form.append("show_page_numbers", String(effectivePageNumbers));

            // Footer 3-slot text configurations
            const effectiveFooterLeft = footerCustomLeft.trim() || (footerBookName ? bookTitle.trim() || "" : "");
            const effectiveFooterMiddle = footerCustomMiddle.trim();
            if (effectiveFooterLeft) form.append("footer_left_text", effectiveFooterLeft);
            if (effectiveFooterMiddle) form.append("footer_middle_text", effectiveFooterMiddle);
            form.append("footer_right_pagenum", String(effectivePageNumbers));

            if (mirrorMargins !== null) form.append("mirror_margins", String(mirrorMargins));
            if (gutterMm) form.append("gutter_mm", dimToMm(gutterMm) || gutterMm);
            if (paragraphSpacingMm) form.append("paragraph_spacing_mm", dimToMm(paragraphSpacingMm) || paragraphSpacingMm);
            if (indentMm) form.append("indent_mm", dimToMm(indentMm) || indentMm);
            if (colorMode) form.append("color_mode", colorMode);
            if (bleedMm) form.append("bleed_mm", dimToMm(bleedMm) || bleedMm);

            const resolvedChapterStart = chapterStart === "__custom__" ? customChapterStart : chapterStart;
            const resolvedHeadingDesign = headingDesign === "__custom__" ? customHeadingDesign : headingDesign;
            const resolvedPageNumStyle = pageNumberStyle === "__custom__" ? customPageNumberStyle : pageNumberStyle;

            if (resolvedChapterStart) form.append("chapter_start", resolvedChapterStart);
            if (pageNumberStart) form.append("page_number_start", pageNumberStart);
            if (resolvedPageNumStyle) form.append("page_number_style", resolvedPageNumStyle);
            if (headerCustomText.trim()) form.append("header_custom_text", headerCustomText.trim());
            if (resolvedHeadingDesign) form.append("heading_design", resolvedHeadingDesign);
            if (sectionBreaks !== null) form.append("section_breaks", String(sectionBreaks));

            form.append("front_matter", JSON.stringify(frontMatter));
            form.append("back_matter", JSON.stringify(backMatter));

            const res = await fetch(`${API_BASE}/design-layout`, { method: "POST", body: form });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Server error" }));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            const { job_id } = await res.json();
            setJobId(job_id);
            startPolling(job_id);
        } catch (e: unknown) {
            setError(parseFriendlyError(e));
            setLoading(false);
        }
    }

    const handleSubmitRef = useRef<() => void>(() => {});
    useEffect(() => { handleSubmitRef.current = () => void handleSubmit(); });
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && file && !loading && !result) {
                handleSubmitRef.current();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, loading, result]);

    function saveTemplate() {
        if (!templateName.trim()) return;
        const tmpl: SavedTemplate = {
            id: Date.now().toString(),
            name: templateName.trim(),
            createdAt: new Date().toLocaleDateString(),
            settings: { bookTypeKey, templateKey, printPlatform, bodyFont, chapterFont, bodyFontSize, chapterFontSize, lineSpacing, marginTop, marginBottom, marginLeft, marginRight, mirrorMargins, gutterMm, bleedMm, chapterStart, headingDesign, colorMode, frontMatter, backMatter, footerBookName, footerPageNumber, footerCustomLeft, footerCustomMiddle, footerCustomRight, dimUnit },
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
        if (s.footerCustomMiddle) setFooterCustomMiddle(s.footerCustomMiddle as string);
        if (s.footerCustomRight) setFooterCustomRight(s.footerCustomRight as string);
        if (s.dimUnit) setDimUnit(s.dimUnit as DimUnit);
    }

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
        setParagraphSpacingMm(""); setIndentMm(""); setHeadingDesign("");
        setColorMode(""); setPaperProfile("");
        setFrontMatter(["title_page", "copyright_page", "toc"]); setBackMatter(["about_author"]);
        setFooterBookName(true); setFooterPageNumber(true);
        setFooterCustomLeft(""); setFooterCustomMiddle(""); setFooterCustomRight("");
        setCustomLineSpacing(""); setCustomBodyFont(""); setCustomChapterFont("");
        setCustomChapterStart(""); setCustomHeadingDesign(""); setCustomPageNumberStyle("");
        setDimUnit("mm"); setPresetIndex(0); setCustomW(210); setCustomH(297);
        setFontPrefKey("traditional"); setSpacingKey("balanced");
        setLanguage("english"); setPrintPlatform("kdp");
    }

    const STAGE_LABELS: Record<string, string> = { queued: "Queued", extracting: "Extracting text…", parsing: "Detecting chapters…", designing: "AI designing layout…", rendering: "Typesetting PDF…", rendering_docx: "Generating DOCX…", done: "Done!", error: "Error" };

    if (appMode === "home") return <HomeScreen onSelect={(m) => setAppMode(m)} />;

    return (
        <div style={{ minHeight: "100vh", background: "var(--void)", fontFamily: "'DM Sans', sans-serif", color: "var(--text-primary)", position: "relative" }}>
            <div className="grid-overlay" />

            {/* Nav */}
            <nav className="glass" style={{ borderBottom: "1.5px solid var(--border-mid)", padding: "0 40px", height: "60px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", background: "var(--text-primary)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <LayoutTemplate size={16} color="var(--void)" />
                    </div>
                    <span style={{ fontWeight: "800", fontSize: "15px", letterSpacing: "-0.01em", color: "var(--text-primary)" }}>Publixo AI</span>
                    <div style={{ marginLeft: "8px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "6px", padding: "2px 10px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.06em", color: "var(--sapphire)" }}>
                        {isAdvanced ? "⚙️ ADVANCED" : "👤 AUTHOR"}
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button onClick={() => { reset(); setAppMode("home"); }} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 14px", borderRadius: "8px", fontSize: "12px" }}>
                        <Layers size={13} /> Switch Mode
                    </button>
                    <button onClick={() => router.push("/dashboard")} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 14px", borderRadius: "8px", fontSize: "12px" }}>
                        <ArrowLeft size={14} /> Dashboard
                    </button>
                </div>
            </nav>

            <main style={{ maxWidth: "940px", margin: "0 auto", padding: "64px 32px 96px", position: "relative", zIndex: 2 }}>
                
                {/* Page header */}
                <div style={{ marginBottom: "40px" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "20px", padding: "4px 14px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.1em", color: "var(--sapphire)", marginBottom: "16px", boxShadow: "0 4px 10px rgba(0,0,0,0.02)" }}>
                        <Wand2 size={11} /> {isAdvanced ? "ADVANCED PUBLISHING MODE" : "AI AUTHOR ASSISTANT"}
                    </div>
                    <h1 className="serif" style={{ fontSize: "40px", fontWeight: "400", letterSpacing: "-0.02em", marginBottom: "10px", color: "var(--text-primary)" }}>
                        {isAdvanced ? "Professional Book Layout" : "Design Your Book Layout"}
                    </h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.6" }}>
                        {isAdvanced ? "Full publishing-grade control with AI-powered customization and design commands." : "Upload your book draft and select styling preferences — AI handles the complex margins."}
                    </p>
                </div>

                {error && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: "12px", padding: "16px 20px", marginBottom: "28px" }}>
                        <X size={16} color="var(--crimson)" style={{ marginTop: "1px", flexShrink: 0 }} />
                        <div style={{ fontSize: "13px", color: "var(--crimson)", lineHeight: "1.5" }}>{error}</div>
                        <button onClick={() => setError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", flexShrink: 0 }}><X size={14} /></button>
                    </div>
                )}

                {/* ── RESULT SCREEN ── */}
                {result ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                        <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "20px", padding: "32px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
                                <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "rgba(16,185,129,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <CheckCircle size={22} color="var(--emerald)" />
                                </div>
                                <div>
                                    <h3 className="serif" style={{ fontSize: "20px", color: "var(--text-primary)" }}>Layout Ready!</h3>
                                    <p style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "2px" }}>{result.chapter_count} chapter{result.chapter_count !== 1 ? "s" : ""} typeset · Preset: {result.style_name}</p>
                                </div>
                            </div>

                            {/* Preset concepts */}
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
                                        <div key={i} style={{ background: "var(--void)", borderRadius: "8px", padding: "10px 12px", border: "1px solid var(--border-mid)" }}>
                                            <div style={{ fontSize: "9px", fontWeight: "700", color: "var(--sapphire)", letterSpacing: "0.06em", marginBottom: "4px", textTransform: "uppercase" }}>{item.label}</div>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                {item.isColor && <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: item.value, border: "1px solid rgba(0,0,0,0.12)", flexShrink: 0 }} />}
                                                <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-primary)" }}>{item.value}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Footer preview display */}
                            <div style={{ background: "var(--void)", border: "1.5px solid var(--border-mid)", borderRadius: "12px", padding: "14px 18px", marginBottom: "24px" }}>
                                <div style={{ fontSize: "9px", fontWeight: "700", color: "var(--sapphire)", letterSpacing: "0.08em", marginBottom: "8px", textTransform: "uppercase" }}>📄 FOOTER PREVIEW</div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>⬅ {footerCustomLeft || (footerBookName ? result.title || "Book Title" : "—")}</span>
                                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{footerCustomMiddle || "·"}</span>
                                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{footerCustomRight || (footerPageNumber ? "Page 1" : "—")} ➡</span>
                                </div>
                            </div>

                            {/* Download targets */}
                            <div style={{ display: "flex", gap: "10px" }}>
                                <a href={`${API_BASE}${result.pdf_url}`} download className="btn-dark" style={{ textDecoration: "none" }}>
                                    <Download size={15} /> Download PDF
                                </a>
                                <a href={`${API_BASE}${result.docx_url}`} download className="btn-outline" style={{ textDecoration: "none" }}>
                                    <FileText size={15} /> Download DOCX
                                </a>
                            </div>
                        </div>

                        <button onClick={reset} className="btn-outline" style={{ width: "fit-content" }}>
                            <RefreshCw size={13} /> Design Another Book
                        </button>
                    </div>
                ) : loading ? (
                    /* ── PROGRESS SCREEN ── */
                    <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "20px", padding: "48px 40px", textAlign: "center" }}>
                        <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "var(--void)", border: "1.5px solid var(--border-mid)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                            <Wand2 size={24} color="var(--sapphire)" style={{ animation: "spin 2s linear infinite" }} />
                        </div>
                        <h3 className="serif" style={{ fontSize: "22px", color: "var(--text-primary)", marginBottom: "8px" }}>
                            {STAGE_LABELS[stage] || "Processing…"}
                        </h3>
                        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "32px" }}>{statusMsg}</p>
                        <div className="progress-bar" style={{ marginBottom: "12px" }}>
                            <div className="progress-fill" style={{ background: "var(--text-primary)", width: `${pct}%` }} />
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>{pct}%</div>
                    </div>
                ) : (
                    /* ── FORM ── */
                    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
                        
                        {/* Drop zone */}
                        <div
                            onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onClick={() => !file && fileInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${dragging ? "var(--sapphire)" : file ? "rgba(37,99,235,0.4)" : "var(--border-strong)"}`,
                                borderRadius: "20px", padding: "48px 32px",
                                background: dragging ? "rgba(37, 99, 235, 0.05)" : file ? "rgba(37, 99, 235, 0.02)" : "var(--onyx)",
                                cursor: file ? "default" : "pointer", textAlign: "center",
                                transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                            }}
                        >
                            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.zip,.txt,.md,.rtf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f); }} />
                            {file ? (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px" }}>
                                    <div style={{ width: "44px", height: "44px", background: "var(--void)", border: "1.5px solid var(--border-mid)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        <FileText size={20} color="var(--sapphire)" />
                                    </div>
                                    <div style={{ textAlign: "left" }}>
                                        <p style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>{file.name}</p>
                                        <p style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="btn-ghost" style={{ padding: "6px 12px", background: "rgba(239, 68, 68, 0.05)", color: "var(--crimson)", border: "none" }}>Remove</button>
                                </div>
                            ) : (
                                <div>
                                    <div style={{ width: "56px", height: "56px", background: "var(--void)", border: "1.5px solid var(--border-mid)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                                        <Upload size={22} color="var(--sapphire)" />
                                    </div>
                                    <p style={{ fontWeight: "700", fontSize: "15px", marginBottom: "6px", color: "var(--text-primary)" }}>Drop manuscript draft here</p>
                                    <p style={{ color: "var(--text-tertiary)", fontSize: "12px" }}>PDF, DOCX, ZIP, TXT, MD, RTF · max 150 MB</p>
                                </div>
                            )}
                        </div>

                        {/* Title & language */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                            <div>
                                <label className="field-label">BOOK TITLE</label>
                                <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="Title of your book..." className="input-field" />
                            </div>
                            <div>
                                <label className="field-label">LANGUAGE</label>
                                <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input-field">
                                    {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Book type visual cards */}
                        <div>
                            <label className="field-label">GENRE / BOOK TYPE</label>
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
                                        }} style={{
                                            padding: "14px 12px", background: sel ? "var(--void)" : "var(--onyx)",
                                            border: `1.5px solid ${sel ? bt.accent : "var(--border-mid)"}`,
                                            borderRadius: "12px", cursor: "pointer", textAlign: "left", transition: "all 0.2s"
                                        }}>
                                            <div style={{ fontSize: "20px", marginBottom: "6px" }}>{bt.icon}</div>
                                            <div style={{ fontSize: "12px", fontWeight: "700", color: sel ? bt.accent : "var(--text-primary)" }}>{bt.label}</div>
                                            <div style={{ fontSize: "10px", color: "var(--text-tertiary)", marginTop: "2px" }}>{bt.subtitle}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Book size and visual ruler */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "28px", alignItems: "start" }}>
                            <div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                                    <label className="field-label" style={{ margin: 0 }}>BOOK TRIM SIZE</label>
                                    <UnitSelector value={dimUnit} onChange={setDimUnit} />
                                </div>

                                {!isAdvanced ? (
                                    <>
                                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                                            {SIZE_VISUAL.map((s) => {
                                                const sel = selectedSizeKey === s.key;
                                                return (
                                                    <button key={s.key} onClick={() => setSelectedSizeKey(s.key)} style={{
                                                        padding: "8px 14px", background: sel ? "var(--void)" : "var(--onyx)",
                                                        border: `1.5px solid ${sel ? "var(--sapphire)" : "var(--border-mid)"}`,
                                                        borderRadius: "10px", cursor: "pointer", minWidth: "80px",
                                                    }}>
                                                        <div style={{ fontSize: "13px", fontWeight: "700", color: sel ? "var(--sapphire)" : "var(--text-primary)" }}>{s.label}</div>
                                                        <div style={{ fontSize: "10px", color: "var(--text-tertiary)", marginTop: "2px" }}>{s.desc}</div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {isCustomSizeKey && (
                                            <div style={{ display: "flex", gap: "10px" }}>
                                                <div style={{ flex: 1 }}>
                                                    <label className="field-label">WIDTH ({UNIT_LABELS[dimUnit]})</label>
                                                    <input type="number" value={customSizeW} onChange={(e) => setCustomSizeW(Number(e.target.value))} className="input-field" />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <label className="field-label">HEIGHT ({UNIT_LABELS[dimUnit]})</label>
                                                    <input type="number" value={customSizeH} onChange={(e) => setCustomSizeH(Number(e.target.value))} className="input-field" />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                            <div>
                                                <label className="field-label">PAGE PRESET</label>
                                                <select value={presetIndex} onChange={(e) => setPresetIndex(Number(e.target.value))} className="input-field">
                                                    {PAGE_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
                                                </select>
                                            </div>
                                            {isCustomPreset && (
                                                <div style={{ display: "flex", gap: "10px" }}>
                                                    <div style={{ flex: 1 }}>
                                                        <label className="field-label">WIDTH ({UNIT_LABELS[dimUnit]})</label>
                                                        <input type="number" value={customW} onChange={(e) => setCustomW(Number(e.target.value))} className="input-field" />
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <label className="field-label">HEIGHT ({UNIT_LABELS[dimUnit]})</label>
                                                        <input type="number" value={customH} onChange={(e) => setCustomH(Number(e.target.value))} className="input-field" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Dynamic Rulers Visualizer */}
                            <div>
                                <label className="field-label">TRIM PREVIEW</label>
                                <PageSizePreview
                                    w={pageW} h={pageH} unit={dimUnit}
                                    title={bookTitle}
                                    margins={isAdvanced ? {
                                        top: Number(marginTop) || 20,
                                        bottom: Number(marginBottom) || 20,
                                        left: Number(marginLeft) || 20,
                                        right: Number(marginRight) || 20,
                                    } : undefined}
                                />
                            </div>
                        </div>

                        {/* Interior style templates */}
                        <div>
                            <label className="field-label">VISUAL TEMPLATE STYLE</label>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                                {VISUAL_TEMPLATES.map((t) => {
                                    const sel = templateKey === t.key;
                                    return (
                                        <button key={t.key} onClick={() => setTemplateKey(sel ? null : t.key)} style={{
                                            padding: "16px", background: sel ? "var(--void)" : "var(--onyx)",
                                            border: `1.5px solid ${sel ? "var(--sapphire)" : "var(--border-mid)"}`,
                                            borderRadius: "14px", cursor: "pointer", textAlign: "left", transition: "all 0.2s"
                                        }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                                                <span style={{ fontSize: "20px" }}>{t.emoji}</span>
                                                <span style={{ fontSize: "13px", fontWeight: "700", color: sel ? "var(--sapphire)" : "var(--text-primary)" }}>{t.name}</span>
                                            </div>
                                            <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
                                                {t.colors.map((c, i) => <div key={i} style={{ width: "12px", height: "12px", borderRadius: "3px", background: c, border: "1px solid rgba(0,0,0,0.08)" }} />)}
                                            </div>
                                            <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>{t.mood}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Print platform standards */}
                        <div>
                            <label className="field-label">PRINT PLATFORM DESTINATION</label>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px" }}>
                                {PRINT_PLATFORMS.map((p) => {
                                    const sel = printPlatform === p.key;
                                    return (
                                        <button key={p.key} onClick={() => setPrintPlatform(p.key)} style={{
                                            padding: "12px 10px", background: sel ? "var(--void)" : "var(--onyx)",
                                            border: `1.5px solid ${sel ? "var(--sapphire)" : "var(--border-mid)"}`,
                                            borderRadius: "10px", cursor: "pointer", textAlign: "center",
                                        }}>
                                            <div style={{ fontSize: "18px", marginBottom: "4px" }}>{p.icon}</div>
                                            <div style={{ fontSize: "11px", fontWeight: "700", color: sel ? "var(--sapphire)" : "var(--text-primary)" }}>{p.label}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Footer Settings Panels */}
                        <div className="card" style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "16px", padding: "24px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                                <BookMarked size={14} color="var(--sapphire)" />
                                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>Footer Page Layout</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
                                <div>
                                    <label className="field-label">LEFT (Book Name)</label>
                                    <input value={footerCustomLeft} onChange={(e) => setFooterCustomLeft(e.target.value)} placeholder={bookTitle || "Book Title (auto)"} className="input-field" />
                                </div>
                                <div>
                                    <label className="field-label">CENTRE (Optional)</label>
                                    <input value={footerCustomMiddle} onChange={(e) => setFooterCustomMiddle(e.target.value)} placeholder="e.g. Chapter Name" className="input-field" />
                                </div>
                                <div>
                                    <label className="field-label">RIGHT (Page Number)</label>
                                    <input value={footerCustomRight} onChange={(e) => setFooterCustomRight(e.target.value)} placeholder="Page Number (auto)" className="input-field" />
                                </div>
                            </div>
                        </div>

                        {/* Advanced overrides dropdowns */}
                        {isAdvanced && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                <CollapsibleSection title="AI Design Command" icon={<MessageSquare size={14} color="var(--sapphire)" />} defaultOpen={true}>
                                    <textarea value={aiCommand} onChange={(e) => setAiCommand(e.target.value)} placeholder="Give natural-language formatting instructions..." rows={4} className="input-field" />
                                </CollapsibleSection>

                                <CollapsibleSection title="Margins & Advanced Sizing" icon={<Ruler size={14} color="var(--sapphire)" />}>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                                        <div>
                                            <label className="field-label">TOP</label>
                                            <input type="number" value={marginTop} onChange={e => setMarginTop(e.target.value)} placeholder="Auto" className="input-field" />
                                        </div>
                                        <div>
                                            <label className="field-label">BOTTOM</label>
                                            <input type="number" value={marginBottom} onChange={e => setMarginBottom(e.target.value)} placeholder="Auto" className="input-field" />
                                        </div>
                                        <div>
                                            <label className="field-label">LEFT</label>
                                            <input type="number" value={marginLeft} onChange={e => setMarginLeft(e.target.value)} placeholder="Auto" className="input-field" />
                                        </div>
                                        <div>
                                            <label className="field-label">RIGHT</label>
                                            <input type="number" value={marginRight} onChange={e => setMarginRight(e.target.value)} placeholder="Auto" className="input-field" />
                                        </div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
                                        <TriToggle label="Mirror Margins" value={mirrorMargins} onChange={setMirrorMargins} />
                                        <div>
                                            <label className="field-label">GUTTER ({UNIT_LABELS[dimUnit]})</label>
                                            <input type="number" value={gutterMm} onChange={e => setGutterMm(e.target.value)} placeholder="Auto" className="input-field" />
                                        </div>
                                    </div>
                                </CollapsibleSection>

                                <CollapsibleSection title="Typography Controls" icon={<Type size={14} color="var(--sapphire)" />}>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                        <div>
                                            <label className="field-label">BODY FONT</label>
                                            <select value={bodyFont} onChange={e => setBodyFont(e.target.value)} className="input-field">
                                                {FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="field-label">LINE SPACING</label>
                                            <select value={lineSpacing} onChange={e => setLineSpacing(e.target.value)} className="input-field">
                                                {LINE_SPACING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </CollapsibleSection>

                                <CollapsibleSection title="Matter & Structure" icon={<BookCopy size={14} color="var(--sapphire)" />} defaultOpen={true}>
                                    <MatterCheckbox items={FRONT_MATTER_ITEMS} selected={frontMatter} onChange={setFrontMatter} />
                                </CollapsibleSection>
                            </div>
                        )}

                        <button onClick={handleSubmit} disabled={!file || loading} className="btn-dark" style={{ width: "100%", padding: "16px", borderRadius: "14px", justifyContent: "center" }}>
                            <Wand2 size={18} />
                            {file ? "Generate Custom Layout" : "Upload Manuscript First"}
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}

// ─── Home Mode Screen Component ───────────────────────────────────────────────
function HomeScreen({ onSelect }: { onSelect: (m: AppMode) => void }) {
    return (
        <div style={{ minHeight: "100vh", background: "var(--void)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 40px", fontFamily: "'DM Sans', sans-serif", position: "relative" }}>
            <div className="grid-overlay" />
            <div style={{ textAlign: "center", marginBottom: "48px", position: "relative", zIndex: 2 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "24px", padding: "6px 18px", marginBottom: "20px" }}>
                    <div style={{ width: "24px", height: "24px", background: "var(--text-primary)", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <LayoutTemplate size={12} color="var(--void)" />
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--sapphire)", letterSpacing: "0.08em" }}>BOOK LAYOUT DESIGNER</span>
                </div>
                <h1 className="serif" style={{ fontSize: "48px", fontWeight: "400", letterSpacing: "-0.02em", color: "var(--text-primary)", marginBottom: "12px" }}>
                    Format Your Book Layout
                </h1>
                <p style={{ color: "var(--text-secondary)", fontSize: "15px", maxWidth: "500px", margin: "0 auto", lineHeight: 1.5 }}>
                    Select your layout parameters. Auto mode formatting fits standard guidelines. Advanced mode details fine margins.
                </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", maxWidth: "800px", width: "100%", position: "relative", zIndex: 2 }}>
                {/* Author Mode Card */}
                <div
                    onClick={() => onSelect("author")}
                    className="card"
                    style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "20px", padding: "36px", cursor: "pointer", transition: "all 0.2s" }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.transform = "translateY(-4px)"; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border-mid)"; e.currentTarget.style.transform = "none"; }}
                >
                    <div style={{ fontSize: "36px", marginBottom: "16px" }}>👤</div>
                    <h3 className="serif" style={{ fontSize: "20px", color: "var(--text-primary)", marginBottom: "6px" }}>Author Mode</h3>
                    <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--sapphire)", letterSpacing: "0.06em", display: "block", marginBottom: "12px" }}>SIMPLE · GUIDED · AUTOMATIC</span>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "20px" }}>Best for novelists and self-publishers. AI sets typical standard dimensions and prints without complex configurations.</p>
                    <button className="btn-dark" style={{ width: "100%", justifyContent: "center" }}>Enter Author Mode</button>
                </div>

                {/* Advanced Mode Card */}
                <div
                    onClick={() => onSelect("advanced")}
                    className="card"
                    style={{ background: "var(--onyx)", border: "1.5px solid var(--border-mid)", borderRadius: "20px", padding: "36px", cursor: "pointer", transition: "all 0.2s" }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.transform = "translateY(-4px)"; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border-mid)"; e.currentTarget.style.transform = "none"; }}
                >
                    <div style={{ fontSize: "36px", marginBottom: "16px" }}>⚙️</div>
                    <h3 className="serif" style={{ fontSize: "20px", color: "var(--text-primary)", marginBottom: "6px" }}>Advanced Mode</h3>
                    <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--sapphire)", letterSpacing: "0.06em", display: "block", marginBottom: "12px" }}>COMPLETE CONTROL · CMYK · BLEED</span>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "20px" }}>Perfect for professional publishers. Control trim sizes, custom headers/footers, matter chapters, and print plate exports.</p>
                    <button className="btn-dark" style={{ width: "100%", justifyContent: "center" }}>Enter Advanced Mode</button>
                </div>
            </div>
        </div>
    );
}
