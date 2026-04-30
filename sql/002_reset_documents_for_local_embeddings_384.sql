create extension if not exists vector;

drop function if exists public.match_nutrition_documents(vector, int, float);
drop index if exists public.nutrition_documents_embedding_idx;

truncate table public.nutrition_documents;

alter table public.nutrition_documents
  alter column embedding type vector(384)
  using null;

create index if not exists nutrition_documents_embedding_idx
  on public.nutrition_documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function public.match_nutrition_documents(
  query_embedding vector(384),
  match_count int default 6,
  match_threshold float default 0.68
)
returns table (
  id uuid,
  title text,
  source text,
  body text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    nutrition_documents.id,
    nutrition_documents.title,
    nutrition_documents.source,
    nutrition_documents.body,
    nutrition_documents.metadata,
    1 - (nutrition_documents.embedding <=> query_embedding) as similarity
  from public.nutrition_documents
  where nutrition_documents.embedding is not null
    and 1 - (nutrition_documents.embedding <=> query_embedding) >= match_threshold
  order by nutrition_documents.embedding <=> query_embedding
  limit match_count;
$$;
