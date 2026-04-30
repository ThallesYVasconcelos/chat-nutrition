create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.nutrition_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(384),
  created_at timestamptz not null default now()
);

create index if not exists nutrition_documents_embedding_idx
  on public.nutrition_documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists public.client_profiles (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  profile jsonb not null,
  risk_flags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.meal_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  client_profile_id uuid references public.client_profiles(id),
  objective text not null,
  budget_level text not null,
  plan jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  requires_professional_review boolean not null default true,
  created_at timestamptz not null default now()
);

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
