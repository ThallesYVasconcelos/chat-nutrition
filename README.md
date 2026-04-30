# Nutrition Chatbot Base

Base em Python para um chatbot de nutricao com Streamlit, LangGraph, Postgres/pgvector e Supabase.

O objetivo desta base e evitar respostas apressadas: a orquestracao funciona em formato ping-pong, coletando uma informacao por vez, validando lacunas e so gerando um plano alimentar preliminar quando os dados essenciais estiverem completos.

## Stack

- Streamlit para a primeira interface.
- LangGraph para a orquestracao conversacional.
- Postgres com pgvector para busca semantica.
- Supabase como Postgres gerenciado em producao e opcionalmente local.
- LLM via Replicate, com `openai/gpt-4o-mini` como padrao.
- Embeddings locais/open-source com `intfloat/multilingual-e5-small` como padrao.

## Estrutura

```text
nutrition-chatbot/
  app.py
  requirements.txt
  .env.example
  sql/001_supabase_pgvector.sql
  scripts/ingest_documents.py
  src/nutri_ai/
    config.py
    db.py
    embeddings.py
    graph.py
    planner.py
    schemas.py
```

## Setup rapido

1. Crie e ative um ambiente virtual.
2. Instale dependencias:

```powershell
pip install -r requirements.txt
```

3. Copie `.env.example` para `.env` e preencha as variaveis, incluindo `REPLICATE_API_TOKEN`.
4. Rode o SQL em `sql/001_supabase_pgvector.sql` no Supabase SQL Editor ou no Postgres local com pgvector.
5. Coloque PDFs, TXT, Markdown ou HTML em `data/reference_docs`.
6. Ingestione os documentos:

```powershell
python scripts/ingest_documents.py --source data/reference_docs
```

Arquivos duplicados com o mesmo hash sao pulados automaticamente na ingestao.

7. Inicie:

```powershell
streamlit run app.py
```

## Ambientes local e producao

Use `APP_ENV=local` para desenvolvimento e `APP_ENV=production` em producao.

O app escolhe a conexao nesta ordem:

- `SUPABASE_DB_URL_LOCAL`, quando `APP_ENV=local`.
- `SUPABASE_DB_URL_PRODUCTION`, quando `APP_ENV=production`.
- `DATABASE_URL`, como fallback universal.

## Secrets do Streamlit

Para rodar no Streamlit, copie `.streamlit/secrets.example.toml` para `.streamlit/secrets.toml` no ambiente local ou configure os mesmos nomes no painel de secrets do Streamlit Cloud.

O app le primeiro `st.secrets` e usa `.env` como fallback para scripts locais, como ingestao e migracoes.

## LLM e embeddings

O gerador do plano usa Replicate com `REPLICATE_CHAT_MODEL=openai/gpt-4o-mini`.

Os embeddings rodam localmente com `LOCAL_EMBEDDING_MODEL=intfloat/multilingual-e5-small`, que gera vetores de 384 dimensoes. Por isso o SQL usa `vector(384)`.

## Guardrails clinicos

Esta base nao substitui nutricionista, medico ou conduta clinica. Para patologias, gestacao, lactacao, transtornos alimentares, insuficiencia renal, diabetes em uso de insulina, alergias graves, cirurgia bariatrica e outras situacoes de risco, o grafo marca a conversa como `requires_professional_review` e limita a resposta a orientacao educativa e encaminhamento.
