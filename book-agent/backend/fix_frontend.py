import os
import re
import glob

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    needs_import = False

    # e instanceof Error ? e.message : "..."
    pattern = r'([a-zA-Z0-9_]+)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*["\'][^"\']+["\']'
    if re.search(pattern, content):
        needs_import = True
        content = re.sub(pattern, r'parseFriendlyError(\1)', content)

    # String(e) inside setError or similar
    pattern2 = r'setError\(String\(([^)]+)\)\)'
    if re.search(pattern2, content):
        needs_import = True
        content = re.sub(pattern2, r'setError(parseFriendlyError(\1))', content)

    # e.message inside setError
    pattern3 = r'setError\(([^)]+)\.message\)'
    if re.search(pattern3, content):
        needs_import = True
        content = re.sub(pattern3, r'setError(parseFriendlyError(\1))', content)

    if needs_import and "parseFriendlyError" not in content:
        import_stmt = 'import { parseFriendlyError } from "@/lib/api";\n'
        imports = list(re.finditer(r'^import .*?;?$', content, flags=re.MULTILINE))
        if imports:
            last_import = imports[-1]
            idx = last_import.end()
            content = content[:idx] + '\n' + import_stmt + content[idx:]
        else:
            content = import_stmt + content

    if needs_import:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")

if __name__ == "__main__":
    files = glob.glob("../frontend/app/dashboard/**/*.tsx", recursive=True)
    for f in files:
        process_file(f)
    print("Done")
