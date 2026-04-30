from typing import Any

import os

import replicate

from nutri_ai.config import get_settings
from nutri_ai.schemas import ClientProfile, EvidenceDocument


ESSENTIAL_FIELDS = [
    "age",
    "sex",
    "height_cm",
    "weight_kg",
    "waist_cm",
    "hip_cm",
    "objective",
    "budget_level",
    "monthly_food_budget_brl",
    "meals_per_day",
    "routine",
    "restrictions",
    "allergies",
    "pathology_notes",
    "medications",
    "socioeconomic_notes",
]

FIELD_QUESTIONS = {
    "age": "Qual e sua idade?",
    "sex": "Qual sexo biologico devo considerar para estimativas nutricionais iniciais?",
    "height_cm": "Qual e sua altura em centimetros?",
    "weight_kg": "Qual e seu peso atual em kg?",
    "waist_cm": "Qual e sua medida de cintura em centimetros?",
    "hip_cm": "Qual e sua medida de quadril em centimetros?",
    "objective": "Qual e o objetivo principal: perda_de_gordura, ganho_de_massa, manutencao, performance ou suporte_clinico?",
    "budget_level": "O orcamento alimentar e baixo, medio ou alto?",
    "monthly_food_budget_brl": "Qual e o orcamento mensal aproximado para alimentacao, em reais?",
    "meals_per_day": "Quantas refeicoes por dia voce consegue fazer de forma realista?",
    "routine": "Como e sua rotina de horarios, trabalho, treino e sono?",
    "restrictions": "Ha restricoes alimentares, escolhas culturais ou alimentos que voce nao come?",
    "allergies": "Voce tem alergias ou intolerancias alimentares? Se nao, responda 'nao'.",
    "pathology_notes": "Existe alguma patologia ou condicao clinica relevante? Ex.: diabetes, hipertensao, renal, hepaticas, gastrite, gestacao. Se nao, responda 'nao'.",
    "medications": "Usa medicamentos ou suplementos importantes? Se nao, responda 'nao'.",
    "socioeconomic_notes": "Ha limitacoes socioeconomicas, acesso a cozinha, tempo, mercado ou preferencia por alimentos baratos?",
}

RISK_KEYWORDS = [
    "diabetes",
    "insulina",
    "renal",
    "rim",
    "hepat",
    "cirrose",
    "gesta",
    "lacta",
    "bariatr",
    "cancer",
    "transtorno alimentar",
    "anorexia",
    "bulimia",
    "alergia grave",
]


def missing_fields(profile: ClientProfile) -> list[str]:
    values = profile.model_dump()
    return [field for field in ESSENTIAL_FIELDS if values.get(field) in (None, "")]


def next_question_for(profile: ClientProfile) -> str:
    missing = missing_fields(profile)
    if not missing:
        return ""
    return FIELD_QUESTIONS[missing[0]]


def detect_risk_flags(profile: ClientProfile) -> list[str]:
    text = " ".join(
        value.lower()
        for value in [
            profile.pathology_notes or "",
            profile.medications or "",
            profile.allergies or "",
            profile.restrictions or "",
        ]
    )
    return [keyword for keyword in RISK_KEYWORDS if keyword in text]


def build_retrieval_query(profile: ClientProfile) -> str:
    return (
        f"plano alimentar nutricao {profile.objective} IMC {profile.bmi} "
        f"relacao cintura quadril {profile.waist_hip_ratio} "
        f"orcamento {profile.budget_level} patologias {profile.pathology_notes} "
        f"restricoes {profile.restrictions} alergias {profile.allergies}"
    )


def generate_meal_plan(profile: ClientProfile, evidence: list[EvidenceDocument]) -> dict[str, Any]:
    risk_flags = detect_risk_flags(profile)
    settings = get_settings()
    if not settings.replicate_api_token:
        return _fallback_plan(profile, evidence, risk_flags)

    evidence_text = "\n\n".join(
        f"[F{index}] Fonte: {doc.title} ({doc.source or 'sem fonte'})\nTrecho: {doc.body[:1200]}"
        for index, doc in enumerate(evidence, start=1)
    )
    messages = [
        {
            "role": "system",
            "content": (
                "Voce e um assistente de apoio a nutricionistas. Gere apenas um rascunho educativo, "
                "sem diagnosticar, prescrever tratamento clinico ou substituir atendimento profissional. "
                "Use somente os dados fornecidos e os documentos recuperados. Quando houver patologia "
                "ou risco, recomende revisao profissional. Toda afirmacao baseada em documento deve "
                "citar o identificador da fonte, como [F1] ou [F2]. Se nao houver fonte suficiente, diga isso."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Perfil estruturado:\n{profile.model_dump_json(indent=2)}\n\n"
                f"Evidencias recuperadas:\n{evidence_text}\n\n"
                "Gere um plano alimentar preliminar em JSON com: resumo, alertas, estrategia_calorica, "
                "macros_qualitativos, refeicoes, lista_compras_economica, substituicoes_baratas, "
                "perguntas_para_nutricionista, limites_do_plano e citacoes_usadas. "
                "Em citacoes_usadas, liste os ids [F1], [F2] usados e uma frase curta explicando o uso."
            ),
        },
    ]
    os.environ["REPLICATE_API_TOKEN"] = settings.replicate_api_token.strip()
    output = replicate.run(
        settings.replicate_chat_model,
        input={
            "messages": messages,
            "temperature": 0.2,
            "max_completion_tokens": settings.replicate_max_completion_tokens,
        },
    )
    content = "".join(output) if isinstance(output, list) else str(output)
    return {
        "format": "draft_text",
        "provider": "replicate",
        "model": settings.replicate_chat_model,
        "content": content,
        "bmi": profile.bmi,
        "waist_hip_ratio": profile.waist_hip_ratio,
        "risk_flags": risk_flags,
        "evidence": [_evidence_payload(index, doc) for index, doc in enumerate(evidence, start=1)],
        "requires_professional_review": bool(risk_flags),
    }


