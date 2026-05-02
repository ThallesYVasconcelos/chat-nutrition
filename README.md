# Nutri AI Workspace (Next.js + Supabase + Replicate)

Aplicação profissional para nutricionistas com:

- login Google via Supabase Auth
- pacientes como projetos
- chat clínico por paciente
- recomendações técnicas com RAG
- evidências rastreáveis por trecho

## Stack atual

- `Next.js` (App Router)
- `PostgreSQL/Supabase` com `pgvector`
- `Replicate` para geração (`openai/gpt-4o-mini`) e embedding de consulta
- legado em Python mantido para ingestão e manutenção de base documental

## Estrutura principal

- `app/page.tsx`: interface principal
- `app/api/*`: backend server-side para auth, pacientes, chats e RAG
- `lib/db.ts`: conexão Postgres
- `lib/supabase-server.ts`: validação de token Supabase
- `lib/ai.ts`: retrieval + geração no Replicate

## Variáveis de ambiente

Use `.env.example` como base:

- `APP_BASE_URL`
- `SUPABASE_DB_URL_PRODUCTION`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `REPLICATE_API_TOKEN`
- `REPLICATE_CHAT_MODEL`
- `REPLICATE_EMBEDDING_MODEL`
- `REPLICATE_MAX_COMPLETION_TOKENS`
- `NUTRI_DOC_MATCH_COUNT`
- `NUTRI_DOC_MATCH_THRESHOLD`

## Rodar local

```bash
npm install
npm run dev
```

## Deploy no Vercel

1. Importar o repositório no Vercel
2. Configurar todas as variáveis de ambiente do `.env.example`
3. Definir `APP_BASE_URL` com a URL final do projeto (`https://seu-app.vercel.app`)
4. Deploy

## Migrações de banco já utilizadas

- `sql/001_supabase_pgvector.sql`
- `sql/003_auth_and_chat_history.sql`
- `sql/004_patients_documents_observations.sql`
- `sql/005_supabase_google_auth.sql`

## Observação

Os embeddings dos documentos já existentes no Supabase continuam válidos.  
Não é necessário reprocessar a base documental para usar a interface Next.js.
