create extension if not exists pgcrypto;

create table if not exists public.patient_clinical_profiles (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_clinical_profiles_user_idx
  on public.patient_clinical_profiles (user_id);

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  title text not null default 'Plano alimentar',
  content text not null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meal_plans_patient_updated_idx
  on public.meal_plans (patient_id, updated_at desc);

create table if not exists public.ai_generation_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  mode text not null,
  user_message text not null,
  final_answer text not null,
  evidence jsonb not null default '[]'::jsonb,
  judge jsonb not null default '{}'::jsonb,
  refinement_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_generation_audits_user_created_idx
  on public.ai_generation_audits (user_id, created_at desc);

create table if not exists public.rag_query_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete set null,
  thread_id uuid references public.chat_threads(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  query text not null,
  match_count int not null default 0,
  top_similarity float,
  used_fallback boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists rag_query_logs_user_created_idx
  on public.rag_query_logs (user_id, created_at desc);

create or replace function public.touch_structured_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists patient_clinical_profiles_touch_updated_at on public.patient_clinical_profiles;
create trigger patient_clinical_profiles_touch_updated_at
before update on public.patient_clinical_profiles
for each row execute function public.touch_structured_updated_at();

drop trigger if exists meal_plans_touch_updated_at on public.meal_plans;
create trigger meal_plans_touch_updated_at
before update on public.meal_plans
for each row execute function public.touch_structured_updated_at();
