"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Upload,
    CheckCircle,
    Download,
    Sparkles,
    LayoutTemplate,
    X,
    FileText,
    Archive,
    BookMarked,
    ChevronDown,
    ChevronUp,
    Ruler,
    Paintbrush,
    MessageSquare,
    Type,
    AlignJustify,
    Wand2,
    BookOpen,
    GraduationCap,
    Star,
    Feather,
    Baby,
    Briefcase,
    Settings2,
    Info,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

// ─── Book Types ───────────────────────────────────────────────────────────────
const BOOK_TYPES = [
    {
        key: "novel",
        icon: "📖",
        label: "Novel",
        subtitle: "Fiction / Story",
        description: "Clean readable layout, flowing text, drop caps",
        accent: "#6366f1",
        bg: "rgba(99,102,241,0.08)",
        border: "rgba(99,102,241,0.3)",
        defaultSize: { label: "5×8 (127 × 203 mm)", w: 127, h: 203 },
        aiHint: "5×8 trim size is most popular for novels",
        designHint: "Classic readable serif typography with generous margins and drop caps",
    },
    {
        key: "academic",
        icon: "🎓",
        label: "Academic / Educational",
        subtitle: "Textbook / Study Material",
        description: "Structured headings, references, clean hierarchy",
        accent: "#0ea5e9",
        bg: "rgba(14,165,233,0.08)",
        border: "rgba(14,165,233,0.3)",
        defaultSize: { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
        aiHint: "A4 or 6×9 works best for academic books",
        designHint: "School Guide Style — clean headers, structured layout, academic typography",
    },
    {
        key: "religious",
        icon: "🕌",
        label: "Religious / Spiritual",
        subtitle: "Scripture / Discourse / Devotional",
        description: "Decorative headings, ornate chapter dividers",
        accent: "#f59e0b",
        bg: "rgba(245,158,11,0.08)",
        border: "rgba(245,158,11,0.3)",
        defaultSize: { label: "A5 (148 × 210 mm)", w: 148, h: 210 },
        aiHint: "A5 is the traditional size for religious texts",
        designHint: "Bhagavad Gita Style — warm cream pages, decorative ornaments, classic serif",
    },
    {
        key: "poetry",
        icon: "✍️",
        label: "Poetry / Shayari",
        subtitle: "Verse / Lyric / Ghazal",
        description: "Preserved line breaks, elegant spacing",
        accent: "#ec4899",
        bg: "rgba(236,72,153,0.08)",
        border: "rgba(236,72,153,0.3)",
        defaultSize: { label: "5×8 (127 × 203 mm)", w: 127, h: 203 },
        aiHint: "5×8 is the perfect intimate size for poetry",
        designHint: "Romance — elegant serif, generous whitespace, preserved poetic line breaks",
    },
    {
        key: "children",
        icon: "👶",
        label: "Children's Book",
        subtitle: "Stories / Picture Books",
        description: "Large fonts, image spaces, playful layout",
        accent: "#10b981",
        bg: "rgba(16,185,129,0.08)",
        border: "rgba(16,185,129,0.3)",
        defaultSize: { label: "Square (210 × 210 mm)", w: 210, h: 210 },
        aiHint: "Square format is fun and popular for children's books",
        designHint: "Children's book — large playful fonts, pastel colours, wide margins for illustrations",
    },
    {
        key: "business",
        icon: "💼",
        label: "Business / Self-help",
        subtitle: "Motivational / Professional",
        description: "Modern clean design, bold headings",
        accent: "#8b5cf6",
        bg: "rgba(139,92,246,0.08)",
        border: "rgba(139,92,246,0.3)",
        defaultSize: { label: "US Trade 6×9 (152 × 229 mm)", w: 152, h: 229 },
        aiHint: "6×9 is the professional standard for business books",
        designHint: "Modern minimalist — clean sans-serif, bold chapter headings, structured layout",
    },
    {
        key: "custom",
        icon: "✏️",
        label: "Custom / Other",
        subtitle: "Define your own style",
        description: "Describe exactly what you want — AI follows your instructions",
        accent: "#64748b",
        bg: "rgba(100,116,139,0.08)",
        border: "rgba(100,116,139,0.3)",
        defaultSize: { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
        aiHint: "You'll provide a custom description — AI will follow your exact instructions",
        designHint: "",
    },
];

// ─── Visual Templates ─────────────────────────────────────────────────────────
const VISUAL_TEMPLATES = [
    {
        key: "classic_novel",
        name: "Classic Novel",
        emoji: "📚",
        desc: "Premchand Novel Style",
        colors: ["#f5f0e8", "#2d2016", "#8b4513", "#c8a96e"],
        font: "Times Roman",
        mood: "Timeless · Warm · Literary",
        designText: "Classic cream pages with serif fonts, drop caps and ornamental chapter dividers",
    },
    {
        key: "premium_hardcover",
        name: "Premium Hardcover",
        emoji: "🏆",
        desc: "Luxury Edition Style",
        colors: ["#0f0f0f", "#e8d5b0", "#c8a200", "#666666"],
        font: "Times-Italic",
        mood: "Luxury · Dark · Gold",
        designText: "Luxury dark theme with gold accents, wide margins and elegant typography",
    },
    {
        key: "modern_minimal",
        name: "Modern Minimal",
        emoji: "⚡",
        desc: "Contemporary Clean",
        colors: ["#ffffff", "#1a1a2e", "#4a90d9", "#e8eaed"],
        font: "Helvetica",
        mood: "Clean · Modern · Crisp",
        designText: "Modern minimalist with clean sans-serif typography and subtle accents",
    },
    {
        key: "sanskrit_style",
        name: "Sanskrit / Vedic Style",
        emoji: "🕉️",
        desc: "Bhagavad Gita Style",
        colors: ["#fef9f0", "#5c3d11", "#d4a017", "#8b6914"],
        font: "Times-Roman",
        mood: "Sacred · Traditional · Gold",
        designText: "Traditional sacred style — warm saffron accents, ornate headings, classic serif",
    },
    {
        key: "school_guide",
        name: "School Guide Style",
        emoji: "📝",
        desc: "Academic Textbook",
        colors: ["#f8fafc", "#0f172a", "#2563eb", "#e2e8f0"],
        font: "Helvetica",
        mood: "Clear · Structured · Academic",
        designText: "School Guide Style — structured headers, clean sans-serif, academic layout",
    },
    {
        key: "thriller_dark",
        name: "Thriller Dark",
        emoji: "🌑",
        desc: "High Contrast Mystery",
        colors: ["#111827", "#f9fafb", "#ef4444", "#374151"],
        font: "Helvetica-Oblique",
        mood: "Dark · Intense · Dramatic",
        designText: "Thriller — high contrast dark pages, sharp modern layout, dramatic headings",
    },
    {
        key: "retro_vintage",
        name: "Retro Vintage",
        emoji: "🗞️",
        desc: "Old-style Antique",
        colors: ["#f5ead0", "#3d2b1f", "#8b4513", "#c4a76e"],
        font: "Times-Italic",
        mood: "Nostalgic · Warm · Antique",
        designText: "Retro vintage — warm sepia tones, old-style fonts, diagonal motifs",
    },
    {
        key: "poetry_bloom",
        name: "Poetry Bloom",
        emoji: "🌸",
        desc: "Romance / Shayari Style",
        colors: ["#fff0f5", "#4a1942", "#d63384", "#f8c8d8"],
        font: "Times-Italic",
        mood: "Romantic · Delicate · Poetic",
        designText: "Romance — blush tones, italic serif, floral ornaments, poetic spacing",
    },
    {
        key: "custom",
        name: "Custom / Other",
        emoji: "✏️",
        desc: "Describe your own style",
        colors: ["#1e293b", "#e2e8f0", "#f59e0b", "#475569"],
        font: "",
        mood: "Your Vision · AI Executed",
        designText: "",
    },
];

// ─── Book Size Visual Options ─────────────────────────────────────────────────
const SIZE_VISUAL = [
    { key: "5x8", label: "5 × 8", desc: "Novel size", w: 127, h: 203, popular: "Novels" },
    { key: "55x85", label: "5.5 × 8.5", desc: "Standard", w: 140, h: 216, popular: "Self-help" },
    { key: "6x9", label: "6 × 9", desc: "Trade size", w: 152, h: 229, popular: "Business" },
    { key: "A4", label: "A4", desc: "Print/Academic", w: 210, h: 297, popular: "Academic" },
    { key: "custom", label: "Custom", desc: "Any size", w: 0, h: 0, popular: "" },
];

// ─── Font Preference Buttons ──────────────────────────────────────────────────
const FONT_PREFS = [
    { key: "modern", label: "Modern", font: "Helvetica", desc: "Clean sans-serif" },
    { key: "traditional", label: "Traditional", font: "Times-Roman", desc: "Classic serif" },
    { key: "premium", label: "Premium", font: "Times-Italic", desc: "Elegant italic" },
    { key: "readable", label: "Easy to Read", font: "Helvetica", desc: "High readability" },
    { key: "custom", label: "Custom / Other", font: "", desc: "Describe your own preference" },
];

// ─── Spacing Options ──────────────────────────────────────────────────────────
const SPACING_OPTS = [
    { key: "compact", label: "Compact", value: "1.3", desc: "More text per page" },
    { key: "balanced", label: "Balanced", value: "1.5", desc: "Recommended", popular: true },
    { key: "spacious", label: "Spacious", value: "1.8", desc: "Airy, easy reading" },
    { key: "custom", label: "Custom / Other", value: "", desc: "Describe your own spacing" },
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
}

interface LayoutResult {
    job_id: string;
    title: string;
    style_name: string;
    concept: LayoutConcept;
    chapter_count: number;
    chapter_titles: string[];
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
    appearance: "none",
    WebkitAppearance: "none",
};
function focusBorder(e: React.FocusEvent<HTMLElement>) {
    (e.currentTarget as HTMLElement).style.borderColor = "rgba(245,158,11,0.5)";
}
function blurBorder(e: React.FocusEvent<HTMLElement>) {
    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
}

// ─── Page Preview ─────────────────────────────────────────────────────────────
function PagePreview({ w, h, concept }: { w: number; h: number; concept: LayoutConcept }) {
    const MAX_PREVIEW_W = 110;
    const MAX_PREVIEW_H = 150;
    const aspect = h / w;
    const pw = aspect >= 1 ? MAX_PREVIEW_W : MAX_PREVIEW_H / aspect;
    const ph = aspect >= 1 ? MAX_PREVIEW_W * aspect : MAX_PREVIEW_H;
    const scale = pw / w;
    const ml = (concept.margin_left_mm ?? 22) * scale;
    const mr = (concept.margin_right_mm ?? 22) * scale;
    const mt = (concept.margin_top_mm ?? 20) * scale;
    const mb = (concept.margin_bottom_mm ?? 20) * scale;
    return (
        <div style={{
            width: pw, height: ph,
            background: concept.page_bg || "#fff",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "3px", position: "relative", overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)", flexShrink: 0,
        }}>
            <div style={{ position: "absolute", top: mt * 0.6, left: ml, right: mr, height: "1px", background: concept.accent_color, opacity: 0.6 }} />
            <div style={{ position: "absolute", top: mt + 4, left: ml, right: mr, height: Math.max(5, concept.chapter_font_size * scale * 0.85), background: concept.chapter_title_color, borderRadius: "1px", opacity: 0.85 }} />
            <div style={{ position: "absolute", top: mt + 4 + Math.max(5, concept.chapter_font_size * scale * 0.85) + 3, left: ml, width: (pw - ml - mr) * 0.35, height: "1.5px", background: concept.accent_color }} />
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{
                    position: "absolute",
                    top: mt + 4 + Math.max(5, concept.chapter_font_size * scale * 0.85) + 14 + i * (concept.body_font_size * scale * concept.line_spacing),
                    left: ml + (i === 0 ? 0 : (concept.first_para_indent_mm ?? 6) * scale),
                    right: mr,
                    height: Math.max(2, concept.body_font_size * scale * 0.7),
                    background: concept.text_color, borderRadius: "1px",
                    opacity: i === 0 ? 0.75 : 0.35 + Math.random() * 0.15,
                }} />
            ))}
            {concept.show_page_numbers && (
                <div style={{ position: "absolute", bottom: mb * 0.55, left: "50%", transform: "translateX(-50%)", width: 6, height: 6, borderRadius: "50%", background: concept.accent_color, opacity: 0.7 }} />
            )}
        </div>
    );
}

