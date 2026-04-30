import base64
import hashlib
import json
import secrets
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from nutri_ai.config import Settings


def is_google_auth_configured(settings: Settings) -> bool:
    return bool(settings.supabase_url and settings.supabase_anon_key)


def create_pkce_verifier() -> str:
    return secrets.token_urlsafe(64)


def create_pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def build_google_oauth_url(settings: Settings, redirect_to: str, code_verifier: str) -> str:
    if not is_google_auth_configured(settings):
        raise RuntimeError("Configure SUPABASE_URL e SUPABASE_ANON_KEY para usar Google.")
    base_url = settings.supabase_url.rstrip("/")
    query = urlencode(
        {
            "provider": "google",
            "redirect_to": redirect_to,
            "code_challenge": create_pkce_challenge(code_verifier),
            "code_challenge_method": "s256",
        }
    )
    return f"{base_url}/auth/v1/authorize?{query}"


def exchange_code_for_session(settings: Settings, auth_code: str, code_verifier: str) -> dict[str, Any]:
    if not is_google_auth_configured(settings):
        raise RuntimeError("Configure SUPABASE_URL e SUPABASE_ANON_KEY para usar Google.")
    base_url = settings.supabase_url.rstrip("/")
    payload = json.dumps(
        {
            "auth_code": auth_code,
            "code_verifier": code_verifier,
        }
    ).encode("utf-8")
    request = Request(
        f"{base_url}/auth/v1/token?grant_type=pkce",
        data=payload,
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {settings.supabase_anon_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_user_identity(session_data: dict[str, Any]) -> tuple[str, str | None, str]:
    user = session_data.get("user") or {}
    metadata = user.get("user_metadata") or {}
    email = user.get("email") or metadata.get("email")
    full_name = metadata.get("full_name") or metadata.get("name")
    subject = user.get("id")
    if not email or not subject:
        raise ValueError("O Google nao retornou email ou identificador para o Supabase.")
    return email, full_name, subject
