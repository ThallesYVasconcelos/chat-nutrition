import sys
import uuid
import json
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
load_dotenv(ROOT / ".env")

from nutri_ai.db import (  # noqa: E402
    authenticate_app_user,
    create_app_user,
    create_chat_thread,
    get_chat_thread,
    list_chat_messages,
    list_chat_threads,
    list_document_sources,
    save_chat_message,
    search_documents,
    update_chat_thread_state,
)
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


def _login_panel() -> None:
    st.markdown(
        """
        <div class="main-hero">
            <h1>Entrar no Nutri AI</h1>
            <p>Acesse sua mesa de recomendações, mantenha histórico das consultas e revise conversas anteriores por conta.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    login_tab, signup_tab = st.tabs(["Entrar", "Criar conta"])
    with login_tab:
        with st.form("login_form"):
            email = st.text_input("Email", key="login_email")
            password = st.text_input("Senha", type="password", key="login_password")
            submitted = st.form_submit_button("Entrar", type="primary", use_container_width=True)
        if submitted:
            user = authenticate_app_user(email, password)
            if user:
                st.session_state.user = user
                _reset_workspace_state()
                st.rerun()
            st.error("Email ou senha inválidos.")

    with signup_tab:
        with st.form("signup_form"):
            full_name = st.text_input("Nome profissional")
            email = st.text_input("Email", key="signup_email")
            password = st.text_input("Senha", type="password", key="signup_password")
            confirm = st.text_input("Confirmar senha", type="password")
            submitted = st.form_submit_button("Criar conta", type="primary", use_container_width=True)
        if submitted:
            if len(password) < 6:
                st.warning("Use uma senha com pelo menos 6 caracteres.")
            elif password != confirm:
                st.warning("As senhas não conferem.")
            else:
                try:
                    user = create_app_user(email, password, full_name)
                    st.session_state.user = user
                    _reset_workspace_state()
                    st.rerun()
                except ValueError as exc:
                    st.error(str(exc))


def _reset_workspace_state() -> None:
    st.session_state.active_thread_id = None
    st.session_state.session_id = str(uuid.uuid4())
    st.session_state.profile = {}
    st.session_state.messages = _initial_triage_messages()
    st.session_state.last_evidence = []


def _initial_triage_messages() -> list[dict]:
    return [
        {
            "role": "assistant",
            "content": (
                "Vamos montar isso com cuidado. Vou perguntar uma coisa por vez "
                "e so gerar um rascunho quando os dados essenciais estiverem completos. "
                "Para comecar: qual e sua idade?"
            ),
        }
    ]


def _select_thread(user_id: str, thread_id: str) -> None:
    thread = get_chat_thread(user_id, thread_id)
    if not thread:
        st.warning("Conversa nao encontrada para esta conta.")
        return
    st.session_state.active_thread_id = str(thread["id"])
    st.session_state.session_id = str(thread["id"])
    st.session_state.profile = thread.get("profile") or {}
    st.session_state.last_evidence = thread.get("last_evidence") or []
    rows = list_chat_messages(user_id, thread_id)
    st.session_state.messages = [
        {"role": row["role"], "content": row["content"]}
        for row in rows
        if row["role"] in {"user", "assistant"}
    ] or _initial_triage_messages()


def _ensure_thread(user_id: str, title: str, mode: str) -> str:
    thread_id = st.session_state.get("active_thread_id")
    if thread_id:
        return thread_id
    thread_id = create_chat_thread(user_id=user_id, title=title[:120], mode=mode, profile=st.session_state.profile)
    st.session_state.active_thread_id = thread_id
    st.session_state.session_id = thread_id
    return thread_id


st.set_page_config(page_title="Nutri AI", page_icon="N", layout="wide")

st.markdown(
    """
    <style>
    .block-container {
        padding-top: 2rem;
        padding-bottom: 3rem;
        max-width: 1180px;
    }
    .main-hero {
        border: 1px solid #d8e2dc;
        border-radius: 8px;
        padding: 1.35rem 1.5rem;
        background: linear-gradient(135deg, #f8fbf7 0%, #eef7f0 100%);
        margin-bottom: 1rem;
    }
    .main-hero h1 {
        font-size: 2rem;
        margin: 0 0 .35rem 0;
        letter-spacing: 0;
    }
    .main-hero p {
        color: #41544a;
        font-size: 1rem;
        margin: 0;
        max-width: 820px;
    }
    .metric-strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: .75rem;
        margin: 1rem 0 1.25rem;
    }
    .work-card {
        border: 1px solid #dce5df;
        border-radius: 8px;
        padding: .85rem 1rem;
        background: #ffffff;
    }
    .work-card strong {
        display: block;
        color: #1f3329;
        margin-bottom: .15rem;
    }
    .work-card span {
        color: #53645a;
        font-size: .92rem;
    }
    .source-chip {
        display: inline-block;
        border: 1px solid #cfe0d5;
        border-radius: 999px;
        padding: .2rem .55rem;
        background: #f5faf6;
        color: #294235;
        font-size: .82rem;
        margin: .1rem .2rem .1rem 0;
    }
    .section-note {
        color: #53645a;
        font-size: .95rem;
        margin-bottom: 1rem;
    }
    div[data-testid="stTabs"] button p {
        font-size: .95rem;
        font-weight: 600;
    }
    div[data-testid="stExpander"] {
        border-radius: 8px;
        border-color: #dce5df;
    }
    .stButton > button {
        border-radius: 8px;
        font-weight: 600;
    }
    @media (max-width: 780px) {
        .metric-strip {
            grid-template-columns: 1fr;
        }
        .main-hero h1 {
            font-size: 1.55rem;
        }
    }
    </style>
    <div class="main-hero">
        <h1>Nutri AI</h1>
        <p>Uma mesa de apoio para nutricionistas: consulte recomendações por tema, veja fontes oficiais e leve trechos rastreáveis para sua conduta, aula, orientação ou estudo de caso.</p>
    </div>
    <div class="metric-strip">
        <div class="work-card"><strong>Consulta por tema</strong><span>Patologias, gestantes, infância, idoso, TEA e comportamento alimentar.</span></div>
        <div class="work-card"><strong>Fontes à vista</strong><span>Cada resposta vem com documentos e trechos recuperados.</span></div>
        <div class="work-card"><strong>Uso profissional</strong><span>Foco em síntese e orientação, não em substituir julgamento clínico.</span></div>
    </div>
    """,
    unsafe_allow_html=True,
)

if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())
if "profile" not in st.session_state:
    st.session_state.profile = {}
if "messages" not in st.session_state:
    st.session_state.messages = _initial_triage_messages()
if "last_evidence" not in st.session_state:
    st.session_state.last_evidence = []
if "active_thread_id" not in st.session_state:
    st.session_state.active_thread_id = None
if "user" not in st.session_state:
    st.session_state.user = None

if not st.session_state.user:
    _login_panel()
    st.stop()

current_user = st.session_state.user

with st.sidebar:
    st.subheader("Painel de trabalho")
    st.caption("Acompanhe a sessão e mantenha a consulta organizada.")
    st.success(current_user.get("full_name") or current_user.get("email"))
    if st.button("Sair da conta"):
        for key in ["user", "active_thread_id", "profile", "messages", "last_evidence", "session_id"]:
            st.session_state.pop(key, None)
        st.rerun()
    st.write("Sessão:", st.session_state.session_id[:8])
    if st.button("Nova conversa"):
        _reset_workspace_state()
        st.rerun()
    st.divider()
    st.markdown("**Histórico da conta**")
    try:
        threads = list_chat_threads(str(current_user["id"]))
        if threads:
            for thread in threads:
                label = f"{thread['title']} · {thread['mode']}"
                if st.button(label, key=f"thread_{thread['id']}", use_container_width=True):
                    _select_thread(str(current_user["id"]), str(thread["id"]))
                    st.rerun()
        else:
            st.caption("Nenhuma conversa salva ainda.")
    except Exception as exc:
        st.warning(f"Não consegui carregar o histórico: {exc}")
    with st.expander("Perfil coletado"):
        st.json(st.session_state.profile)
    st.divider()
    st.markdown("**Boas práticas**")
    st.markdown(
        "- Use perguntas específicas.\n"
        "- Confira os trechos citados.\n"
        "- Em patologias, use como apoio para raciocínio profissional."
    )

pro_tab, chat_tab, docs_tab, evidence_tab = st.tabs(
    ["Recomendações profissionais", "Triagem paciente", "Documentos", "Trechos da resposta"]
)

with pro_tab:
    st.subheader("Recomendações para profissionais")
    st.markdown(
        '<div class="section-note">Escolha um tema recorrente do consultório ou da rotina acadêmica e peça uma síntese prática baseada nos documentos da base.</div>',
        unsafe_allow_html=True,
    )
    topic_options = [
        "Patologias",
        "Gestantes",
        "Saúde da mulher",
        "Saúde do idoso",
        "Saúde da criança",
        "TEA",
        "Nutrição comportamental",
        "Obesidade",
        "Diabetes",
        "Hipertensão",
        "Doença celíaca",
    ]
    topic_examples = {
        "Patologias": "Quais cuidados gerais devo revisar antes de orientar um paciente com patologia crônica?",
        "Gestantes": "Quais pontos de atenção são importantes na orientação alimentar de gestantes?",
        "Saúde da mulher": "Quais recomendações alimentares podem apoiar saúde da mulher em diferentes fases?",
        "Saúde do idoso": "Quais sinais e cuidados nutricionais devo observar em idosos?",
        "Saúde da criança": "Quais orientações práticas ajudam famílias na alimentação infantil?",
        "TEA": "Quais pontos devo considerar em seletividade alimentar e rotina familiar no TEA?",
        "Nutrição comportamental": "Como estruturar orientações sem reforçar culpa alimentar?",
        "Obesidade": "Quais critérios e medidas ajudam a acompanhar obesidade no adulto?",
        "Diabetes": "Quais pontos alimentares gerais devo revisar em diabetes tipo 2?",
        "Hipertensão": "Quais orientações alimentares gerais são relevantes para hipertensão?",
        "Doença celíaca": "Quais cuidados devo reforçar sobre glúten e contaminação cruzada?",
    }

    left, right = st.columns([0.36, 0.64], gap="large")
    with left:
        topic = st.radio("Tema de consulta", topic_options, label_visibility="visible")
        st.markdown("**Atalhos úteis**")
        st.markdown(
            '<span class="source-chip">conduta</span>'
            '<span class="source-chip">educação alimentar</span>'
            '<span class="source-chip">risco</span>'
            '<span class="source-chip">encaminhamento</span>',
            unsafe_allow_html=True,
        )
    with right:
        default_question = topic_examples.get(topic, "")
        professional_question = st.text_area(
            "Pergunta do profissional",
            value=default_question,
            placeholder="Descreva a dúvida, o público ou o contexto de atendimento.",
            height=150,
        )
        st.caption("A resposta será acompanhada pelos trechos usados para fundamentação.")

    col_action, col_hint = st.columns([0.28, 0.72])
    with col_action:
        generate_clicked = st.button("Gerar recomendação", type="primary", use_container_width=True)
    with col_hint:
        st.info("Ideal para revisar orientações, preparar consulta, estudar patologias ou montar materiais educativos.")

    if generate_clicked:
        if not professional_question.strip():
            st.warning("Escreva uma pergunta para buscar nas fontes.")
        else:
            with st.spinner("Buscando documentos e sintetizando recomendacao..."):
                try:
                    thread_id = _ensure_thread(
                        str(current_user["id"]),
                        f"{topic}: {professional_question[:70]}",
                        "professional",
                    )
                    save_chat_message(
                        str(current_user["id"]),
                        thread_id,
                        "user",
                        f"[{topic}] {professional_question}",
                        metadata={"topic": topic},
                    )
                    docs = search_documents(f"{topic}. {professional_question}")
                    result = generate_professional_recommendation(topic, professional_question, docs)
                    st.session_state.last_evidence = result.get("evidence", [])
                    answer = result.get("content") or result.get("answer") or "Sem resposta gerada."
                    save_chat_message(
                        str(current_user["id"]),
                        thread_id,
                        "assistant",
                        answer,
                        evidence=st.session_state.last_evidence,
                        metadata={"topic": topic, "kind": "professional_recommendation"},
                    )
                    update_chat_thread_state(
                        str(current_user["id"]),
                        thread_id,
                        last_evidence=st.session_state.last_evidence,
                        title=f"{topic}: {professional_question[:70]}",
                    )
                    st.markdown(answer)
                    st.markdown(_format_evidence_section(st.session_state.last_evidence))
                except Exception as exc:
                    st.error(f"Nao consegui gerar a recomendacao: {exc}")

with docs_tab:
    st.subheader("Documentos usados pelo RAG")
    st.markdown(
        '<div class="section-note">Base documental disponível para consulta semântica. Use esta aba para saber de onde a ferramenta pode tirar evidências.</div>',
        unsafe_allow_html=True,
    )
    try:
        sources = list_document_sources()
        if sources:
            st.dataframe(
                [{"Documento": row["title"]} for row in sources],
                use_container_width=True,
                hide_index=True,
            )
        else:
            st.info("Nenhum documento encontrado no banco vetorial.")
    except Exception as exc:
        st.warning(f"Nao consegui listar documentos agora: {exc}")

with evidence_tab:
    st.subheader("Trechos usados na ultima resposta")
    st.markdown(
        '<div class="section-note">Aqui ficam os fragmentos recuperados na última consulta. Eles servem para auditoria rápida da resposta.</div>',
        unsafe_allow_html=True,
    )
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
    st.subheader("Triagem de paciente")
    st.markdown(
        '<div class="section-note">Área secundária para coletar dados essenciais em ping-pong. Use com cautela e sempre revise a saída profissionalmente.</div>',
        unsafe_allow_html=True,
    )
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    if prompt := st.chat_input("Responda a pergunta atual"):
        thread_id = _ensure_thread(str(current_user["id"]), f"Triagem: {prompt[:70]}", "triage")
        save_chat_message(str(current_user["id"]), thread_id, "user", prompt, metadata={"kind": "triage_input"})
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
            update_chat_thread_state(
                str(current_user["id"]),
                thread_id,
                profile=st.session_state.profile,
                last_evidence=st.session_state.last_evidence,
            )
        except Exception as exc:
            st.session_state.last_evidence = []
            response = (
                "Nao consegui continuar a orquestracao agora. Verifique `.env`, banco Supabase/Postgres "
                f"e dependencias. Detalhe tecnico: `{exc}`"
                "\n\n**Fontes e trechos**\n\nNao houve consulta a documentos nesta resposta por erro de execucao."
            )

        save_chat_message(
            str(current_user["id"]),
            thread_id,
            "assistant",
            response,
            evidence=st.session_state.last_evidence,
            metadata={"kind": "triage_response"},
        )
        st.session_state.messages.append({"role": "assistant", "content": response})
        with st.chat_message("assistant"):
            st.markdown(response)
