import sys
import uuid
import json
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
load_dotenv(ROOT / ".env")

from nutri_ai.db import list_document_sources, search_documents  # noqa: E402
from nutri_ai.graph import run_pingpong  # noqa: E402
from nutri_ai.planner import generate_professional_recommendation  # noqa: E402


def _extract_evidence(state: dict) -> list[dict]:
    plan = state.get("plan") or {}
    if plan.get("evidence"):
        return plan["evidence"]
    evidence = state.get("evidence") or []
    return [
        {
            "id": f"F{index}",
            "title": item.get("title"),
            "source": item.get("source"),
            "similarity": item.get("similarity"),
            "excerpt": (item.get("body") or "")[:700],
        }
        for index, item in enumerate(evidence, start=1)
    ]


def _format_evidence_section(evidence: list[dict]) -> str:
    if not evidence:
        return "\n\n**Fontes e trechos**\n\nResposta de coleta de dados: nenhuma fonte documental foi consultada ainda."

    lines = ["\n\n**Fontes e trechos usados**"]
    for item in evidence[:6]:
        similarity = item.get("similarity")
        score = f" Similaridade: {similarity:.3f}." if isinstance(similarity, float) else ""
        lines.append(
            "\n"
            f"- [{item.get('id')}] {item.get('title') or 'Documento'}."
            f"{score}\n"
            f"  Fonte: `{item.get('source') or 'sem fonte registrada'}`\n"
            f"  Trecho: {item.get('excerpt') or 'sem trecho disponivel'}"
        )
    return "\n".join(lines)


st.set_page_config(page_title="Nutri AI", page_icon="N", layout="wide")

st.title("Nutri AI")
st.caption("Base de recomendacoes para profissionais de nutricao, com RAG e trechos citados.")

if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())
if "profile" not in st.session_state:
    st.session_state.profile = {}
if "messages" not in st.session_state:
    st.session_state.messages = [
        {
            "role": "assistant",
            "content": (
                "Vamos montar isso com cuidado. Vou perguntar uma coisa por vez "
                "e so gerar um rascunho quando os dados essenciais estiverem completos. "
                "Para comecar: qual e sua idade?"
            ),
        }
    ]
if "last_evidence" not in st.session_state:
    st.session_state.last_evidence = []

with st.sidebar:
    st.subheader("Estado")
    st.write("Sessao:", st.session_state.session_id[:8])
    if st.button("Reiniciar conversa"):
        st.session_state.clear()
        st.rerun()
    with st.expander("Perfil coletado"):
        st.json(st.session_state.profile)

pro_tab, chat_tab, docs_tab, evidence_tab = st.tabs(
    ["Recomendações profissionais", "Triagem paciente", "Documentos", "Trechos da resposta"]
)

with pro_tab:
    st.subheader("Recomendações para profissionais")
    st.caption(
        "Consulte boas fontes por tema para ganhar tempo em condutas, orientacoes e revisoes. "
        "Esta area nao monta plano individual para paciente."
    )
    topic = st.selectbox(
        "Tema",
        [
            "Patologias",
            "Gestantes",
            "Saude da mulher",
            "Saude do idoso",
            "Saude da crianca",
            "TEA",
            "Nutricao comportamental",
            "Obesidade",
            "Diabetes",
            "Hipertensao",
            "Doenca celiaca",
        ],
    )
    professional_question = st.text_area(
        "Pergunta do profissional",
        placeholder="Ex.: quais pontos devo observar ao orientar um adulto com obesidade e cintura elevada?",
        height=120,
    )
    if st.button("Gerar recomendação com fontes", type="primary"):
        if not professional_question.strip():
            st.warning("Escreva uma pergunta para buscar nas fontes.")
        else:
            with st.spinner("Buscando documentos e sintetizando recomendacao..."):
                try:
                    docs = search_documents(f"{topic}. {professional_question}")
                    result = generate_professional_recommendation(topic, professional_question, docs)
                    st.session_state.last_evidence = result.get("evidence", [])
                    st.markdown(result.get("content") or result.get("answer") or "Sem resposta gerada.")
                    st.markdown(_format_evidence_section(st.session_state.last_evidence))
                except Exception as exc:
                    st.error(f"Nao consegui gerar a recomendacao: {exc}")

with docs_tab:
    st.subheader("Documentos usados pelo RAG")
    st.caption("Estes documentos foram embedados no Supabase/pgvector e podem ser recuperados para fundamentar respostas.")
    try:
        sources = list_document_sources()
        if sources:
            st.dataframe(sources, use_container_width=True, hide_index=True)
        else:
            st.info("Nenhum documento encontrado no banco vetorial.")
    except Exception as exc:
        st.warning(f"Nao consegui listar documentos agora: {exc}")

with evidence_tab:
    st.subheader("Trechos usados na ultima resposta")
    if st.session_state.last_evidence:
        for item in st.session_state.last_evidence:
            similarity = item.get("similarity")
            score = f" · similaridade {similarity:.3f}" if isinstance(similarity, float) else ""
            with st.expander(f"{item.get('id', 'Fonte')} · {item.get('title', 'sem titulo')}{score}"):
                st.caption(item.get("source") or "Fonte sem caminho registrado")
                st.write(item.get("excerpt") or "Sem trecho disponivel.")
    else:
        st.info("A ultima resposta foi uma pergunta de coleta ou ainda nao consultou documentos.")

with chat_tab:
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    if prompt := st.chat_input("Responda a pergunta atual"):
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        try:
            state = run_pingpong(
                session_id=st.session_state.session_id,
                profile=st.session_state.profile,
                user_message=prompt,
            )
            st.session_state.profile = state.get("profile", {})
            st.session_state.last_evidence = _extract_evidence(state)

            if state.get("plan"):
                response = (
                    "Dados essenciais completos. Gere um rascunho abaixo, mas ele deve ser revisado "
                    "por nutricionista, especialmente se houver patologia, medicacao ou alergia.\n\n"
                    f"```json\n{json.dumps(state['plan'], ensure_ascii=False, indent=2)}\n```"
                )
            else:
                response = state.get("next_question") or "Preciso de mais uma informacao para continuar."

            response += _format_evidence_section(st.session_state.last_evidence)

            if state.get("risk_flags"):
                response += (
                    "\n\nAtencao: identifiquei possiveis fatores de risco: "
                    + ", ".join(state["risk_flags"])
                    + ". A resposta final deve ser validada por profissional habilitado."
                )
        except Exception as exc:
            st.session_state.last_evidence = []
            response = (
                "Nao consegui continuar a orquestracao agora. Verifique `.env`, banco Supabase/Postgres "
                f"e dependencias. Detalhe tecnico: `{exc}`"
                "\n\n**Fontes e trechos**\n\nNao houve consulta a documentos nesta resposta por erro de execucao."
            )

        st.session_state.messages.append({"role": "assistant", "content": response})
        with st.chat_message("assistant"):
            st.markdown(response)
