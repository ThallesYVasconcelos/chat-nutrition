from enum import Enum
from typing import Any, TypedDict

from pydantic import BaseModel, Field


class Objective(str, Enum):
    fat_loss = "perda_de_gordura"
    muscle_gain = "ganho_de_massa"
    maintenance = "manutencao"
    clinical_support = "suporte_clinico"
    performance = "performance"


class BudgetLevel(str, Enum):
    low = "baixo"
    medium = "medio"
    high = "alto"


class ClientProfile(BaseModel):
    name: str | None = None
    age: int | None = Field(default=None, ge=0, le=120)
    sex: str | None = None
    height_cm: float | None = Field(default=None, gt=0, le=260)
    weight_kg: float | None = Field(default=None, gt=0, le=400)
    waist_cm: float | None = Field(default=None, gt=0, le=250)
    hip_cm: float | None = Field(default=None, gt=0, le=250)
    objective: Objective | None = None
    budget_level: BudgetLevel | None = None
    monthly_food_budget_brl: float | None = Field(default=None, ge=0)
    meals_per_day: int | None = Field(default=None, ge=1, le=8)
    routine: str | None = None
    food_preferences: str | None = None
    restrictions: str | None = None
    allergies: str | None = None
    pathology_notes: str | None = None
    medications: str | None = None
    socioeconomic_notes: str | None = None

    @property
    def bmi(self) -> float | None:
        if not self.height_cm or not self.weight_kg:
            return None
        meters = self.height_cm / 100
        return round(self.weight_kg / (meters * meters), 1)

    @property
    def waist_hip_ratio(self) -> float | None:
        if not self.waist_cm or not self.hip_cm:
            return None
        return round(self.waist_cm / self.hip_cm, 2)


class EvidenceDocument(BaseModel):
    title: str
    source: str | None = None
    body: str
    similarity: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConversationState(TypedDict, total=False):
    session_id: str
    profile: dict[str, Any]
    messages: list[dict[str, str]]
    last_user_message: str
    next_question: str
    missing_fields: list[str]
    risk_flags: list[str]
    evidence: list[dict[str, Any]]
    plan: dict[str, Any]
    ready_for_plan: bool
    requires_professional_review: bool
