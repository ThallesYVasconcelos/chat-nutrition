import argparse
import hashlib
import sys
from pathlib import Path
from typing import Iterable

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nutri_ai.db import insert_documents  # noqa: E402
from nutri_ai.embeddings import embed_texts  # noqa: E402


def read_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if path.suffix.lower() in {".html", ".htm"}:
        html = path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
            tag.decompose()
        title = soup.title.get_text(" ", strip=True) if soup.title else path.stem
        body = soup.get_text("\n", strip=True)
        return f"{title}\n\n{body}"
    return path.read_text(encoding="utf-8", errors="ignore")


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 160) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(start + chunk_size, len(cleaned))
        chunks.append(cleaned[start:end])
        start = max(end - overlap, end) if end == len(cleaned) else end - overlap
    return chunks


def iter_source_files(source: Path) -> Iterable[Path]:
    allowed = {".pdf", ".txt", ".md", ".markdown", ".html", ".htm"}
    seen_hashes: set[str] = set()
    for path in source.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in allowed:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen_hashes:
            print(f"Skipping duplicate source file: {path.name}")
            continue
        seen_hashes.add(digest)
        yield path


def main() -> None:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data/reference_docs")
    args = parser.parse_args()

    source = (ROOT / args.source).resolve()
    rows = []
    for path in iter_source_files(source):
        chunks = chunk_text(read_text(path))
        embeddings = embed_texts(chunks)
        for index, (body, embedding) in enumerate(zip(chunks, embeddings, strict=True)):
            rows.append(
                {
                    "title": path.stem,
                    "source": str(path.relative_to(ROOT)),
                    "body": body,
                    "metadata": {"chunk_index": index, "file_name": path.name},
                    "embedding": embedding,
                }
            )

    inserted = insert_documents(rows)
    print(f"Inserted {inserted} document chunks.")


if __name__ == "__main__":
    main()