// ─── Mini Template Card Preview ───────────────────────────────────────────────
function TemplateCardPreview({ colors }: { colors: string[] }) {
    return (
        <div style={{ width: "70px", height: "90px", background: colors[0], border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", overflow: "hidden", position: "relative", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: "10px", left: "8px", right: "8px", height: "8px", background: colors[2], borderRadius: "1px", opacity: 0.9 }} />
            <div style={{ position: "absolute", top: "24px", left: "8px", right: "8px", height: "3px", background: colors[1], borderRadius: "1px", opacity: 0.6 }} />
            <div style={{ position: "absolute", top: "32px", left: "8px", right: "8px", height: "3px", background: colors[1], borderRadius: "1px", opacity: 0.4 }} />
            <div style={{ position: "absolute", top: "40px", left: "8px", right: "8px", height: "3px", background: colors[1], borderRadius: "1px", opacity: 0.4 }} />
            <div style={{ position: "absolute", top: "48px", left: "8px", right: "8px", height: "3px", background: colors[1], borderRadius: "1px", opacity: 0.4 }} />
        </div>
    );
}

// ─── ConceptRow ───────────────────────────────────────────────────────────────
function ConceptRow({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569" }}>{label}</span>
            <span style={{ fontSize: "13px", color: "#cbd5e1" }}>{value}</span>
        </div>
    );
}

// ─── StyledSelect ─────────────────────────────────────────────────────────────
function StyledSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; label: string }) {
    return (
        <div style={{ flex: 1 }}>
            <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "6px" }}>{label}</label>
            <div style={{ position: "relative" }}>
                <select value={value} onChange={(e) => onChange(e.target.value)}
                    style={{ ...inputStyle, cursor: "pointer", paddingRight: "32px", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}
                    onFocus={focusBorder} onBlur={blurBorder}>
                    {options.map((o) => <option key={o.value} value={o.value} style={{ background: "#1e293b", color: "#e2e8f0" }}>{o.label}</option>)}
                </select>
            </div>
        </div>
    );
}

