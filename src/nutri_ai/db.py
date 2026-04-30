from collections.abc import Iterable
from typing import Any

from pgvector.psycopg import register_vector
from psycopg import connect
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from nutri_ai.config import get_settings
from nutri_ai.embeddings import embed_query
from nutri_ai.schemas import EvidenceDocument


def get_connection():
    conn = connect(get_settings().resolved_database_url, row_factory=dict_row)
    register_vector(conn)
    return conn


def insert_documents(chunks: Iterable[dict[str, Any]]) -> int:
    rows = list(chunks)
    if not rows:
        return 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                insert into public.nutrition_documents (title, source, body, metadata, embedding)
                values (%(title)s, %(source)s, %(body)s, %(metadata)s, %(embedding)s)
                """,
                [{**row, "metadata": Jsonb(row["metadata"])} for row in rows],
            )
        conn.commit()
    return len(rows)


def search_documents(query: str) -> list[EvidenceDocument]:
    settings = get_settings()
    query_embedding = embed_query(query)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select *
                from public.match_nutrition_documents(%s::vector, %s::int, %s::float)
                """,
                (query_embedding, settings.nutri_doc_match_count, settings.nutri_doc_match_threshold),
            )
            rows = cur.fetchall()
    return [EvidenceDocument(**row) for row in rows]


def list_document_sources() -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                  title,
                  source,
                  count(*) as chunks,
                  min(created_at) as first_ingested_at
                from public.nutrition_documents
                group by title, source
                order by title, source
                """
            )
            return list(cur.fetchall())


def create_app_user(email: str, password: str, full_name: str | None = None) -> dict[str, Any]:
    normalized_email = email.strip().lower()
    if not normalized_email or not password:
        raise ValueError("Informe email e senha.")
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into public.app_users (email, full_name, password_hash)
                    values (%s, %s, crypt(%s, gen_salt('bf')))
                    returning id, email, full_name, created_at
                    """,
                    (normalized_email, full_name, password),
                )
                row = cur.fetchone()
            conn.commit()
        return dict(row)
    except UniqueViolation as exc:
        raise ValueError("Ja existe uma conta com este email.") from exc


def authenticate_app_user(email: str, password: str) -> dict[str, Any] | None:
    normalized_email = email.strip().lower()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, email, full_name, created_at
                from public.app_users
                where lower(email) = %s
                  and password_hash = crypt(%s, password_hash)
                """,
                (normalized_email, password),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    "update public.app_users set last_login_at = now() where id = %s",
                    (row["id"],),
                )
        conn.commit()
    return dict(row) if row else None


def create_chat_thread(
    user_id: str,
    title: str,
    mode: str = "professional",
    profile: dict[str, Any] | None = None,
) -> str:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.chat_threads (user_id, title, mode, profile)
                values (%s, %s, %s, %s)
                returning id
                """,
                (user_id, title, mode, Jsonb(profile or {})),
            )
            row = cur.fetchone()
        conn.commit()
    return str(row["id"])


def list_chat_threads(user_id: str, limit: int = 30) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, title, mode, profile, last_evidence, created_at, updated_at
                from public.chat_threads
                where user_id = %s
                order by updated_at desc
                limit %s
                """,
                (user_id, limit),
            )
            return list(cur.fetchall())


def get_chat_thread(user_id: str, thread_id: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, title, mode, profile, last_evidence, created_at, updated_at
                from public.chat_threads
                where user_id = %s and id = %s
                """,
                (user_id, thread_id),
            )
            row = cur.fetchone()
    return dict(row) if row else None


def list_chat_messages(user_id: str, thread_id: str) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select role, content, evidence, metadata, created_at
                from public.chat_messages
                where user_id = %s and thread_id = %s
                order by created_at
                """,
                (user_id, thread_id),
            )
            return list(cur.fetchall())


def save_chat_message(
    user_id: str,
    thread_id: str,
    role: str,
    content: str,
    evidence: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.chat_messages (user_id, thread_id, role, content, evidence, metadata)
                values (%s, %s, %s, %s, %s, %s)
                returning id
                """,
                (user_id, thread_id, role, content, Jsonb(evidence or []), Jsonb(metadata or {})),
            )
            row = cur.fetchone()
        conn.commit()
    return str(row["id"])


def update_chat_thread_state(
    user_id: str,
    thread_id: str,
    profile: dict[str, Any] | None = None,
    last_evidence: list[dict[str, Any]] | None = None,
    title: str | None = None,
) -> None:
    assignments = ["updated_at = now()"]
    params: list[Any] = []
    if profile is not None:
        assignments.append("profile = %s")
        params.append(Jsonb(profile))
    if last_evidence is not None:
        assignments.append("last_evidence = %s")
        params.append(Jsonb(last_evidence))
    if title is not None:
        assignments.append("title = %s")
        params.append(title)
    params.extend([user_id, thread_id])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                update public.chat_threads
                set {", ".join(assignments)}
                where user_id = %s and id = %s
                """,
                params,
            )
        conn.commit()


def save_client_profile(session_id: str, profile: dict[str, Any], risk_flags: list[str]) -> str:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.client_profiles (session_id, profile, risk_flags)
                values (%s, %s, %s)
                returning id
                """,
                (session_id, Jsonb(profile), risk_flags),
            )
            row = cur.fetchone()
        conn.commit()
    return str(row["id"])


def save_meal_plan(
    session_id: str,
    client_profile_id: str,
    objective: str,
    budget_level: str,
    plan: dict[str, Any],
    evidence: list[dict[str, Any]],
    requires_professional_review: bool,
) -> str:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.meal_plan_drafts
                  (session_id, client_profile_id, objective, budget_level, plan, evidence, requires_professional_review)
                values (%s, %s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    session_id,
                    client_profile_id,
                    objective,
                    budget_level,
                    Jsonb(plan),
                    Jsonb(evidence),
                    requires_professional_review,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return str(row["id"])
