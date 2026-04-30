from typing import Any

from langgraph.graph import END, StateGraph

from nutri_ai.db import save_client_profile, save_meal_plan, search_documents
from nutri_ai.planner import (
    build_retrieval_query,
    detect_risk_flags,
    generate_meal_plan,
    missing_fields,
    next_question_for,
)
from nutri_ai.schemas import ClientProfile, ConversationState, EvidenceDocument


def parse_user_message_into_profile(profile: ClientProfile, message: str) -> ClientProfile:
    """Simple deterministic parser. Replace with structured LLM extraction when ready."""
    text = message.strip()
    if not text:
        return profile

    data = profile.model_dump()
    current_missing = missing_fields(profile)
    if not current_missing:
        return profile

    field = current_missing[0]
    lowered = text.lower()

    if field in {"age", "meals_per_day"}:
        digits = "".join(ch for ch in text if ch.isdigit())
        data[field] = int(digits) if digits else None
    elif field in {"height_cm", "weight_kg", "waist_cm", "hip_cm", "monthly_food_budget_brl"}:
        normalized = text.replace(",", ".")
        number = "".join(ch for ch in normalized if ch.isdigit() or ch == ".")
        data[field] = float(number) if number else None
    elif field == "objective":
        aliases = {
            "perda": "perda_de_gordura",
            "emag": "perda_de_gordura",
            "massa": "ganho_de_massa",
            "hipertrof": "ganho_de_massa",
            "manut": "manutencao",
            "performance": "performance",
            "clin": "suporte_clinico",
        }
        data[field] = next((value for key, value in aliases.items() if key in lowered), text)
    elif field == "budget_level":
        if "baixo" in lowered or "barato" in lowered:
            data[field] = "baixo"
        elif "alto" in lowered:
            data[field] = "alto"
        else:
            data[field] = "medio"
    else:
        data[field] = text

    return ClientProfile.model_validate(data)


def collect_node(state: ConversationState) -> ConversationState:
    profile = ClientProfile.model_validate(state.get("profile", {}))
    message = state.get("last_user_message", "")
    profile = parse_user_message_into_profile(profile, message)
    missing = missing_fields(profile)
    risks = detect_risk_flags(profile)

    state["profile"] = profile.model_dump(mode="json")
    state["missing_fields"] = missing
    state["risk_flags"] = risks
    state["requires_professional_review"] = bool(risks)
    state["ready_for_plan"] = not missing
    state["next_question"] = next_question_for(profile)
    state["evidence"] = []
    return state


def retrieve_node(state: ConversationState) -> ConversationState:
    profile = ClientProfile.model_validate(state["profile"])
    docs = search_documents(build_retrieval_query(profile))
    state["evidence"] = [doc.model_dump() for doc in docs]
    return state


def plan_node(state: ConversationState) -> ConversationState:
    profile = ClientProfile.model_validate(state["profile"])
    evidence = [EvidenceDocument.model_validate(item) for item in state.get("evidence", [])]
    plan = generate_meal_plan(profile, evidence)
    state["plan"] = plan

    client_profile_id = save_client_profile(
        state["session_id"],
        profile.model_dump(mode="json"),
        state.get("risk_flags", []),
    )
    save_meal_plan(
        session_id=state["session_id"],
        client_profile_id=client_profile_id,
        objective=profile.objective.value if profile.objective else "nao_informado",
        budget_level=profile.budget_level.value if profile.budget_level else "nao_informado",
        plan=plan,
        evidence=[doc.model_dump() for doc in evidence],
        requires_professional_review=state.get("requires_professional_review", True),
    )
    return state


def should_plan(state: ConversationState) -> str:
    return "retrieve" if state.get("ready_for_plan") else END


def build_graph():
    graph = StateGraph(ConversationState)
    graph.add_node("collect", collect_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("plan", plan_node)
    graph.set_entry_point("collect")
    graph.add_conditional_edges("collect", should_plan, {"retrieve": "retrieve", END: END})
    graph.add_edge("retrieve", "plan")
    graph.add_edge("plan", END)
    return graph.compile()


def run_pingpong(session_id: str, profile: dict[str, Any], user_message: str) -> ConversationState:
    app = build_graph()
    return app.invoke(
        {
            "session_id": session_id,
            "profile": profile,
            "last_user_message": user_message,
        }
    )
