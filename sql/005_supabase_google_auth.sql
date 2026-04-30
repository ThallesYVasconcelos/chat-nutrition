alter table public.app_users
  alter column password_hash drop not null;

alter table public.app_users
  add column if not exists oauth_provider text,
  add column if not exists oauth_subject text;

create unique index if not exists app_users_oauth_identity_idx
  on public.app_users (oauth_provider, oauth_subject)
  where oauth_provider is not null and oauth_subject is not null;