// ─── NumInput ─────────────────────────────────────────────────────────────────
function NumInput({ label, value, onChange, min, max, step = 1, placeholder }: { label: string; value: string; onChange: (v: string) => void; min: number; max: number; step?: number; placeholder?: string }) {
    return (
        <div style={{ flex: 1 }}>
            <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "6px" }}>{label}</label>
            <input type="number" min={min} max={max} step={step} value={value} placeholder={placeholder ?? "AI auto"}
                onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle }}
                onFocus={focusBorder} onBlur={blurBorder} />
        </div>
    );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean | null; onChange: (v: boolean | null) => void; hint?: string }) {
    const states: (boolean | null)[] = [null, true, false];
    const labels = ["AI", "On", "Off"];
    const current = states.indexOf(checked);
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
                <span style={{ fontSize: "13px", color: "#cbd5e1" }}>{label}</span>
                {hint && <span style={{ fontSize: "11px", color: "#475569", marginLeft: "6px" }}>{hint}</span>}
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
                {states.map((s, i) => (
                    <button key={i} onClick={() => onChange(s)} style={{
                        background: current === i ? "rgba(245,158,11,0.18)" : "rgba(0,0,0,0.25)",
                        border: `1px solid ${current === i ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "600",
                        color: current === i ? "#fbbf24" : "#64748b", cursor: "pointer", transition: "all 0.15s",
                    }}>{labels[i]}</button>
                ))}
            </div>
        </div>
    );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────
function StepIndicator({ current, total }: { current: number; total: number }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "32px" }}>
            {Array.from({ length: total }).map((_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{
                        width: i < current ? "28px" : "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: i < current ? "#f59e0b" : i === current ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.05)",
                        border: `2px solid ${i <= current ? "#f59e0b" : "rgba(255,255,255,0.1)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "11px", fontWeight: "700",
                        color: i < current ? "#0c0f1a" : i === current ? "#fbbf24" : "#475569",
                        transition: "all 0.3s",
                    }}>
                        {i < current ? "✓" : i + 1}
                    </div>
                    {i < total - 1 && (
                        <div style={{ width: "40px", height: "2px", background: i < current ? "#f59e0b" : "rgba(255,255,255,0.08)", borderRadius: "1px", transition: "all 0.3s" }} />
                    )}
                </div>
            ))}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function LayoutDesignerPage() {
    const router = useRouter();

    // ── Wizard step (0=upload, 1=bookType, 2=template, 3=wizard, 4=done) ──────
    const [wizardStep, setWizardStep] = useState(0);

    // ── Upload ────────────────────────────────────────────────────────────────
    const [file, setFile] = useState<File | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Cleanup polling on unmount
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    // ── Book type & template ──────────────────────────────────────────────────
    const [bookTypeKey, setBookTypeKey] = useState<string | null>(null);
    const [templateKey, setTemplateKey] = useState<string | null>(null);

    // ── Wizard selections ─────────────────────────────────────────────────────
    const [selectedSizeKey, setSelectedSizeKey] = useState<string>("6x9");
    const [fontPrefKey, setFontPrefKey] = useState<string>("traditional");
    const [spacingKey, setSpacingKey] = useState<string>("balanced");
    const [bookTitle, setBookTitle] = useState("");

    // ── Advanced settings ─────────────────────────────────────────────────────
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [presetIndex, setPresetIndex] = useState(0);
    const [customW, setCustomW] = useState(210);
    const [customH, setCustomH] = useState(297);
    const [designInstructions, setDesignInstructions] = useState("");
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
    const [showTypoPanel, setShowTypoPanel] = useState(false);

    // ── Custom / Other inputs ─────────────────────────────────────────────────
    const [customBookTypeDesc, setCustomBookTypeDesc] = useState("");
    const [customTemplateDesc, setCustomTemplateDesc] = useState("");
    const [customSizeW, setCustomSizeW] = useState(210);
    const [customSizeH, setCustomSizeH] = useState(297);
    const [customFontDesc, setCustomFontDesc] = useState("");
    const [customSpacingDesc, setCustomSpacingDesc] = useState("");

    // ── Job state ─────────────────────────────────────────────────────────────
    const [jobId, setJobId] = useState<string | null>(null);
    const [stage, setStage] = useState("");
    const [pct, setPct] = useState(0);
    const [statusMsg, setStatusMsg] = useState("");
    const [result, setResult] = useState<LayoutResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // ── Derived values ────────────────────────────────────────────────────────
    const bookType = BOOK_TYPES.find((t) => t.key === bookTypeKey);
    const template = VISUAL_TEMPLATES.find((t) => t.key === templateKey);
    const selectedSize = SIZE_VISUAL.find((s) => s.key === selectedSizeKey) ?? SIZE_VISUAL[2];
    const fontPref = FONT_PREFS.find((f) => f.key === fontPrefKey) ?? FONT_PREFS[1];
    const spacing = SPACING_OPTS.find((s) => s.key === spacingKey) ?? SPACING_OPTS[1];

    const preset = PAGE_PRESETS[presetIndex];
    const isCustom = preset.label === "Custom";
    const isCustomSizeKey = selectedSizeKey === "custom";
    const pageW = showAdvanced
        ? (isCustom ? customW : preset.w)
        : (isCustomSizeKey ? customSizeW : selectedSize.w);
    const pageH = showAdvanced
        ? (isCustom ? customH : preset.h)
        : (isCustomSizeKey ? customSizeH : selectedSize.h);

    const activeOverrides = [bodyFont, chapterFont, bodyFontSize, chapterFontSize, lineSpacing, marginTop, marginBottom, marginLeft, marginRight].filter(Boolean).length + (dropCap !== null ? 1 : 0) + (pageNumbers !== null ? 1 : 0);

    // ── Build AI design instructions from wizard selections ───────────────────
    function buildDesignInstructions(): string {
        if (designInstructions.trim()) return designInstructions.trim();
        const parts: string[] = [];
        // Template (custom overrides preset)
        if (templateKey === "custom" && customTemplateDesc.trim()) {
            parts.push(customTemplateDesc.trim());
        } else if (template && templateKey !== "custom") {
            parts.push(template.designText);
        } else if (bookTypeKey === "custom" && customBookTypeDesc.trim()) {
            parts.push(`Book type: ${customBookTypeDesc.trim()}`);
        } else if (bookType) {
            parts.push(bookType.designHint);
        }
        // Spacing
        if (spacingKey === "custom" && customSpacingDesc.trim()) {
            parts.push(`spacing preference: ${customSpacingDesc.trim()}`);
        } else if (spacingKey === "compact") {
            parts.push("compact tight spacing");
        } else if (spacingKey === "spacious") {
            parts.push("spacious airy layout");
        }
        // Font
        if (fontPrefKey === "custom" && customFontDesc.trim()) {
            parts.push(`font preference: ${customFontDesc.trim()}`);
        }
        return parts.join(". ");
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
            } catch { /* transient network error — keep polling */ }
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
            form.append("page_width_mm", String(pageW));
            form.append("page_height_mm", String(pageH));
            form.append("book_title", bookTitle.trim());
            form.append("design_instructions", buildDesignInstructions());

            // Book type — send to backend (skip "custom" key, description is in instructions)
            if (bookTypeKey && bookTypeKey !== "custom") {
                form.append("book_type", bookTypeKey);
            }

            // Visual template — send to backend (skip "custom" key)
            if (templateKey && templateKey !== "custom") {
                form.append("visual_template", templateKey);
            }

            // Typography overrides (advanced only)
            const effectiveBodyFont = bodyFont || (!showAdvanced && fontPrefKey !== "custom" ? fontPref.font : "");
            const effectiveLineSpacing = lineSpacing || (!showAdvanced && spacingKey !== "custom" ? spacing.value : "");
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
            if (pageNumbers !== null) form.append("show_page_numbers", String(pageNumbers));

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

    const STAGE_LABELS: Record<string, string> = {
        queued: "Queued",
        extracting: "Extracting text…",
        parsing: "Detecting chapters…",
        designing: "AI designing layout…",
        rendering: "Typesetting PDF…",
        rendering_docx: "Generating DOCX…",
        done: "Done!",
        error: "Error",
    };

    function reset() {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setFile(null); setJobId(null); setResult(null); setError(null); setLoading(false);
        setStage(""); setPct(0); setStatusMsg(""); setBookTitle("");
        setBookTypeKey(null); setTemplateKey(null); setWizardStep(0);
        setBodyFont(""); setChapterFont(""); setBodyFontSize(""); setChapterFontSize("");
        setLineSpacing(""); setMarginTop(""); setMarginBottom(""); setMarginLeft(""); setMarginRight("");
        setDropCap(null); setPageNumbers(null); setDesignInstructions("");
        setCustomBookTypeDesc(""); setCustomTemplateDesc(""); setCustomFontDesc(""); setCustomSpacingDesc("");
        setCustomSizeW(210); setCustomSizeH(297);
    }

    // ── AI suggestion text ────────────────────────────────────────────────────
    function getAISuggestion() {
        const lines: string[] = [];
        if (bookType) lines.push(`This is a ${bookType.label}.`);
        lines.push(`We suggest ${selectedSize.label} trim size${fontPref ? ` with ${fontPref.label} fonts` : ""}.`);
        const estPages = file ? Math.round(file.size / 3000) : null;
        if (estPages) lines.push(`Estimated ${estPages}+ pages · ${spacing.label} spacing`);
        lines.push(`Estimated printing cost: ₹${estPages ? Math.round(estPages * 0.38) : "~80"}/book`);
        return lines;
    }

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div style={{ minHeight: "100vh", background: "#0c0f1a", fontFamily: "'DM Sans', sans-serif", color: "#e2e8f0" }}>

            {/* ── Nav ── */}
            <nav style={{
                borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 40px",
                height: "60px", display: "flex", alignItems: "center", justifyContent: "space-between",
                position: "sticky", top: 0, background: "rgba(12,15,26,0.95)",
                backdropFilter: "blur(12px)", zIndex: 50,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", background: "linear-gradient(135deg,#f59e0b,#d97706)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <LayoutTemplate size={16} color="white" />
                    </div>
                    <span style={{ fontWeight: "700", fontSize: "15px", letterSpacing: "-0.01em" }}>Editorial AI</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {/* Advanced toggle in nav */}
                    <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        style={{
                            display: "flex", alignItems: "center", gap: "6px",
                            background: showAdvanced ? "rgba(245,158,11,0.12)" : "none",
                            border: `1px solid ${showAdvanced ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.1)"}`,
                            borderRadius: "8px", padding: "6px 14px",
                            color: showAdvanced ? "#fbbf24" : "#64748b", fontSize: "12px", cursor: "pointer", transition: "all 0.2s",
                        }}
                    >
                        <Settings2 size={13} /> {showAdvanced ? "Simple Mode" : "Advanced Mode"}
                    </button>
                    <button
                        onClick={() => router.push("/dashboard")}
                        style={{
                            display: "flex", alignItems: "center", gap: "6px",
                            background: "none", border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: "8px", padding: "6px 14px",
                            color: "#94a3b8", fontSize: "13px", cursor: "pointer",
                        }}
                        onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0"; }}
                        onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}
                    >
                        <ArrowLeft size={14} /> Dashboard
                    </button>
                </div>
            </nav>

            <main style={{ maxWidth: "900px", margin: "0 auto", padding: "52px 40px" }}>

                {/* Page header */}
                <div style={{ marginBottom: "40px" }}>
                    <div style={{
                        display: "inline-flex", alignItems: "center", gap: "6px",
                        background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
                        borderRadius: "20px", padding: "4px 14px",
                        fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em",
                        color: "#fbbf24", marginBottom: "18px",
                    }}>
                        <Wand2 size={11} /> AI PUBLISHING ASSISTANT
                    </div>
                    <h1 style={{ fontSize: "38px", fontWeight: "800", letterSpacing: "-0.03em", fontFamily: "'Playfair Display', serif", lineHeight: "1.1", marginBottom: "10px" }}>
                        Design Your Book Layout
                    </h1>
                    <p style={{ color: "#64748b", fontSize: "15px", lineHeight: "1.6" }}>
                        Upload your manuscript — AI handles everything else.
                    </p>
                </div>

                {/* Error banner */}
                {error && (
                    <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "14px 18px", marginBottom: "28px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "#fca5a5" }}>
                        {error}
                        <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}><X size={16} /></button>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════ */}
                {/* RESULT VIEW                                                */}
                {/* ══════════════════════════════════════════════════════════ */}
                {result && (
                    <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "16px", padding: "36px", animation: "fadeInUp 0.4s ease" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" }}>
                            <CheckCircle size={22} color="#f59e0b" />
                            <h2 style={{ fontSize: "20px", fontWeight: "700", fontFamily: "'Playfair Display', serif" }}>
                                Layout Ready — {result.title}
                            </h2>
                        </div>
                        <div style={{ display: "flex", gap: "36px", alignItems: "flex-start", marginBottom: "32px" }}>
                            <PagePreview w={pageW} h={pageH} concept={result.concept} />
                            <div style={{ flex: 1, display: "grid", gap: "14px" }}>
                                <ConceptRow label="Style" value={result.concept.style_name} />
                                <ConceptRow label="Body Font" value={`${result.concept.body_font}, ${result.concept.body_font_size}pt`} />
                                <ConceptRow label="Chapter Font" value={`${result.concept.chapter_font}, ${result.concept.chapter_font_size}pt`} />
                                <ConceptRow label="Line Spacing" value={`${result.concept.line_spacing}×`} />
                                <ConceptRow label="Margins" value={`↑${result.concept.margin_top_mm} ↓${result.concept.margin_bottom_mm} ←${result.concept.margin_left_mm} →${result.concept.margin_right_mm} mm`} />
                                <ConceptRow label="Ornament" value={result.concept.ornament || "none"} />
                                <ConceptRow label="Drop Caps" value={result.concept.show_drop_cap ? "Yes" : "No"} />
                                <ConceptRow label="Chapters" value={`${result.chapter_count} detected`} />
                                <ConceptRow label="Page Size" value={`${pageW} × ${pageH} mm`} />
                                <div>
                                    <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", display: "block", marginBottom: "8px" }}>Colour Palette</span>
                                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        {[result.concept.page_bg, result.concept.text_color, result.concept.chapter_title_color, result.concept.accent_color].map((col, i) => (
                                            <div key={i} title={col} style={{ width: "26px", height: "26px", borderRadius: "6px", background: col, border: "1px solid rgba(255,255,255,0.12)", cursor: "help" }} />
                                        ))}
                                    </div>
                                </div>
                                {result.chapter_titles.length > 0 && (
                                    <div>
                                        <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase", color: "#475569", display: "block", marginBottom: "6px" }}>Chapters Detected</span>
                                        <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: "8px", padding: "10px 14px", maxHeight: "110px", overflowY: "auto" }}>
                                            {result.chapter_titles.slice(0, 12).map((t, i) => (
                                                <div key={i} style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>
                                                    <span style={{ color: "#f59e0b" }}>{i + 1}.</span> {t}
                                                </div>
                                            ))}
                                            {result.chapter_titles.length > 12 && <div style={{ fontSize: "11px", color: "#475569" }}>+{result.chapter_titles.length - 12} more chapters</div>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                            <a href={`${API_BASE}${result.pdf_url}`} download style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "#f59e0b", color: "#0c0f1a", borderRadius: "10px", padding: "11px 22px", fontSize: "13px", fontWeight: "700", textDecoration: "none" }}
                                onMouseOver={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "0.85")}
                                onMouseOut={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "1")}>
                                <Download size={14} /> Download PDF
                            </a>
                            <a href={`${API_BASE}${result.docx_url}`} download style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24", borderRadius: "10px", padding: "11px 22px", fontSize: "13px", fontWeight: "600", textDecoration: "none" }}
                                onMouseOver={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "0.75")}
                                onMouseOut={(e) => ((e.currentTarget as HTMLAnchorElement).style.opacity = "1")}>
                                <Download size={14} /> Download DOCX
                            </a>
                        </div>
                        <button onClick={reset} style={{ marginTop: "22px", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "9px 18px", color: "#64748b", fontSize: "13px", cursor: "pointer" }}
                            onMouseOver={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#e2e8f0")}
                            onMouseOut={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#64748b")}>
                            ← Design another layout
                        </button>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════ */}
                {/* LOADING VIEW                                               */}
                {/* ══════════════════════════════════════════════════════════ */}
                {loading && !result && (
                    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "48px 36px", textAlign: "center" }}>
                        <div style={{ width: "52px", height: "52px", border: "3px solid rgba(245,158,11,0.2)", borderTop: "3px solid #f59e0b", borderRadius: "50%", margin: "0 auto 24px", animation: "spin 1s linear infinite" }} />
                        <p style={{ fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>{STAGE_LABELS[stage] || "Processing…"}</p>
                        <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>{statusMsg}</p>
                        <div style={{ height: "4px", background: "rgba(255,255,255,0.07)", borderRadius: "4px", overflow: "hidden", maxWidth: "320px", margin: "0 auto" }}>
                            <div style={{ height: "100%", background: "#f59e0b", width: `${pct}%`, borderRadius: "4px", transition: "width 0.6s ease" }} />
                        </div>
                        <p style={{ color: "#475569", fontSize: "12px", marginTop: "8px" }}>{pct}%</p>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════ */}
                {/* FORM VIEW                                                  */}
                {/* ══════════════════════════════════════════════════════════ */}
                {!loading && !result && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

                        {/* ── STEP 1: Upload ── */}
                        <section style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "28px" }}>
                            <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "18px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <Upload size={15} color="#f59e0b" /> Upload Your Manuscript
                            </h3>
                            <div
                                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={onDrop}
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    border: `2px dashed ${dragging ? "#f59e0b" : file ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.1)"}`,
                                    borderRadius: "10px", padding: "32px 20px", textAlign: "center", cursor: "pointer",
                                    background: dragging ? "rgba(245,158,11,0.05)" : "transparent", transition: "all 0.2s",
                                }}
                            >
                                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.zip" style={{ display: "none" }}
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f); }} />
                                {file ? (
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                                        {file.name.endsWith(".zip") ? <Archive size={18} color="#f59e0b" /> : file.name.endsWith(".pdf") ? <FileText size={18} color="#f59e0b" /> : <BookMarked size={18} color="#f59e0b" />}
                                        <span style={{ fontSize: "14px", fontWeight: "600", color: "#fbbf24" }}>{file.name}</span>
                                        <button onClick={(e) => { e.stopPropagation(); setFile(null); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", marginLeft: "4px" }}><X size={14} /></button>
                                    </div>
                                ) : (
                                    <>
                                        <Upload size={28} color="#475569" style={{ marginBottom: "10px" }} />
                                        <p style={{ fontSize: "14px", color: "#64748b", marginBottom: "4px" }}>Drop your book here or <span style={{ color: "#f59e0b" }}>click to browse</span></p>
                                        <p style={{ fontSize: "12px", color: "#334155" }}>PDF · DOCX · ZIP — up to 150 MB</p>
                                    </>
                                )}
                            </div>
                            {/* Book title input */}
                            <div style={{ marginTop: "16px" }}>
                                <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "8px" }}>
                                    Book Title <span style={{ color: "#334155" }}>(optional — auto-detected)</span>
                                </label>
                                <input type="text" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)}
                                    placeholder="e.g. My Book Title"
                                    style={{ ...inputStyle, fontSize: "14px", padding: "11px 14px" }}
                                    onFocus={focusBorder} onBlur={blurBorder} />
                            </div>
                        </section>

                        {/* ── STEP 2: Book Type Selection (MOST IMPORTANT) ── */}
                        <section style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "28px" }}>
                            <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <BookOpen size={16} color="#f59e0b" /> Select Your Book Type
                            </h3>
                            <p style={{ fontSize: "13px", color: "#475569", marginBottom: "20px" }}>This is the most important step — AI will base the entire layout on this.</p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                                {BOOK_TYPES.map((bt) => (
                                    <button
                                        key={bt.key}
                                        onClick={() => setBookTypeKey(bt.key)}
                                        style={{
                                            background: bookTypeKey === bt.key ? bt.bg : "rgba(0,0,0,0.2)",
                                            border: `2px solid ${bookTypeKey === bt.key ? bt.border : "rgba(255,255,255,0.06)"}`,
                                            borderRadius: "12px", padding: "18px 14px", textAlign: "left", cursor: "pointer",
                                            transition: "all 0.2s", position: "relative",
                                        }}
                                        onMouseOver={(e) => { if (bookTypeKey !== bt.key) (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.15)"; }}
                                        onMouseOut={(e) => { if (bookTypeKey !== bt.key) (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
                                    >
                                        {bookTypeKey === bt.key && (
                                            <div style={{ position: "absolute", top: "10px", right: "10px", width: "18px", height: "18px", borderRadius: "50%", background: bt.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#fff" }}>✓</div>
                                        )}
                                        <div style={{ fontSize: "26px", marginBottom: "8px" }}>{bt.icon}</div>
                                        <div style={{ fontSize: "13px", fontWeight: "700", color: bookTypeKey === bt.key ? "#e2e8f0" : "#cbd5e1", marginBottom: "3px" }}>{bt.label}</div>
                                        <div style={{ fontSize: "11px", color: bookTypeKey === bt.key ? "#94a3b8" : "#475569" }}>{bt.subtitle}</div>
                                        <div style={{ fontSize: "11px", color: bookTypeKey === bt.key ? "#64748b" : "#334155", marginTop: "6px", lineHeight: "1.4" }}>{bt.description}</div>
                                    </button>
                                ))}
                            </div>
                            {/* AI hint for selected book type */}
                            {bookType && (
                                <div style={{ marginTop: "14px", background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "8px", padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                    <Wand2 size={13} color="#f59e0b" style={{ flexShrink: 0, marginTop: "2px" }} />
                                    <span style={{ fontSize: "12px", color: "#fbbf24" }}>AI Suggestion: {bookType.aiHint}</span>
                                </div>
                            )}
                            {bookTypeKey === "custom" && (
                                <div style={{ marginTop: "14px" }}>
                                    <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "8px" }}>Describe your book type / genre <span style={{ color: "#f59e0b" }}>*</span></label>
                                    <textarea value={customBookTypeDesc} onChange={(e) => setCustomBookTypeDesc(e.target.value)}
                                        placeholder="e.g. A travel memoir with personal stories and photographs, needs an elegant journalistic style..."
                                        rows={3}
                                        style={{ ...inputStyle, fontSize: "13px", resize: "vertical", lineHeight: "1.55", fontFamily: "inherit", padding: "12px 14px" }}
                                        onFocus={focusBorder} onBlur={blurBorder} />
                                </div>
                            )}
                        </section>

                        {/* ── STEP 3: Visual Template (Canva-style) ── */}
                        <section style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "28px" }}>
                            <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <Paintbrush size={16} color="#f59e0b" /> Choose a Look & Feel
                            </h3>
                            <p style={{ fontSize: "13px", color: "#475569", marginBottom: "20px" }}>Pick a visual style — AI will design your book in this aesthetic.</p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                                {VISUAL_TEMPLATES.map((tmpl) => (
                                    <button
                                        key={tmpl.key}
                                        onClick={() => setTemplateKey(tmpl.key)}
                                        style={{
                                            background: templateKey === tmpl.key ? "rgba(245,158,11,0.1)" : "rgba(0,0,0,0.2)",
                                            border: `2px solid ${templateKey === tmpl.key ? "rgba(245,158,11,0.6)" : "rgba(255,255,255,0.06)"}`,
                                            borderRadius: "12px", padding: "14px 12px", cursor: "pointer",
                                            transition: "all 0.2s", textAlign: "left",
                                        }}
                                        onMouseOver={(e) => { if (templateKey !== tmpl.key) (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.15)"; }}
                                        onMouseOut={(e) => { if (templateKey !== tmpl.key) (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
                                    >
                                        {/* Mini color preview */}
                                        <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
                                            {tmpl.colors.map((c, i) => (
                                                <div key={i} style={{ flex: 1, height: "32px", borderRadius: "4px", background: c, border: "1px solid rgba(255,255,255,0.1)" }} />
                                            ))}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "3px" }}>
                                            <span style={{ fontSize: "14px" }}>{tmpl.emoji}</span>
                                            <span style={{ fontSize: "12px", fontWeight: "700", color: templateKey === tmpl.key ? "#fbbf24" : "#cbd5e1" }}>{tmpl.name}</span>
                                        </div>
                                        <div style={{ fontSize: "10px", color: "#475569" }}>{tmpl.desc}</div>
                                        <div style={{ fontSize: "10px", color: "#334155", marginTop: "4px" }}>{tmpl.mood}</div>
                                    </button>
                                ))}
                            </div>
                            {!templateKey && (
                                <div style={{ marginTop: "12px", fontSize: "12px", color: "#475569" }}>
                                    No template selected? — AI will automatically pick the best style for you.
                                </div>
                            )}
                            {templateKey === "custom" && (
                                <div style={{ marginTop: "14px" }}>
                                    <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "8px" }}>Describe your desired visual style <span style={{ color: "#f59e0b" }}>*</span></label>
                                    <textarea value={customTemplateDesc} onChange={(e) => setCustomTemplateDesc(e.target.value)}
                                        placeholder="e.g. Warm earthy tones, handwritten-feel headings, lots of whitespace, minimalist ornaments between sections..."
                                        rows={3}
                                        style={{ ...inputStyle, fontSize: "13px", resize: "vertical", lineHeight: "1.55", fontFamily: "inherit", padding: "12px 14px" }}
                                        onFocus={focusBorder} onBlur={blurBorder} />
                                </div>
                            )}
                        </section>

                        {/* ── STEP 4: AI Wizard ── */}
                        <section style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "28px" }}>
                            <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <Sparkles size={16} color="#f59e0b" /> Quick Setup — 3 Simple Questions
                            </h3>
                            <p style={{ fontSize: "13px", color: "#475569", marginBottom: "24px" }}>Just answer these — AI will handle the rest.</p>

                            {/* 4a: Book size */}
                            <div style={{ marginBottom: "24px" }}>
                                <div style={{ fontSize: "13px", fontWeight: "600", color: "#cbd5e1", marginBottom: "12px" }}>📐 What size should your book be?</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                                    {SIZE_VISUAL.map((sz) => (
                                        <button
                                            key={sz.key}
                                            onClick={() => setSelectedSizeKey(sz.key)}
                                            style={{
                                                background: selectedSizeKey === sz.key ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.2)",
                                                border: `2px solid ${selectedSizeKey === sz.key ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.06)"}`,
                                                borderRadius: "10px", padding: "14px 10px", cursor: "pointer",
                                                transition: "all 0.2s", textAlign: "center",
                                            }}
                                        >
                                            {/* Visual page icon */}
                                            <div style={{
                                                width: "28px", height: `${Math.round(28 * sz.h / sz.w)}px`,
                                                maxHeight: "40px",
                                                background: selectedSizeKey === sz.key ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)",
                                                border: `1px solid ${selectedSizeKey === sz.key ? "#f59e0b" : "rgba(255,255,255,0.15)"}`,
                                                borderRadius: "2px", margin: "0 auto 8px",
                                            }} />
                                            <div style={{ fontSize: "13px", fontWeight: "700", color: selectedSizeKey === sz.key ? "#fbbf24" : "#cbd5e1" }}>{sz.label}"</div>
                                            <div style={{ fontSize: "10px", color: "#475569", marginTop: "2px" }}>{sz.desc}</div>
                                            {sz.popular && (
                                                <div style={{ fontSize: "10px", color: selectedSizeKey === sz.key ? "#f59e0b" : "#334155", marginTop: "4px" }}>
                                                    ★ {sz.popular}
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                                {bookType && (
                                    <div style={{ marginTop: "10px", fontSize: "11px", color: "#64748b", display: "flex", alignItems: "center", gap: "6px" }}>
                                        <Info size={11} color="#64748b" />
                                        {bookType.aiHint}
                                    </div>
                                )}
                                {selectedSizeKey === "custom" && (
                                    <div style={{ marginTop: "14px", display: "flex", gap: "14px" }}>
                                        {[{ label: "Width (mm)", val: customSizeW, set: setCustomSizeW }, { label: "Height (mm)", val: customSizeH, set: setCustomSizeH }].map(({ label, val, set }) => (
                                            <div key={label} style={{ flex: 1 }}>
                                                <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "6px" }}>{label}</label>
                                                <input type="number" min={50} max={600} value={val}
                                                    onChange={(e) => set(Number(e.target.value))}
                                                    style={{ ...inputStyle, fontSize: "14px" }}
                                                    onFocus={focusBorder} onBlur={blurBorder} />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* 4b: Font preference */}
                            <div style={{ marginBottom: "24px" }}>
                                <div style={{ fontSize: "13px", fontWeight: "600", color: "#cbd5e1", marginBottom: "12px" }}>✍️ What font style do you prefer?</div>
                                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                    {FONT_PREFS.map((fp) => (
                                        <button
                                            key={fp.key}
                                            onClick={() => setFontPrefKey(fp.key)}
                                            style={{
                                                background: fontPrefKey === fp.key ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.2)",
                                                border: `2px solid ${fontPrefKey === fp.key ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.06)"}`,
                                                borderRadius: "10px", padding: "10px 18px", cursor: "pointer",
                                                transition: "all 0.2s", textAlign: "center",
                                            }}
                                        >
                                            <div style={{ fontSize: "13px", fontWeight: "700", color: fontPrefKey === fp.key ? "#fbbf24" : "#cbd5e1" }}>{fp.label}</div>
                                            <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>{fp.desc}</div>
                                        </button>
                                    ))}
                                </div>
                                <div style={{ marginTop: "8px", fontSize: "11px", color: "#475569" }}>AI will choose the best font based on your book type.</div>
                                {fontPrefKey === "custom" && (
                                    <div style={{ marginTop: "12px" }}>
                                        <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "8px" }}>Describe your font preference</label>
                                        <input type="text" value={customFontDesc} onChange={(e) => setCustomFontDesc(e.target.value)}
                                            placeholder="e.g. Something bold and editorial, or a warm handwritten feel..."
                                            style={{ ...inputStyle, fontSize: "13px", padding: "10px 14px" }}
                                            onFocus={focusBorder} onBlur={blurBorder} />
                                    </div>
                                )}
                            </div>

                            {/* 4c: Spacing */}
                            <div>
                                <div style={{ fontSize: "13px", fontWeight: "600", color: "#cbd5e1", marginBottom: "12px" }}>📄 Margins & Spacing</div>
                                <div style={{ display: "flex", gap: "10px" }}>
                                    {SPACING_OPTS.map((sp) => (
                                        <button
                                            key={sp.key}
                                            onClick={() => setSpacingKey(sp.key)}
                                            style={{
                                                flex: 1,
                                                background: spacingKey === sp.key ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.2)",
                                                border: `2px solid ${spacingKey === sp.key ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.06)"}`,
                                                borderRadius: "10px", padding: "12px 14px", cursor: "pointer",
                                                transition: "all 0.2s", textAlign: "center", position: "relative",
                                            }}
                                        >
                                            {sp.popular && (
                                                <div style={{ position: "absolute", top: "-8px", left: "50%", transform: "translateX(-50%)", background: "#f59e0b", color: "#0c0f1a", fontSize: "9px", fontWeight: "700", borderRadius: "4px", padding: "1px 6px" }}>AI RECOMMENDED</div>
                                            )}
                                            <div style={{ fontSize: "13px", fontWeight: "700", color: spacingKey === sp.key ? "#fbbf24" : "#cbd5e1" }}>{sp.label}</div>
                                            <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>{sp.desc}</div>
                                        </button>
                                    ))}
                                </div>
                                {spacingKey === "custom" && (
                                    <div style={{ marginTop: "12px" }}>
                                        <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "8px" }}>Describe your spacing preference</label>
                                        <input type="text" value={customSpacingDesc} onChange={(e) => setCustomSpacingDesc(e.target.value)}
                                            placeholder="e.g. Very wide margins with generous paragraph spacing, or tight academic style..."
                                            style={{ ...inputStyle, fontSize: "13px", padding: "10px 14px" }}
                                            onFocus={focusBorder} onBlur={blurBorder} />
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* ── STEP 5: AI Smart Suggestion Panel ── */}
                        {file && (
                            <section style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.07) 0%, rgba(99,102,241,0.04) 100%)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "14px", padding: "24px 28px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                                    <Wand2 size={15} color="#f59e0b" />
                                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#fbbf24" }}>AI Suggestion</span>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {getAISuggestion().map((line, i) => (
                                        <div key={i} style={{ fontSize: "13px", color: i === 0 ? "#e2e8f0" : "#94a3b8", display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                            <span style={{ color: "#f59e0b", flexShrink: 0 }}>›</span>
                                            {line}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* ── ADVANCED SETTINGS (Hidden by default) ── */}
                        {showAdvanced && (
                            <div style={{ border: "1px solid rgba(245,158,11,0.2)", borderRadius: "14px", overflow: "hidden" }}>
                                <div style={{ background: "rgba(245,158,11,0.07)", padding: "14px 20px", display: "flex", alignItems: "center", gap: "8px" }}>
                                    <Settings2 size={14} color="#fbbf24" />
                                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#fbbf24" }}>Advanced Settings</span>
                                    <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "4px" }}>— For professionals & power users</span>
                                </div>
                                <div style={{ background: "rgba(0,0,0,0.2)", padding: "24px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>

                                    {/* Page size advanced */}
                                    <div>
                                        <p style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", color: "#475569", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                                            <Ruler size={12} color="#f59e0b" /> Custom Page Size
                                        </p>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: isCustom ? "14px" : "0" }}>
                                            {PAGE_PRESETS.map((p, i) => (
                                                <button key={i} onClick={() => setPresetIndex(i)} style={{
                                                    background: presetIndex === i ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.2)",
                                                    border: `1px solid ${presetIndex === i ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`,
                                                    borderRadius: "8px", padding: "9px 10px", textAlign: "left", cursor: "pointer",
                                                    color: presetIndex === i ? "#fbbf24" : "#94a3b8", fontSize: "11px",
                                                    fontWeight: presetIndex === i ? "700" : "400", transition: "all 0.15s",
                                                }}>{p.label}</button>
                                            ))}
                                        </div>
                                        {isCustom && (
                                            <div style={{ display: "flex", gap: "14px" }}>
                                                {[{ label: "Width (mm)", val: customW, set: setCustomW }, { label: "Height (mm)", val: customH, set: setCustomH }].map(({ label, val, set }) => (
                                                    <div key={label} style={{ flex: 1 }}>
                                                        <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "6px" }}>{label}</label>
                                                        <input type="number" min={50} max={600} value={val}
                                                            onChange={(e) => set(Number(e.target.value))}
                                                            style={{ ...inputStyle, fontSize: "14px" }}
                                                            onFocus={focusBorder} onBlur={blurBorder} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Typography controls */}
                                    <div>
                                        <button onClick={() => setShowTypoPanel(!showTypoPanel)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                                            <p style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", color: "#475569", display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
                                                <Type size={12} color="#f59e0b" /> Typography Controls
                                                {activeOverrides > 0 && <span style={{ background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: "10px", padding: "1px 7px", fontSize: "10px", fontWeight: "700", color: "#fbbf24" }}>{activeOverrides}</span>}
                                            </p>
                                            <span style={{ color: "#64748b" }}>{showTypoPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                                        </button>
                                        {showTypoPanel && (
                                            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
                                                <div style={{ display: "flex", gap: "14px" }}>
                                                    <StyledSelect label="Body Font" value={bodyFont} onChange={setBodyFont} options={FONT_OPTIONS} />
                                                    <StyledSelect label="Chapter Heading Font" value={chapterFont} onChange={setChapterFont} options={FONT_OPTIONS} />
                                                </div>
                                                <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                                                    <NumInput label="Body Size (pt)" value={bodyFontSize} onChange={setBodyFontSize} min={9} max={14} step={0.5} placeholder="AI auto" />
                                                    <NumInput label="Chapter Size (pt)" value={chapterFontSize} onChange={setChapterFontSize} min={16} max={36} step={1} placeholder="AI auto" />
                                                    <div style={{ flex: 1 }}><StyledSelect label="Line Spacing" value={lineSpacing} onChange={setLineSpacing} options={LINE_SPACING_OPTIONS} /></div>
                                                </div>
                                                <div>
                                                    <p style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.07em", textTransform: "uppercase", color: "#475569", marginBottom: "10px" }}>Margins (mm)</p>
                                                    <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                                                        <NumInput label="Top" value={marginTop} onChange={setMarginTop} min={10} max={50} placeholder="AI" />
                                                        <NumInput label="Bottom" value={marginBottom} onChange={setMarginBottom} min={10} max={50} placeholder="AI" />
                                                        <NumInput label="Left (inner)" value={marginLeft} onChange={setMarginLeft} min={10} max={50} placeholder="AI" />
                                                        <NumInput label="Right (outer)" value={marginRight} onChange={setMarginRight} min={10} max={50} placeholder="AI" />
                                                    </div>
                                                </div>
                                                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "10px", padding: "14px 18px", display: "flex", flexDirection: "column", gap: "14px" }}>
                                                    <Toggle label="Drop Caps" hint="Large decorative first letter" checked={dropCap} onChange={setDropCap} />
                                                    <div style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />
                                                    <Toggle label="Page Numbers" checked={pageNumbers} onChange={setPageNumbers} />
                                                </div>
                                                {activeOverrides > 0 && (
                                                    <button onClick={() => { setBodyFont(""); setChapterFont(""); setBodyFontSize(""); setChapterFontSize(""); setLineSpacing(""); setMarginTop(""); setMarginBottom(""); setMarginLeft(""); setMarginRight(""); setDropCap(null); setPageNumbers(null); }}
                                                        style={{ alignSelf: "flex-start", background: "none", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", color: "#f87171", cursor: "pointer" }}>
                                                        ✕ Reset all overrides
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Design instructions */}
                                    <div>
                                        <p style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", color: "#475569", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
                                            <MessageSquare size={12} color="#f59e0b" /> Custom Design Instructions
                                        </p>
                                        <textarea value={designInstructions} onChange={(e) => setDesignInstructions(e.target.value)}
                                            placeholder="e.g. Classic cream pages with generous margins, drop caps, and subtle ornamental dividers…"
                                            rows={3}
                                            style={{ ...inputStyle, fontSize: "13px", resize: "vertical", lineHeight: "1.55", fontFamily: "inherit", padding: "12px 14px" }}
                                            onFocus={focusBorder} onBlur={blurBorder} />
                                        <p style={{ fontSize: "11px", color: "#334155", marginTop: "6px" }}>Filling this field will override the wizard selections above.</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Submit Button ── */}
                        <button
                            onClick={handleSubmit}
                            disabled={!file}
                            style={{
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                                background: file ? "linear-gradient(135deg, #f59e0b, #d97706)" : "rgba(245,158,11,0.2)",
                                color: file ? "#0c0f1a" : "#64748b",
                                border: "none", borderRadius: "14px", padding: "17px 32px",
                                fontSize: "16px", fontWeight: "800",
                                cursor: file ? "pointer" : "not-allowed", transition: "opacity 0.2s", width: "100%",
                                boxShadow: file ? "0 8px 32px rgba(245,158,11,0.3)" : "none",
                            }}
                            onMouseOver={(e) => { if (file) (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
                            onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                        >
                            <Wand2 size={18} />
                            {file ? "Generate Layout with AI" : "Upload Your Manuscript First"}
                        </button>

                        <p style={{ textAlign: "center", fontSize: "12px", color: "#334155" }}>
                            Powered by GPT-4o · Typeset with ReportLab · PDF + DOCX output
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