"""
cors_middleware.py
──────────────────
Drop-in CORS fix for the Editorial AI backend.

USAGE (Flask)
─────────────
    from cors_middleware import apply_cors_flask
    app = Flask(__name__)
    apply_cors_flask(app)

USAGE (FastAPI)
───────────────
    from cors_middleware import apply_cors_fastapi
    app = FastAPI()
    apply_cors_fastapi(app)

USAGE (raw WSGI / add headers to every response manually)
──────────────────────────────────────────────────────────
    from cors_middleware import cors_headers
    # In your response builder:
    response.headers.update(cors_headers())

The allowed origins list defaults to "*" (all origins) which is fine for
development and for an API that uses token-based auth (no cookies).
Set CORS_ALLOWED_ORIGINS in your .env to a comma-separated list of
specific origins for production, e.g.:
    CORS_ALLOWED_ORIGINS=https://myapp.com,https://staging.myapp.com
"""

from __future__ import annotations
import os
from typing import List

load_dotenv_called = False
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
    load_dotenv_called = True
except ImportError:
    pass


# ── Configuration ────────────────────────────────────────────────────────────

def _allowed_origins() -> List[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS", "*")
    return [o.strip() for o in raw.split(",") if o.strip()]


def cors_headers(request_origin: str = "") -> dict:
    """
    Return a dict of CORS headers suitable for any HTTP response.

    If CORS_ALLOWED_ORIGINS is "*", the Access-Control-Allow-Origin header
    echoes back the request's Origin (or "*" if not provided).
    If specific origins are configured, only matching ones are reflected.
    """
    allowed = _allowed_origins()
    if "*" in allowed:
        origin_value = request_origin if request_origin else "*"
    else:
        origin_value = request_origin if request_origin in allowed else (allowed[0] if allowed else "")

    headers = {
        "Access-Control-Allow-Origin":      origin_value,
        "Access-Control-Allow-Methods":     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":     (
            "Content-Type, Authorization, X-Requested-With, "
            "Accept, Origin, Cache-Control"
        ),
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age":           "86400",  # 24 h preflight cache
    }
    return headers


# ── Flask integration ─────────────────────────────────────────────────────────

def apply_cors_flask(app) -> None:  # type: ignore[no-untyped-def]
    """
    Register Flask before/after request hooks that:
    1. Answer OPTIONS preflight requests immediately (204).
    2. Inject CORS headers into every other response.
    """
    try:
        from flask import request, make_response  # type: ignore
    except ImportError:
        raise RuntimeError("Flask is not installed. Run: pip install flask")

    @app.before_request  # type: ignore
    def _handle_preflight():
        if request.method == "OPTIONS":
            origin = request.headers.get("Origin", "")
            resp = make_response("", 204)
            resp.headers.update(cors_headers(origin))
            return resp

    @app.after_request  # type: ignore
    def _add_cors_headers(response):
        origin = request.headers.get("Origin", "")
        # Don't overwrite if already set (e.g. by flask-cors)
        if "Access-Control-Allow-Origin" not in response.headers:
            response.headers.update(cors_headers(origin))
        return response

    # Also expose common response headers so the browser can read them
    @app.after_request  # type: ignore
    def _expose_headers(response):
        response.headers.setdefault(
            "Access-Control-Expose-Headers",
            "Content-Disposition, Content-Length, X-Job-ID",
        )
        return response


# ── FastAPI / Starlette integration ───────────────────────────────────────────

def apply_cors_fastapi(app) -> None:  # type: ignore[no-untyped-def]
    """
    Add Starlette's CORSMiddleware to a FastAPI app with the configured origins.
    """
    try:
        from fastapi.middleware.cors import CORSMiddleware  # type: ignore
    except ImportError:
        raise RuntimeError("FastAPI is not installed. Run: pip install fastapi")

    allowed = _allowed_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition", "Content-Length", "X-Job-ID"],
        max_age=86400,
    )
