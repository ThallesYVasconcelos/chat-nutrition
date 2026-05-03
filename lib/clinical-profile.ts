export type ClinicalProfile = Record<string, string | undefined> & {
  sex?: string;
  weightKg?: string;
  heightCm?: string;
  bmi?: string;
  waistCm?: string;
  hipCm?: string;
  socioeconomic?: string;
  budget?: string;
  mealsPerDay?: string;
  routine?: string;
  breakfast?: string;
  morningSnack?: string;
  lunch?: string;
  afternoonSnack?: string;
  dinner?: string;
  supper?: string;
  weekendEating?: string;
  restrictions?: string;
  allergies?: string;
  pathologies?: string;
  medications?: string;
};

const noteLabels: Record<keyof ClinicalProfile, string> = {
  sex: "Sexo",
  weightKg: "Peso",
  heightCm: "Altura",
  bmi: "IMC calculado",
  waistCm: "Cintura",
  hipCm: "Quadril",
  socioeconomic: "Condição socioeconômica",
  budget: "Orçamento alimentar",
  mealsPerDay: "Refeições por dia",
  routine: "Rotina",
  breakfast: "Café da manhã",
  morningSnack: "Lanche da manhã",
  lunch: "Almoço",
  afternoonSnack: "Lanche da tarde",
  dinner: "Jantar",
  supper: "Ceia",
  weekendEating: "Fim de semana",
  restrictions: "Restrições",
  allergies: "Alergias",
  pathologies: "Patologias",
  medications: "Medicamentos",
};

export function basePatientNotes(notes: string | null | undefined): string {
  return (notes || "").split(/\n\nDados cl[íi]nicos estruturados para o chat:/i)[0]?.trim() || "";
}

export function structuredFieldFromNotes(notes: string | null | undefined, label: string): string {
  if (!notes) return "";
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = notes.match(new RegExp(`- ${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

export function normalizeClinicalProfile(value: unknown): ClinicalProfile {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const output: ClinicalProfile = {};
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw === "string" && raw.trim()) output[key] = raw.trim();
  }
  for (const key of Object.keys(noteLabels) as Array<keyof ClinicalProfile>) {
    const raw = input[key];
    if (typeof raw === "string" && raw.trim()) output[key] = raw.trim();
  }
  return output;
}

export function profileFromLegacyNotes(notes: string | null | undefined): ClinicalProfile {
  const profile: ClinicalProfile = {};
  for (const key of Object.keys(noteLabels) as Array<keyof ClinicalProfile>) {
    const value = structuredFieldFromNotes(notes, noteLabels[key]);
    if (value) profile[key] = value;
  }
  return profile;
}

export function getClinicalValue(profile: ClinicalProfile | null | undefined, notes: string | null | undefined, key: keyof ClinicalProfile): string {
  return profile?.[key] || profileFromLegacyNotes(notes)[key] || "";
}

export function profileToStructuredNotes(profile: ClinicalProfile): string {
  const rows = (Object.keys(noteLabels) as Array<keyof ClinicalProfile>)
    .map((key) => [noteLabels[key], profile[key]] as const)
    .filter(([, value]) => value?.trim());

  return rows.length
    ? `\n\nDados clínicos estruturados para o chat:\n${rows.map(([label, value]) => `- ${label}: ${value}`).join("\n")}`
    : "";
}
