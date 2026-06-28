const fs = require('fs');
const path = require('path');

const pages = [
  { file: 'translate/page.tsx', endpoint: 'translate' },
  { file: 'proofread/page.tsx', endpoint: 'proofread' },
  { file: 'scan/page.tsx', endpoint: 'scan-handwritten' },
  { file: 'layout/page.tsx', endpoint: 'layout' },
];

const basePath = 'c:/Users/amanr/OneDrive/Desktop/Projects/book-agent/book-agent/frontend/app/dashboard';

for (const p of pages) {
  const filePath = path.join(basePath, p.file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 1. Add activeJobId state if not present
  if (!content.includes('activeJobId')) {
    content = content.replace(
      /const \[error, setError\] = useState\(""\);/g,
      `const [error, setError] = useState("");\n    const [activeJobId, setActiveJobId] = useState<string | null>(null);`
    );
  }
  
  // 2. Add handleCancel function
  if (!content.includes('handleCancel')) {
    content = content.replace(
      /const clearSession = \(\) => {/g,
      `const handleCancel = async () => {
        if (!activeJobId) return;
        try {
            await fetch(\`\${API_BASE}/${p.endpoint}/\${activeJobId}/cancel\`, { method: "POST" });
            setProgress({ stage: "error", pct: 0, message: "Cancelled by user" });
            setActiveJobId(null);
            if (pollRef.current) clearInterval(pollRef.current);
        } catch (err) {}
    };

    const clearSession = () => {`
    );
  }

  // 3. Set activeJobId when polling starts (after job creation)
  content = content.replace(
    /const data = await res\.json\(\);\n\s*poll\(data\.job_id\);/g,
    `const data = await res.json();\n            setActiveJobId(data.job_id);\n            poll(data.job_id);`
  );

  // 4. Clear activeJobId in clearSession
  content = content.replace(
    /setError\(""\);/g,
    `setError("");\n        setActiveJobId(null);`
  );

  // 5. Add Cancel button next to progress loader
  if (!content.includes('handleCancel}')) {
    content = content.replace(
      /<span>Processing blocks\.\.\.<\/span>\n\s*<\/div>\n\s*<\/div>\n\s*\)}/g,
      `<span>Processing blocks...</span>
                                    </div>
                                    <button onClick={handleCancel} className="btn-outline" style={{ width: "100%", padding: "8px", fontSize: "13px", color: "var(--crimson)", borderColor: "rgba(220,38,38,0.3)" }}>
                                        Cancel Generation
                                    </button>
                                </div>
                            )}`
    );
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Updated ${p.file}`);
}
