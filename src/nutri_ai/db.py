from collections.abc import Iterable
from typing import Any

from pgvector.psycopg import register_vector
from psycopg import connect
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
