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
    create_patient,
    create_patient_document,
    create_patient_observation,
    get_chat_thread,
    get_patient,
    list_chat_messages,
    list_chat_threads,
    list_document_sources,
    list_patient_chat_threads,
    list_patient_documents,
    list_patient_observations,
    list_patients,
    save_chat_message,
    search_documents,
    update_patient,
    update_patient_document_status,
    update_chat_thread_state,
    upsert_oauth_app_user,
)
from nutri_ai.graph import run_pingpong  # noqa: E402
from nutri_ai.planner import generate_professional_recommendation  # noqa: E402
from nutri_ai.config import get_settings  # noqa: E402
from nutri_ai.supabase_auth import (  # noqa: E402
    build_google_oauth_url,
    create_pkce_verifier,
    exchange_code_for_session,
    extract_user_identity,
    is_google_auth_configured,
)


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


def _text_or_none(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _format_date(value: object) -> str:
    return "" if value is None else str(value)


def _oauth_redirect_url() -> str:
    settings = get_settings()
    return (settings.app_base_url or "http://localhost:8501").rstrip("/")


def _handle_google_callback() -> None:
    params = st.query_params
    error = params.get("error_description") or params.get("error")
    if error:
        st.error(f"Login com Google cancelado ou recusado: {error}")
        st.query_params.clear()
        return

    code = params.get("code")
    if not code or st.session_state.get("user"):
        return

    verifier = st.session_state.get("google_oauth_code_verifier")
    if not verifier:
        st.warning("Sessao de login expirada. Clique novamente em Entrar com Google.")
        st.query_params.clear()
        return

    try:
        settings = get_settings()
        session_data = exchange_code_for_session(settings, code, verifier)
        email, full_name, subject = extract_user_identity(session_data)
        user = upsert_oauth_app_user(email, full_name, "google", subject)
        st.session_state.user = user
        st.session_state.supabase_session = {
            "access_token": session_data.get("access_token"),
            "refresh_token": session_data.get("refresh_token"),
            "expires_at": session_data.get("expires_at"),
        }
        st.session_state.pop("google_oauth_code_verifier", None)
        st.query_params.clear()
        _reset_workspace_state()
        st.rerun()
    except Exception as exc:
        st.session_state.pop("google_oauth_code_verifier", None)
        st.query_params.clear()
        st.error(f"Nao consegui concluir o login com Google: {exc}")


def _login_panel() -> None:
    settings = get_settings()
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
        if is_google_auth_configured(settings):
            verifier = create_pkce_verifier()
            st.session_state.google_oauth_code_verifier = verifier
            auth_url = build_google_oauth_url(settings, _oauth_redirect_url(), verifier)
            st.link_button("Entrar com Google", auth_url, type="primary", use_container_width=True)
            st.caption("No primeiro acesso, a conta interna e criada automaticamente a partir do Google.")
            st.divider()
        else:
            st.info("Para liberar Google, configure SUPABASE_URL e SUPABASE_ANON_KEY nos secrets.")

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
    st.session_state.last_generated_answer = ""
    st.session_state.active_thread_patient_id = None


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
    st.session_state.active_thread_patient_id = str(thread["patient_id"]) if thread.get("patient_id") else None
    st.session_state.profile = thread.get("profile") or {}
    st.session_state.last_evidence = thread.get("last_evidence") or []
    rows = list_chat_messages(user_id, thread_id)
    st.session_state.messages = [
        {"role": row["role"], "content": row["content"]}
        for row in rows
        if row["role"] in {"user", "assistant"}
    ] or _initial_triage_messages()


def _ensure_thread(user_id: str, title: str, mode: str, patient_id: str | None = None) -> str:
    thread_id = st.session_state.get("active_thread_id")
    active_patient_id = st.session_state.get("active_thread_patient_id")
    if thread_id and active_patient_id == patient_id:
        return thread_id
    thread_id = create_chat_thread(
        user_id=user_id,
        title=title[:120],
        mode=mode,
        profile=st.session_state.profile,
        patient_id=patient_id,
    )
    st.session_state.active_thread_id = thread_id
    st.session_state.active_thread_patient_id = patient_id
    st.session_state.session_id = thread_id
    return thread_id


st.set_page_config(page_title="Nutri AI", page_icon="N", layout="wide")

st.markdown(
    """
    <style>
    html, body, [data-testid="stAppViewContainer"] {
        background: #f6f7fb;
    }
    .block-container {
        padding-top: 1.4rem;
        padding-bottom: 3rem;
        max-width: 1120px;
    }
    .main-hero {
        border: 1px solid #e4e7ec;
        border-radius: 8px;
        padding: 1rem 1.15rem;
        background: #ffffff;
        margin-bottom: .85rem;
        box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
    }
    .main-hero h1 {
        font-size: 1.55rem;
        margin: 0 0 .2rem 0;
        letter-spacing: 0;
        color: #101828;
    }
    .main-hero p {
        color: #667085;
        font-size: .95rem;
        margin: 0;
        max-width: 900px;
    }
    .work-card {
        border: 1px solid #e4e7ec;
        border-radius: 8px;
        padding: .8rem .9rem;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
    }
    .work-card strong {
        display: block;
        color: #101828;
        margin-bottom: .15rem;
    }
    .work-card span {
        color: #667085;
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
        color: #667085;
        font-size: .95rem;
        margin-bottom: 1rem;
    }
    [data-testid="stSidebar"] {
        background: #ffffff;
        border-right: 1px solid #e4e7ec;
    }
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p {
        color: #475467;
    }
    h2, h3 {
        color: #101828;
        letter-spacing: 0;
    }
    div[data-testid="stExpander"] {
        border-radius: 8px;
        border-color: #e4e7ec;
        background: #ffffff;
    }
    .stButton > button {
        border-radius: 8px;
        font-weight: 600;
    }
    div[data-testid="stDataFrame"] {
        border: 1px solid #e4e7ec;
        border-radius: 8px;
        overflow: hidden;
    }
    </style>
    <div class="main-hero">
        <h1>Nutri AI</h1>
        <p>Ambiente de consulta para nutricionistas: recomendações por tema, histórico por conta e respostas com trechos rastreáveis das fontes.</p>
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
if "last_generated_answer" not in st.session_state:
    st.session_state.last_generated_answer = ""
if "active_thread_id" not in st.session_state:
    st.session_state.active_thread_id = None
if "active_thread_patient_id" not in st.session_state:
    st.session_state.active_thread_patient_id = None
if "user" not in st.session_state:
    st.session_state.user = None
if "selected_page" not in st.session_state:
    st.session_state.selected_page = "Recomendações"
if "recommendation_topic" not in st.session_state:
    st.session_state.recommendation_topic = "Patologias"

_handle_google_callback()

if not st.session_state.user:
    _login_panel()
    st.stop()

current_user = st.session_state.user

with st.sidebar:
    st.subheader("Nutri AI")
    st.caption("Workspace do nutricionista")
    st.success(current_user.get("full_name") or current_user.get("email"))
    for page_name, label in [
        ("Recomendações", "Novo chat"),
        ("Pacientes", "Pacientes"),
        ("Documentos", "Fontes"),
        ("Trechos", "Evidências"),
    ]:
        selected = st.session_state.selected_page == page_name
        if st.button(label, key=f"nav_{page_name}", type="primary" if selected else "secondary", use_container_width=True):
            st.session_state.selected_page = page_name
            if page_name == "Recomendações":
                _reset_workspace_state()
            st.rerun()
    page = st.session_state.selected_page
    st.divider()
    st.markdown("**Pacientes**")
    try:
        sidebar_patients = list_patients(str(current_user["id"]))
        if sidebar_patients:
            for patient_row in sidebar_patients[:12]:
                selected = st.session_state.get("selected_patient_id") == str(patient_row["id"]) and page == "Pacientes"
                if st.button(
                    patient_row["full_name"],
                    key=f"sidebar_patient_{patient_row['id']}",
                    type="primary" if selected else "secondary",
                    use_container_width=True,
                ):
                    st.session_state.selected_patient_id = str(patient_row["id"])
                    st.session_state.selected_page = "Pacientes"
                    _reset_workspace_state()
                    st.rerun()
        else:
            st.caption("Nenhum paciente ainda.")
    except Exception as exc:
        st.caption(f"Pacientes indisponíveis: {exc}")
    if st.button("Sair da conta"):
        for key in [
            "user",
            "active_thread_id",
            "active_thread_patient_id",
            "profile",
            "messages",
            "last_evidence",
            "last_generated_answer",
            "session_id",
            "selected_patient_id",
            "selected_page",
            "recommendation_topic",
            "supabase_session",
            "google_oauth_code_verifier",
        ]:
            st.session_state.pop(key, None)
        st.rerun()
    st.write("Sessão:", st.session_state.session_id[:8])
    if st.button("Nova conversa"):
        _reset_workspace_state()
        st.rerun()
    st.divider()
    st.markdown("**Conversas gerais**")
    try:
        threads = list_chat_threads(str(current_user["id"]))
        if threads:
            for thread in threads:
                label = f"{thread['title']} · {thread['mode']}"
                selected = st.session_state.get("active_thread_id") == str(thread["id"])
                if st.button(label, key=f"thread_{thread['id']}", type="primary" if selected else "secondary", use_container_width=True):
                    _select_thread(str(current_user["id"]), str(thread["id"]))
                    st.session_state.selected_page = "Recomendações"
                    st.rerun()
        else:
            st.caption("Nenhuma conversa salva ainda.")
    except Exception as exc:
        st.warning(f"Não consegui carregar o histórico: {exc}")
    st.divider()
    st.markdown("**Boas práticas**")
    st.markdown(
        "- Use perguntas específicas.\n"
        "- Confira os trechos citados.\n"
        "- Em patologias, use como apoio para raciocínio profissional."
    )

if page == "Recomendações":
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

    st.markdown("**Tema**")
    topic_columns = st.columns(4)
    for index, option in enumerate(topic_options):
        with topic_columns[index % 4]:
            selected = st.session_state.recommendation_topic == option
            if st.button(option, key=f"topic_{option}", type="primary" if selected else "secondary", use_container_width=True):
                st.session_state.recommendation_topic = option
                st.rerun()
    topic = st.session_state.recommendation_topic

    recommendation_messages = st.session_state.messages if st.session_state.get("active_thread_id") else []
    for message in recommendation_messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    professional_question = st.chat_input(topic_examples.get(topic, "Digite sua pergunta para a base documental"))
    if professional_question:
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
                    if (
                        len(st.session_state.messages) == 1
                        and st.session_state.messages[0]["content"].startswith("Vamos montar")
                    ):
                        st.session_state.messages = []
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
                    st.session_state.last_generated_answer = answer
                    user_message = f"[{topic}] {professional_question}"
                    assistant_message = answer + _format_evidence_section(st.session_state.last_evidence)
                    st.session_state.messages.append({"role": "user", "content": user_message})
                    st.session_state.messages.append({"role": "assistant", "content": assistant_message})
                    with st.chat_message("user"):
                        st.markdown(user_message)
                    with st.chat_message("assistant"):
                        st.markdown(assistant_message)
                except Exception as exc:
                    st.error(f"Nao consegui gerar a recomendacao: {exc}")

if page == "Pacientes":
    st.subheader("Cadastro de pacientes")
    st.markdown(
        '<div class="section-note">Organize pacientes por conta, registre observacoes de acompanhamento e guarde documentos gerados para revisao posterior.</div>',
        unsafe_allow_html=True,
    )

    user_id = str(current_user["id"])
    try:
        patients = list_patients(user_id)
    except Exception as exc:
        st.error(f"Nao consegui carregar os pacientes: {exc}")
        patients = []

    left, right = st.columns([0.34, 0.66], gap="large")
    with left:
        st.markdown("**Novo paciente**")
        with st.form("patient_create_form", clear_on_submit=True):
            full_name = st.text_input("Nome completo")
            birth_date = st.text_input("Nascimento", placeholder="AAAA-MM-DD")
            phone = st.text_input("Telefone")
            email = st.text_input("Email")
            objective = st.text_input("Objetivo principal")
            notes = st.text_area("Resumo inicial", height=110)
            submitted = st.form_submit_button("Cadastrar paciente", type="primary", use_container_width=True)
        if submitted:
            if not full_name.strip():
                st.warning("Informe o nome do paciente.")
            else:
                try:
                    patient_id = create_patient(
                        user_id=user_id,
                        full_name=full_name,
                        birth_date=_text_or_none(birth_date),
                        phone=_text_or_none(phone),
                        email=_text_or_none(email),
                        objective=_text_or_none(objective),
                        notes=_text_or_none(notes),
                    )
                    st.session_state.selected_patient_id = patient_id
                    st.success("Paciente cadastrado.")
                    st.rerun()
                except Exception as exc:
                    st.error(f"Nao consegui cadastrar o paciente: {exc}")

        st.divider()
        st.markdown("**Pacientes cadastrados**")
        if patients:
            patient_options = {f"{row['full_name']}": str(row["id"]) for row in patients}
            current_id = st.session_state.get("selected_patient_id")
            option_labels = list(patient_options.keys())
            selected_index = 0
            if current_id in patient_options.values():
                selected_index = list(patient_options.values()).index(current_id)
            selected_label = st.selectbox("Selecionar paciente", option_labels, index=selected_index)
            st.session_state.selected_patient_id = patient_options[selected_label]
        else:
            st.info("Nenhum paciente cadastrado ainda.")

    with right:
        patient_id = st.session_state.get("selected_patient_id")
        patient = get_patient(user_id, patient_id) if patient_id else None
        if not patient:
            st.info("Cadastre ou selecione um paciente para abrir o prontuario.")
        else:
            st.markdown(f"**{patient['full_name']}**")
            st.caption(patient.get("objective") or "Sem objetivo principal registrado.")

            with st.expander("Dados do paciente", expanded=True):
                with st.form(f"patient_edit_{patient['id']}"):
                    edit_name = st.text_input("Nome completo", value=patient.get("full_name") or "")
                    edit_birth_date = st.text_input("Nascimento", value=_format_date(patient.get("birth_date")))
                    edit_phone = st.text_input("Telefone", value=patient.get("phone") or "")
                    edit_email = st.text_input("Email", value=patient.get("email") or "")
                    edit_objective = st.text_input("Objetivo principal", value=patient.get("objective") or "")
                    edit_notes = st.text_area("Resumo do caso", value=patient.get("notes") or "", height=120)
                    updated = st.form_submit_button("Salvar dados", use_container_width=True)
                if updated:
                    if not edit_name.strip():
                        st.warning("O nome do paciente nao pode ficar vazio.")
                    else:
                        try:
                            update_patient(
                                user_id=user_id,
                                patient_id=str(patient["id"]),
                                full_name=edit_name,
                                birth_date=_text_or_none(edit_birth_date),
                                phone=_text_or_none(edit_phone),
                                email=_text_or_none(edit_email),
                                objective=_text_or_none(edit_objective),
                                notes=_text_or_none(edit_notes),
                            )
                            st.success("Dados atualizados.")
                            st.rerun()
                        except Exception as exc:
                            st.error(f"Nao consegui atualizar o paciente: {exc}")

            observations_tab, documents_tab, chat_tab = st.tabs(["Observacoes", "Documentos", "Chat"])

            with observations_tab:
                with st.form(f"observation_form_{patient['id']}", clear_on_submit=True):
                    category = st.selectbox(
                        "Tipo",
                        ["consulta", "evolucao", "exame", "conduta", "administrativo", "geral"],
                    )
                    note = st.text_area("Observacao", height=130)
                    saved_note = st.form_submit_button("Adicionar observacao", type="primary")
                if saved_note:
                    if not note.strip():
                        st.warning("Escreva a observacao antes de salvar.")
                    else:
                        try:
                            create_patient_observation(user_id, str(patient["id"]), category, note)
                            st.success("Observacao registrada.")
                            st.rerun()
                        except Exception as exc:
                            st.error(f"Nao consegui salvar a observacao: {exc}")

                try:
                    observations = list_patient_observations(user_id, str(patient["id"]))
                    if observations:
                        for item in observations:
                            with st.expander(f"{item['category']} - {item['created_at']}"):
                                st.write(item["note"])
                    else:
                        st.info("Nenhuma observacao registrada para este paciente.")
                except Exception as exc:
                    st.warning(f"Nao consegui listar observacoes: {exc}")

            with documents_tab:
                with st.form(f"patient_document_form_{patient['id']}", clear_on_submit=True):
                    doc_title = st.text_input("Titulo do documento")
                    doc_type = st.selectbox(
                        "Tipo",
                        ["orientacao", "plano", "evolucao", "relatorio", "outro"],
                    )
                    doc_content = st.text_area(
                        "Conteudo",
                        value=st.session_state.get("last_generated_answer", ""),
                        height=220,
                        help="Quando houver uma resposta gerada na aba de recomendacoes ou triagem, ela aparece aqui para salvar no paciente.",
                    )
                    saved_doc = st.form_submit_button("Salvar documento", type="primary")
                if saved_doc:
                    if not doc_title.strip() or not doc_content.strip():
                        st.warning("Informe titulo e conteudo do documento.")
                    else:
                        try:
                            create_patient_document(
                                user_id=user_id,
                                patient_id=str(patient["id"]),
                                title=doc_title,
                                document_type=doc_type,
                                content=doc_content,
                                thread_id=st.session_state.get("active_thread_id"),
                            )
                            st.success("Documento salvo no paciente.")
                            st.rerun()
                        except Exception as exc:
                            st.error(f"Nao consegui salvar o documento: {exc}")

                try:
                    documents = list_patient_documents(user_id, str(patient["id"]))
                    if documents:
                        for doc in documents:
                            status = doc.get("status") or "ativo"
                            with st.expander(f"{doc['title']} - {doc['document_type']} - {status}"):
                                st.caption(f"Criado em {doc['created_at']}")
                                st.write(doc["content"])
                                next_status = "arquivado" if status == "ativo" else "ativo"
                                button_label = "Arquivar" if status == "ativo" else "Restaurar"
                                if st.button(button_label, key=f"doc_status_{doc['id']}"):
                                    update_patient_document_status(user_id, str(doc["id"]), next_status)
                                    st.rerun()
                    else:
                        st.info("Nenhum documento salvo para este paciente.")
                except Exception as exc:
                    st.warning(f"Nao consegui listar documentos do paciente: {exc}")

            with chat_tab:
                st.caption("Chat do paciente: o que foi discutido fica vinculado ao cadastro selecionado.")
                try:
                    patient_threads = list_patient_chat_threads(user_id, str(patient["id"]))
                    if patient_threads:
                        st.markdown("**Conversas do paciente**")
                        for thread in patient_threads:
                            selected = st.session_state.get("active_thread_id") == str(thread["id"])
                            if st.button(
                                thread["title"],
                                key=f"patient_thread_{thread['id']}",
                                type="primary" if selected else "secondary",
                                use_container_width=True,
                            ):
                                _select_thread(user_id, str(thread["id"]))
                                st.rerun()
                    else:
                        st.caption("Nenhuma conversa vinculada a este paciente.")
                except Exception as exc:
                    st.warning(f"Nao consegui carregar conversas do paciente: {exc}")

                for message in st.session_state.messages:
                    with st.chat_message(message["role"]):
                        st.markdown(message["content"])

                patient_prompt = st.chat_input(f"Conversar sobre {patient['full_name']}")
                if patient_prompt:
                    thread_id = _ensure_thread(
                        user_id,
                        f"{patient['full_name']}: {patient_prompt[:70]}",
                        "patient_triage",
                        patient_id=str(patient["id"]),
                    )
                    save_chat_message(user_id, thread_id, "user", patient_prompt, metadata={"kind": "patient_chat"})
                    st.session_state.messages.append({"role": "user", "content": patient_prompt})
                    with st.chat_message("user"):
                        st.markdown(patient_prompt)

                    try:
                        state = run_pingpong(
                            session_id=st.session_state.session_id,
                            profile=st.session_state.profile,
                            user_message=patient_prompt,
                        )
                        st.session_state.profile = state.get("profile", {})
                        st.session_state.last_evidence = _extract_evidence(state)
                        if state.get("plan"):
                            response = (
                                "Dados essenciais completos. Rascunho para revisao profissional:\n\n"
                                f"```json\n{json.dumps(state['plan'], ensure_ascii=False, indent=2)}\n```"
                            )
                        else:
                            response = state.get("next_question") or "Preciso de mais uma informacao para continuar."
                        response += _format_evidence_section(st.session_state.last_evidence)
                    except Exception as exc:
                        st.session_state.last_evidence = []
                        response = f"Nao consegui continuar o chat do paciente agora. Detalhe tecnico: `{exc}`"

                    save_chat_message(
                        user_id,
                        thread_id,
                        "assistant",
                        response,
                        evidence=st.session_state.last_evidence,
                        metadata={"kind": "patient_chat_response"},
                    )
                    update_chat_thread_state(
                        user_id,
                        thread_id,
                        profile=st.session_state.profile,
                        last_evidence=st.session_state.last_evidence,
                    )
                    st.session_state.last_generated_answer = response
                    st.session_state.messages.append({"role": "assistant", "content": response})
                    with st.chat_message("assistant"):
                        st.markdown(response)

if page == "Documentos":
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

if page == "Trechos":
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

if page == "Triagem":
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
        st.session_state.last_generated_answer = response
        st.session_state.messages.append({"role": "assistant", "content": response})
        with st.chat_message("assistant"):
            st.markdown(response)
