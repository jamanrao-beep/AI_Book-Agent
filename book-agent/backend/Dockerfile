FROM python:3.11-slim

# ── System dependencies ────────────────────────────────────────────────────────
# fonts-noto-core: Required for Hindi/Devanagari PDF rendering via ReportLab.
# Without this, all Devanagari text renders as square boxes (□□□).
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-core \
    fonts-noto \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# ── App ───────────────────────────────────────────────────────────────────────
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]