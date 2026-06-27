import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix global_exception_handler
old_handler = '''    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
    )'''
new_handler = '''    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on our end. Please try again later."},
    )'''
content = content.replace(old_handler, new_handler)

# 2. Fix specific HTTPException(500, f"Upload failed: {exc}")
content = re.sub(
    r'raise HTTPException\(500, f"Upload failed: \{exc\}"\) from exc',
    r'raise HTTPException(500, "We encountered an issue uploading your file. Please try again.") from exc',
    content
)

content = re.sub(
    r'raise HTTPException\(500, f"Proofreading failed: \{exc\}"\) from exc',
    r'raise HTTPException(500, "We encountered an issue proofreading your file. Please try again.") from exc',
    content
)

# 3. Fix Unsupported file type
content = re.sub(
    r'raise HTTPException\(400, f"Unsupported file type \'\{ext\}\'\. Upload \.txt, \.docx, \.pdf, \.md, \.rtf, or \.zip"\)',
    r'raise HTTPException(400, "That file type isn\'t supported. Please upload a .txt, .docx, .pdf, .md, .rtf, or .zip file.")',
    content
)

content = re.sub(
    r'raise HTTPException\(400, f"Unsupported file type \'\{ext\}\'\. Accepted: images, \.pdf, \.docx, \.zip"\)',
    r'raise HTTPException(400, "That file type isn\'t supported. Please upload an image, .pdf, .docx, or .zip file.")',
    content
)

content = re.sub(
    r'raise HTTPException\(400, f"Unsupported file type \'\{ext\}\'\. Upload \.pdf, \.docx, \.zip, \.txt, or \.md"\)',
    r'raise HTTPException(400, "That file type isn\'t supported. Please upload a .pdf, .docx, .zip, .txt, or .md file.")',
    content
)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