def generate_professional_recommendation(
    topic: str,
    question: str,
    evidence: list[EvidenceDocument],
) -> dict[str, Any]:
    settings = get_settings()
    evidence_payload = [_evidence_payload(index, doc) for index, doc in enumerate(evidence, start=1)]
    if not settings.replicate_api_token:
        return {
            "format": "structured_fallback",
            "topic": topic,
            "question": question,
            "answer": (
                "Nao ha token da LLM configurado. Revise os trechos recuperados e use-os como base "
                "para uma recomendacao profissional."
            ),
            "evidence": evidence_payload,
        }

    evidence_text = "\n\n".join(
        f"[F{index}] Fonte: {doc.title} ({doc.source or 'sem fonte'})\nTrecho: {doc.body[:1400]}"
        for index, doc in enumerate(evidence, start=1)
    )
    messages = [
        {
            "role": "system",
            "content": (
                "Voce e um assistente para profissionais de nutricao. Seu foco e sintetizar "
                "recomendacoes praticas baseadas em documentos recuperados, para economizar tempo "
                "do profissional. Nao monte plano alimentar individual aqui. Nao invente condutas. "
                "Toda recomendacao baseada em documento deve citar [F1], [F2] etc. Se a evidencia "
                "recuperada nao cobrir o tema, diga que a base atual e insuficiente."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Tema: {topic}\n"
                f"Pergunta do profissional: {question}\n\n"
                f"Evidencias recuperadas:\n{evidence_text}\n\n"
                "Responda em portugues do Brasil com: resumo objetivo, recomendacoes praticas, "
                "pontos de atencao, quando encaminhar/revisar com equipe multiprofissional, "
                "lacunas da base atual e citacoes usadas."
            ),
        },
    ]
    os.environ["REPLICATE_API_TOKEN"] = settings.replicate_api_token.strip()
    output = replicate.run(
        settings.replicate_chat_model,
        input={
            "messages": messages,
            "temperature": 0.2,
            "max_completion_tokens": settings.replicate_max_completion_tokens,
        },
    )
    content = "".join(output) if isinstance(output, list) else str(output)
    return {
        "format": "professional_recommendation",
        "provider": "replicate",
        "model": settings.replicate_chat_model,
        "topic": topic,
        "question": question,
        "content": content,
        "evidence": evidence_payload,
    }


def _fallback_plan(
    profile: ClientProfile,
    evidence: list[EvidenceDocument],
    risk_flags: list[str],
) -> dict[str, Any]:
    budget_note = {
        "baixo": "priorizar arroz, feijao, ovos, frango, sardinha, aveia, legumes da safra e frutas locais",
        "medio": "combinar alimentos basicos com iogurte natural, carnes magras, tuberculos e maior variedade de frutas",
        "alto": "permitir maior variedade de proteinas, laticinios, oleaginosas e preparos mais convenientes",
    }.get(profile.budget_level.value if profile.budget_level else "baixo")

    return {
        "format": "structured_fallback",
        "summary": "Rascunho educativo gerado sem LLM. Revise com nutricionista antes de executar.",
        "bmi": profile.bmi,
        "waist_hip_ratio": profile.waist_hip_ratio,
        "risk_flags": risk_flags,
        "requires_professional_review": True,
        "strategy": {
            "objective": profile.objective.value if profile.objective else None,
            "budget": profile.budget_level.value if profile.budget_level else None,
            "budget_note": budget_note,
            "meals_per_day": profile.meals_per_day,
        },
        "meal_structure": [
            "Cafe da manha: fonte de proteina + carboidrato rico em fibra + fruta.",
            "Almoco: prato com leguminosa, cereal/tuberculo, proteina, verduras e legumes.",
            "Lanche: opcao simples com fruta, laticinio ou preparacao caseira conforme rotina.",
            "Jantar: repetir a estrutura do almoco ajustando volume e praticidade.",
        ],
        "shopping_focus": budget_note,
        "evidence": [_evidence_payload(index, doc) for index, doc in enumerate(evidence, start=1)],
        "limits": [
            "Nao calcula prescricao calorica individual fechada.",
            "Nao substitui conduta clinica em patologias.",
            "Precisa de revisao profissional para alergias, medicacoes e doencas.",
        ],
    }


def _evidence_payload(index: int, doc: EvidenceDocument) -> dict[str, Any]:
    return {
        "id": f"F{index}",
        "title": doc.title,
        "source": doc.source,
        "similarity": doc.similarity,
        "excerpt": doc.body[:700],
    }
