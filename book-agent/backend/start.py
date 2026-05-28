import os
# pyrefly: ignore [missing-import]
import uvicorn

port = int(os.environ.get("PORT", 8000))
print(f"Starting on port {port}")
uvicorn.run("main:app", host="0.0.0.0", port=port)