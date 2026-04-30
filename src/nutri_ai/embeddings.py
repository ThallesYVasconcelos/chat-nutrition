from functools import lru_cache

from sentence_transformers import SentenceTransformer

from nutri_ai.config import get_settings


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    settings = get_settings()
    return SentenceTransformer(settings.local_embedding_model)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    embeddings = get_embedding_model().encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
    embedding = get_embedding_model().encode([text], normalize_embeddings=True)
    return embedding[0].tolist()
