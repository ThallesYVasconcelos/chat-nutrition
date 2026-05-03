alter table public.app_users enable row level security;
alter table public.patients enable row level security;
alter table public.patient_observations enable row level security;
alter table public.patient_documents enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.patient_clinical_profiles enable row level security;
alter table public.meal_plans enable row level security;
alter table public.ai_generation_audits enable row level security;
alter table public.rag_query_logs enable row level security;

drop policy if exists app_users_own_user on public.app_users;
create policy app_users_own_user
on public.app_users
for all
using (oauth_subject = auth.uid()::text or id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (oauth_subject = auth.uid()::text or id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists patients_own_user on public.patients;
create policy patients_own_user
on public.patients
for all
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists patient_observations_own_user on public.patient_observations;
create policy patient_observations_own_user
on public.patient_observations
for all
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists patient_documents_own_user on public.patient_documents;
create policy patient_documents_own_user
on public.patient_documents
for all
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists chat_threads_own_user on public.chat_threads;
create policy chat_threads_own_user
on public.chat_threads
for all
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists chat_messages_own_user on public.chat_messages;
create policy chat_messages_own_user
on public.chat_messages
for all
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists patient_clinical_profiles_own_user on public.patient_clinical_profiles;
create policy patient_clinical_profiles_own_user
on public.patient_clinical_profiles
for all
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists meal_plans_own_user on public.meal_plans;
create policy meal_plans_own_user
on public.meal_plans
for all
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text))
with check (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists ai_generation_audits_own_user on public.ai_generation_audits;
create policy ai_generation_audits_own_user
on public.ai_generation_audits
for select
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));

drop policy if exists rag_query_logs_own_user on public.rag_query_logs;
create policy rag_query_logs_own_user
on public.rag_query_logs
for select
using (user_id in (select id from public.app_users where oauth_subject = auth.uid()::text));
