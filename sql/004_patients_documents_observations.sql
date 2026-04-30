create extension if not exists pgcrypto;

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  full_name text not null,
  birth_date date,
  phone text,
  email text,
  objective text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patients_user_name_idx
  on public.patients (user_id, full_name);

create table if not exists public.patient_observations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  category text not null default 'geral',
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists patient_observations_patient_created_idx
  on public.patient_observations (patient_id, created_at desc);

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  title text not null,
  document_type text not null default 'orientacao',
  content text not null,
  status text not null default 'ativo' check (status in ('ativo', 'arquivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_documents_patient_created_idx
  on public.patient_documents (patient_id, created_at desc);

alter table public.chat_threads
  add column if not exists patient_id uuid references public.patients(id) on delete set null;

create or replace function public.touch_patient_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists patients_touch_updated_at on public.patients;
create trigger patients_touch_updated_at
before update on public.patients
for each row execute function public.touch_patient_updated_at();

drop trigger if exists patient_documents_touch_updated_at on public.patient_documents;
create trigger patient_documents_touch_updated_at
before update on public.patient_documents
for each row execute function public.touch_patient_updated_at();

