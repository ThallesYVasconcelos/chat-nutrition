"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type AppUser = { id: string; email: string; full_name: string | null; avatar_url?: string | null };
type Evidence = { id: string; title: string; source: string; excerpt: string; similarity?: number | null };
type ResponseJudge = {
  passed: boolean;
  score: number;
  issues: string[];
  missing: string[];
  recommendation: string;
};
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  evidence?: Evidence[];
  judge?: ResponseJudge;
};
type Client = {
  id: string;
  full_name: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  objective: string | null;
  notes: string | null;
  updated_at?: string;
};
type Observation = { id: string; category: string; note: string; created_at: string };
type Thread = { id: string; title: string; updated_at: string };
type ClientFormValue = {
  fullName: string;
  birthDate: string;
  phone: string;
  email: string;
  objective: string;
  notes: string;
  sex: string;
  weightKg: string;
  heightCm: string;
  waistCm: string;
  hipCm: string;
  socioeconomic: string;
  budget: string;
  mealsPerDay: string;
  routine: string;
  preferences: string;
  restrictions: string;
  allergies: string;
  pathologies: string;
  medications: string;
};

const API_BASE = "";
const STARTER_PROMPTS = [
  "Quero montar um plano alimentar para emagrecimento com orçamento baixo.",
  "Paciente com rotina corrida, poucas refeições e objetivo de ganho de massa.",
  "Preciso organizar uma anamnese alimentar antes de propor o plano.",
  "Paciente com hipertensão: quais dados faltam antes do plano?",
];
const PROFESSIONAL_TOPICS = [
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
];

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function PandaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={compact ? "panda-logo compact" : "panda-logo"}
      viewBox="0 0 96 96"
      aria-hidden="true"
      role="img"
    >
      <g className="panda-breathe">
        <path className="panda-outline" d="M25 81c-7-6-9-17-5-28 3-9 2-18 8-26 5-7 12-11 20-11s15 4 20 11c6 8 5 17 8 26 4 11 2 22-5 28-6 5-14 4-23 4s-17 1-23-4Z" />
        <circle className="panda-ear-svg" cx="30" cy="23" r="12" />
        <circle className="panda-ear-svg" cx="66" cy="23" r="12" />
        <path className="panda-head-svg" d="M22 43c0-18 11-30 26-30s26 12 26 30c0 14-10 24-26 24S22 57 22 43Z" />
        <ellipse className="panda-eye-patch" cx="37" cy="41" rx="9" ry="12" transform="rotate(20 37 41)" />
        <ellipse className="panda-eye-patch" cx="59" cy="41" rx="9" ry="12" transform="rotate(-20 59 41)" />
        <circle className="panda-eye-dot" cx="39" cy="38" r="2.2" />
        <circle className="panda-eye-dot" cx="57" cy="38" r="2.2" />
        <circle className="panda-cheek-svg" cx="30" cy="51" r="4.5" />
        <circle className="panda-cheek-svg" cx="66" cy="51" r="4.5" />
        <path className="panda-nose-svg" d="M44 48c1-3 7-3 8 0 1 4-2 6-4 6s-5-2-4-6Z" />
        <path className="panda-smile-svg" d="M42 55c2 4 10 4 12 0" />
        <path className="panda-body-svg" d="M28 66c2-13 11-20 20-20s18 7 20 20c2 12-7 19-20 19s-22-7-20-19Z" />
        <path className="panda-arm-svg left" d="M28 57c-8 2-12 10-10 17 2 5 9 4 13 0 4-5 5-14-3-17Z" />
        <path className="panda-arm-svg right" d="M68 57c8 2 12 10 10 17-2 5-9 4-13 0-4-5-5-14 3-17Z" />
        <ellipse className="panda-foot-svg" cx="32" cy="82" rx="11" ry="8" transform="rotate(-18 32 82)" />
        <ellipse className="panda-foot-svg" cx="64" cy="82" rx="11" ry="8" transform="rotate(18 64 82)" />
      </g>
      <g className="panda-bamboo">
        <path d="M31 68 52 43" />
        <path d="M37 61 34 56" />
        <path d="M44 53 40 49" />
        <path className="bamboo-leaf" d="M51 43c8-6 15-4 18 1-6 5-13 6-18-1Z" />
        <path className="bamboo-leaf" d="M47 48c-1-8 3-13 9-15 2 7-1 12-9 15Z" />
      </g>
    </svg>
  );
}

function cleanAssistantText(content: string): string {
  return content.replace(/\*\*(.*?)\*\*/g, "$1").trim();
}

function isConsolidatedMealPlan(content: string): boolean {
  const clean = cleanAssistantText(content).toLowerCase();
  const looksLikeQuestion = clean.endsWith("?") && clean.length < 220;
  if (looksLikeQuestion) return false;
  const hasPlanLanguage = /plano alimentar|estrutura alimentar|cardápio|refeiç|café da manhã|almoço|jantar|lista de compras/.test(clean);
  const hasValidationLanguage = /validação profissional|substituiç|alertas|síntese do caso|orçamento/.test(clean);
  return hasPlanLanguage && hasValidationLanguage;
}

function clientToFormValue(client: Client | null): ClientFormValue {
  return {
    fullName: client?.full_name || "",
    birthDate: client?.birth_date || "",
    phone: client?.phone || "",
    email: client?.email || "",
    objective: client?.objective || "",
    notes: client?.notes || "",
    sex: "",
    weightKg: "",
    heightCm: "",
    waistCm: "",
    hipCm: "",
    socioeconomic: "",
    budget: "",
    mealsPerDay: "",
    routine: "",
    preferences: "",
    restrictions: "",
    allergies: "",
    pathologies: "",
    medications: "",
  };
}

function calculateBmi(weightKg: string, heightCm: string): string {
  const weight = Number(weightKg.replace(",", "."));
  const height = Number(heightCm.replace(",", ".")) / 100;
  if (!weight || !height) return "";
  return (weight / (height * height)).toFixed(1).replace(".", ",");
}

function buildPatientPayload(value: ClientFormValue) {
  const bmi = calculateBmi(value.weightKg, value.heightCm);
  const clinicalRows = [
    ["Sexo", value.sex],
    ["Peso", value.weightKg ? `${value.weightKg} kg` : ""],
    ["Altura", value.heightCm ? `${value.heightCm} cm` : ""],
    ["IMC calculado", bmi],
    ["Cintura", value.waistCm ? `${value.waistCm} cm` : ""],
    ["Quadril", value.hipCm ? `${value.hipCm} cm` : ""],
    ["Condição socioeconômica", value.socioeconomic],
    ["Orçamento alimentar", value.budget],
    ["Refeições por dia", value.mealsPerDay],
    ["Rotina", value.routine],
    ["Preferências alimentares", value.preferences],
    ["Restrições", value.restrictions],
    ["Alergias", value.allergies],
    ["Patologias", value.pathologies],
    ["Medicamentos", value.medications],
  ].filter(([, fieldValue]) => fieldValue.trim());

  const structuredNotes = clinicalRows.length
    ? `\n\nDados clínicos estruturados para o chat:\n${clinicalRows.map(([label, fieldValue]) => `- ${label}: ${fieldValue}`).join("\n")}`
    : "";

  return {
    fullName: value.fullName,
    birthDate: value.birthDate,
    phone: value.phone,
    email: value.email,
    objective: value.objective,
    notes: `${value.notes.trim()}${structuredNotes}`.trim(),
  };
}

function patientAgeLabel(client: Client): string {
  if (!client.birth_date) return "Idade não informada";
  const birth = new Date(client.birth_date);
  if (Number.isNaN(birth.getTime())) return "Idade não informada";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? `${age} anos` : "Idade não informada";
}

function patientTags(client: Client): string[] {
  return (client.objective || client.notes || "Sem condição registrada")
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function wrapPdfLine(text: string, width = 88): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function utf16Hex(text: string): string {
  const bytes = [0xfe, 0xff];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function buildPdfBlob(lines: string[]): Blob {
  const pageLines = 42;
  const pages = Array.from({ length: Math.ceil(lines.length / pageLines) || 1 }, (_, index) =>
    lines.slice(index * pageLines, index * pageLines + pageLines)
  );
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const contentIds = pages.map((_, index) => 5 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    const content = [
      "BT",
      "/F1 11 Tf",
      "50 790 Td",
      "15 TL",
      ...page.map((line) => `<${utf16Hex(line)}> Tj T*`),
      "ET",
    ].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    if (!objects[index]) continue;
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index] || 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function downloadMealPlanPdf(input: { patient: Client; content: string; evidence?: Evidence[] }) {
  const date = new Date().toLocaleDateString("pt-BR");
  const bodyLines = cleanAssistantText(input.content)
    .split("\n")
    .flatMap((line) => wrapPdfLine(line));
  const evidenceLines = (input.evidence || []).flatMap((item) => [
    `[${item.id}] ${technicalTitle(item.title)}`,
    ...wrapPdfLine(item.excerpt, 88),
    item.source ? `Fonte: ${item.source}` : "Fonte sem caminho registrado",
    "",
  ]);
  const lines = [
    "Prato Clínico - Plano alimentar aprovado",
    `Cliente: ${input.patient.full_name}`,
    `Objetivo: ${input.patient.objective || "não definido"}`,
    `Data: ${date}`,
    "",
    "Plano alimentar",
    "",
    ...bodyLines,
    "",
    "Fontes e trechos usados",
    "",
    ...(evidenceLines.length ? evidenceLines : ["Nenhuma fonte vinculada a esta resposta."]),
  ];
  const blob = buildPdfBlob(lines);
  const link = document.createElement("a");
  const filename = `plano-alimentar-${input.patient.full_name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.pdf`;
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const error = new Error(
      typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error: string }).error)
        : text || "request_failed"
    ) as Error & { payload?: unknown; status?: number };
    error.payload = parsed;
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

export default function Page() {
  const supabase = useMemo(getSupabaseClient, []);
  const [accessToken, setAccessToken] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState("");

  const [view, setView] = useState<"dashboard" | "plan" | "recommendations" | "patients">("dashboard");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientTab, setClientTab] = useState<"chat" | "record" | "notes">("chat");
  const [observations, setObservations] = useState<Observation[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sourcePanel, setSourcePanel] = useState<Evidence[] | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [professionalTopic, setProfessionalTopic] = useState("Patologias");
  const [professionalInput, setProfessionalInput] = useState("");
  const [professionalMessages, setProfessionalMessages] = useState<ChatMessage[]>([]);
  const [isProfessionalSending, setIsProfessionalSending] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);

  const [newClient, setNewClient] = useState<ClientFormValue>(clientToFormValue(null));
  const [editClient, setEditClient] = useState<ClientFormValue>(clientToFormValue(null));

  const selectedClient = clients.find((client) => client.id === selectedClientId) || null;
  const filteredClients = clients.filter((client) =>
    [client.full_name, client.email || "", client.objective || "", client.notes || ""]
      .join(" ")
      .toLowerCase()
      .includes(patientSearch.toLowerCase())
  );

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAccessToken(data.session?.access_token || "");
      setAuthEmail(data.session?.user?.email || "");
    });
    const subscription = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token || "");
      setAuthEmail(session?.user?.email || "");
    });
    return () => subscription.data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!accessToken) return;
    refreshWorkspace(accessToken).catch(() => void 0);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !selectedClientId) return;
    loadClientContext(selectedClientId).catch(() => void 0);
  }, [accessToken, selectedClientId]);

  useEffect(() => {
    if (!accessToken || !threadId) return;
    api<{ messages: ChatMessage[] }>(`/api/threads/${threadId}/messages`, accessToken)
      .then((data) => setMessages(data.messages))
      .catch(() => setMessages([]));
  }, [accessToken, threadId]);

  useEffect(() => {
    setEditClient(clientToFormValue(selectedClient));
  }, [selectedClientId, selectedClient?.updated_at]);

  async function refreshWorkspace(token: string) {
    try {
      const [sync, clientData] = await Promise.all([
        api<{ user: AppUser }>("/api/auth/sync", token),
        api<{ patients: Client[] }>("/api/patients", token),
      ]);
      setAuthError("");
      setAppUser(sync.user);
      setClients(clientData.patients);
      if (selectedClientId && !clientData.patients.some((client) => client.id === selectedClientId)) {
        setSelectedClientId(clientData.patients[0]?.id || "");
      } else if (!selectedClientId && clientData.patients[0]) {
        setSelectedClientId(clientData.patients[0].id);
      }
    } catch (error) {
      const e = error as Error & { payload?: unknown; status?: number };
      const debug =
        typeof e.payload === "object" && e.payload && "debug" in e.payload
          ? JSON.stringify((e.payload as { debug: unknown }).debug, null, 2)
          : "";
      setAuthError(
        `Não foi possível concluir o acesso.\nStatus: ${e.status || "?"}\nDetalhe: ${e.message}${
          debug ? `\n\nDebug:\n${debug}` : ""
        }`
      );
      setAppUser(null);
    }
  }

  async function loadClientContext(clientId: string) {
    if (!accessToken) return;
    const [obs, threadData] = await Promise.all([
      api<{ observations: Observation[] }>(`/api/patients/${clientId}/observations`, accessToken),
      api<{ threads: Thread[] }>(`/api/patients/${clientId}/threads`, accessToken),
    ]);
    setObservations(obs.observations);
    setThreads(threadData.threads);
    if (!threadId && threadData.threads[0]) {
      setThreadId(threadData.threads[0].id);
    }
    if (!threadData.threads[0]) {
      setMessages([]);
    }
  }

  async function loginWithGoogle() {
    if (!supabase) return;
    setAuthError("");
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAppUser(null);
    setAccessToken("");
    setMessages([]);
  }

  async function createClient() {
    if (!accessToken || !newClient.fullName.trim()) return;
    const created = await api<{ patientId: string }>("/api/patients", accessToken, {
      method: "POST",
      body: JSON.stringify(buildPatientPayload(newClient)),
    });
    setNewClient(clientToFormValue(null));
    await refreshWorkspace(accessToken);
    setSelectedClientId(created.patientId);
    setThreadId("");
    setMessages([]);
    setClientTab("chat");
    setShowNewPatientModal(false);
    setView("plan");
  }

  async function updateClient() {
    if (!accessToken || !selectedClientId || !editClient.fullName.trim()) return;
    await api(`/api/patients/${selectedClientId}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify(buildPatientPayload(editClient)),
    });
    await refreshWorkspace(accessToken);
    setClientTab("record");
  }

  async function deleteClient() {
    if (!accessToken || !selectedClient) return;
    const confirmed = window.confirm(`Excluir ${selectedClient.full_name} e as conversas vinculadas a este cliente?`);
    if (!confirmed) return;
    await api(`/api/patients/${selectedClient.id}`, accessToken, {
      method: "DELETE",
    });
    setSelectedClientId("");
    setThreadId("");
    setMessages([]);
    setObservations([]);
    setThreads([]);
    await refreshWorkspace(accessToken);
    setView("patients");
  }

  async function addObservation() {
    if (!accessToken || !selectedClientId) return;
    const category = (document.getElementById("obs-category") as HTMLSelectElement).value;
    const note = (document.getElementById("obs-note") as HTMLTextAreaElement).value;
    if (!note.trim()) return;
    await api(`/api/patients/${selectedClientId}/observations`, accessToken, {
      method: "POST",
      body: JSON.stringify({ category, note }),
    });
    (document.getElementById("obs-note") as HTMLTextAreaElement).value = "";
    await loadClientContext(selectedClientId);
  }

  async function sendPlanMessage(value?: string) {
    const text = (value || chatInput).trim();
    if (!accessToken || !selectedClientId || !text || isSending) return;

    setIsSending(true);
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const data = await api<{ threadId: string; answer: string; evidence?: Evidence[]; judge?: ResponseJudge }>(
        `/api/patients/${selectedClientId}/threads`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({ message: text, threadId: threadId || null }),
        }
      );
      setThreadId(data.threadId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, evidence: data.evidence || [], judge: data.judge },
      ]);
      await loadClientContext(selectedClientId);
    } finally {
      setIsSending(false);
    }
  }

  async function sendProfessionalQuestion(value?: string) {
    const text = (value || professionalInput).trim();
    if (!accessToken || !text || isProfessionalSending) return;

    setIsProfessionalSending(true);
    setProfessionalInput("");
    setProfessionalMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const data = await api<{ answer: string; evidence: Evidence[]; judge?: ResponseJudge }>("/api/recommendations", accessToken, {
        method: "POST",
        body: JSON.stringify({ topic: professionalTopic, question: text }),
      });
      setProfessionalMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, evidence: data.evidence || [], judge: data.judge },
      ]);
    } finally {
      setIsProfessionalSending(false);
    }
  }

  if (!supabase) {
    return (
      <main className="setup-screen">
        <h1>Configuração pendente</h1>
        <p>Defina as variáveis públicas do Supabase no ambiente.</p>
      </main>
    );
  }

  if (!accessToken || !appUser) {
    return (
      <main className="auth-shell">
        <section className="login-panel">
          <div className="brand-mark">
            <PandaLogo />
            <span>Prato Clínico</span>
          </div>
          <p className="login-kicker">Planejamento alimentar com raciocínio clínico</p>
          <h1>Conduza a conversa, organize o caso e gere um plano revisável.</h1>
          <p className="login-copy">
            Uma ferramenta simples para nutricionistas brasileiros coletarem dados, consultarem evidências e estruturarem recomendações com mais segurança.
          </p>
          <button className="google-button" onClick={loginWithGoogle}>
            Entrar com Google
          </button>
          {authError && <pre className="auth-alert">{authError}</pre>}
        </section>
      </main>
    );
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-brand">
          <PandaLogo compact />
          <div>
            <div className="brand">Prato Clínico</div>
            <p>Sistema de Nutrição</p>
          </div>
        </div>

        <nav className="topnav">
          <button className={view === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => setView("dashboard")}>
            Dashboard
          </button>
          <button
            className={view === "patients" || view === "plan" ? "nav-item active" : "nav-item"}
            onClick={() => setView("patients")}
          >
            Pacientes
          </button>
          <button
            className={view === "recommendations" ? "nav-item active" : "nav-item"}
            onClick={() => setView("recommendations")}
          >
            Recomendações
          </button>
        </nav>

        <div className="topbar-user">
          {appUser.avatar_url ? (
            <img className="profile-photo" src={appUser.avatar_url} alt="Foto do perfil" referrerPolicy="no-referrer" />
          ) : (
            <div className="profile-fallback">{(appUser.full_name || authEmail || "P").slice(0, 1).toUpperCase()}</div>
          )}
          <button className="icon-button" onClick={logout} title="Sair da conta">
            Sair
          </button>
        </div>
      </header>

      <main className="main-area">
        {view === "dashboard" && (
          <section className="dashboard-view">
            <header className="page-header">
              <div>
                <p className="eyebrow">Visão geral</p>
                <h1>Rotina clínica em um só lugar</h1>
                <p>Acompanhe pacientes recentes e continue rapidamente o chat de plano alimentar.</p>
              </div>
              <button className="primary-action" onClick={() => setShowNewPatientModal(true)}>
                Novo paciente
              </button>
            </header>

            <section className="dashboard-panel">
              <div className="panel-title">
                <h2>Pacientes recentes</h2>
                <button className="text-action" onClick={() => setView("patients")}>
                  Ver todos
                </button>
              </div>
              <div className="recent-list">
                {clients.slice(0, 5).map((client) => (
                  <button
                    key={client.id}
                    className="recent-row"
                    onClick={() => {
                      setSelectedClientId(client.id);
                      setThreadId("");
                      setMessages([]);
                      setView("plan");
                    }}
                  >
                    <span className="avatar-dot">{client.full_name.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{client.full_name}</strong>
                      <small>
                        {patientAgeLabel(client)} · {client.objective || "Objetivo não definido"}
                      </small>
                    </span>
                    <span className="row-icon">Chat</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="dashboard-panel">
              <div className="panel-title">
                <h2>Atividade recente</h2>
                <button className="text-action" onClick={() => setView("recommendations")}>
                  Recomendações
                </button>
              </div>
              <div className="recent-list">
                {clients.slice(0, 3).map((client) => (
                  <div key={client.id} className="activity-row">
                    <span className="activity-icon">Chat</span>
                    <span>
                      <strong>{client.full_name}</strong>
                      <small>{client.notes || "Continue a coleta pelo chat ping-pong."}</small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </section>
        )}

        {view === "plan" && (
          <section className="planner-view">
            <header className="page-header">
              <div>
                <p className="eyebrow">Chat ping-pong</p>
                <h1>Plano alimentar para cliente</h1>
                <p>
                  O assistente coleta uma informação por vez, identifica lacunas e só consolida o plano quando houver contexto suficiente.
                </p>
              </div>
              {selectedClient && (
                <div className="client-summary">
                  <span>Cliente ativo</span>
                  <strong>{selectedClient.full_name}</strong>
                  <small>{selectedClient.objective || "Sem objetivo registrado"}</small>
                </div>
              )}
            </header>

            {!selectedClient ? (
              <EmptyClientState onCreate={() => setView("patients")} />
            ) : (
              <div className="chat-layout">
                <div className="chat-main">
                  <div className="message-list">
                    {messages.length === 0 && (
                      <div className="empty-chat">
                        <h2>Comece pela primeira pergunta clínica.</h2>
                        <p>Use um atalho ou descreva o caso. A IA deve perguntar o próximo dado faltante antes de fechar o plano.</p>
                        <div className="starter-grid">
                          {STARTER_PROMPTS.map((prompt) => (
                            <button key={prompt} onClick={() => sendPlanMessage(prompt)}>
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {messages.map((message, index) => (
                      <article key={index} className={message.role === "user" ? "message user" : "message assistant"}>
                        <div className="message-label">{message.role === "user" ? "Profissional" : "Prato Clínico"}</div>
                        <div className="message-content">{cleanAssistantText(message.content)}</div>
                        {message.role === "assistant" && message.judge && <JudgeBadge judge={message.judge} />}
                        {message.role === "assistant" && message.evidence && message.evidence.length > 0 && (
                          <button className="source-button" onClick={() => setSourcePanel(message.evidence || [])}>
                            Ver fontes usadas
                          </button>
                        )}
                        {message.role === "assistant" && selectedClient && isConsolidatedMealPlan(message.content) && (
                          <button
                            className="source-button approve"
                            onClick={() =>
                              downloadMealPlanPdf({
                                patient: selectedClient,
                                content: message.content,
                                evidence: message.evidence || [],
                              })
                            }
                          >
                            Aprovar e baixar PDF
                          </button>
                        )}
                      </article>
                    ))}
                  </div>

                  <div className="composer">
                    <textarea
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="Responda a pergunta atual ou descreva o próximo dado do cliente..."
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendPlanMessage().catch(() => void 0);
                        }
                      }}
                    />
                    <button onClick={() => sendPlanMessage().catch(() => void 0)} disabled={isSending}>
                      {isSending ? "Analisando..." : "Enviar"}
                    </button>
                  </div>
                </div>

                <aside className="context-panel">
                  <h2>Dados do cliente</h2>
                  <dl>
                    <div>
                      <dt>Objetivo</dt>
                      <dd>{selectedClient.objective || "Não definido"}</dd>
                    </div>
                    <div>
                      <dt>Nascimento</dt>
                      <dd>{selectedClient.birth_date || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Resumo</dt>
                      <dd>{selectedClient.notes || "Sem resumo clínico inicial."}</dd>
                    </div>
                  </dl>
                </aside>
              </div>
            )}
          </section>
        )}

        {view === "recommendations" && (
          <section className="recommendations-view">
            <div className="recommendation-shell">
              <aside className="topic-panel">
                <h2>Tema</h2>
                <div className="topic-list">
                  {PROFESSIONAL_TOPICS.map((topic) => (
                    <button
                      key={topic}
                      className={professionalTopic === topic ? "topic-item active" : "topic-item"}
                      onClick={() => setProfessionalTopic(topic)}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
                <div className="permission-panel">
                  <h3>Escopo da resposta</h3>
                  <button className="permission-item active">Usar documentos oficiais</button>
                  <button className="permission-item active">Mostrar trechos rastreáveis</button>
                  <button className="permission-item">Sinalizar lacunas clínicas</button>
                </div>
              </aside>

              <div className="chat-main">
                <div className="message-list">
                  {professionalMessages.length === 0 && (
                    <div className="empty-chat">
                      <h2>Use como consulta rápida de apoio profissional.</h2>
                      <p>
                        Pergunte sobre patologias, gestantes, infância, nutrição comportamental ou critérios de avaliação. As fontes aparecem dentro da resposta.
                      </p>
                      <div className="starter-grid">
                        <button onClick={() => sendProfessionalQuestion("Quais pontos devo revisar antes de orientar um paciente com diabetes tipo 2?")}>
                          Diabetes tipo 2: pontos de atenção
                        </button>
                        <button onClick={() => sendProfessionalQuestion("Quais cuidados alimentares gerais são relevantes para hipertensão?")}>
                          Hipertensão: cuidados gerais
                        </button>
                        <button onClick={() => sendProfessionalQuestion("Como estruturar orientação alimentar sem reforçar culpa alimentar?")}>
                          Nutrição comportamental
                        </button>
                        <button onClick={() => sendProfessionalQuestion("Quais dados faltam antes de pensar em plano para gestante?")}>
                          Gestantes: dados essenciais
                        </button>
                      </div>
                    </div>
                  )}

                  {professionalMessages.map((message, index) => (
                    <article key={index} className={message.role === "user" ? "message user" : "message assistant"}>
                      <div className="message-label">{message.role === "user" ? "Profissional" : "Prato Clínico"}</div>
                      <div className="message-content">{cleanAssistantText(message.content)}</div>
                      {message.role === "assistant" && message.judge && <JudgeBadge judge={message.judge} />}
                      {message.role === "assistant" && message.evidence && message.evidence.length > 0 && (
                        <button className="source-button" onClick={() => setSourcePanel(message.evidence || [])}>
                          Ver fontes usadas
                        </button>
                      )}
                    </article>
                  ))}
                </div>

                <div className="composer">
                  <textarea
                    value={professionalInput}
                    onChange={(event) => setProfessionalInput(event.target.value)}
                    placeholder={`Pergunte sobre ${professionalTopic.toLowerCase()}...`}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendProfessionalQuestion().catch(() => void 0);
                      }
                    }}
                  />
                  <button onClick={() => sendProfessionalQuestion().catch(() => void 0)} disabled={isProfessionalSending}>
                    {isProfessionalSending ? "Buscando..." : "Enviar"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === "patients" && (
          <section className="patients-view">
            <header className="page-header">
              <div>
                <p className="eyebrow">Pacientes</p>
                <h1>Gerenciamento de pacientes</h1>
                <p>Gerencie todos os seus pacientes em um só lugar.</p>
              </div>
              <button className="primary-action" onClick={() => setShowNewPatientModal(true)}>
                Novo paciente
              </button>
            </header>

            <div className="patient-toolbar">
              <input
                value={patientSearch}
                onChange={(event) => setPatientSearch(event.target.value)}
                placeholder="Buscar pacientes por nome, email, objetivo ou condição..."
              />
            </div>

            <div className="patient-grid">
              {filteredClients.map((client) => (
                <article key={client.id} className="patient-card">
                  <div className="patient-head">
                    <span className="patient-avatar">{client.full_name.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <h2>{client.full_name}</h2>
                      <p>{client.email || "Email não informado"}</p>
                      <small>{patientAgeLabel(client)}</small>
                    </div>
                  </div>
                  <div className="tag-row">
                    {patientTags(client).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <p className="patient-note">{client.notes || "Sem observações iniciais registradas."}</p>
                  <div className="patient-actions">
                    <button
                      className="secondary-action"
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setClientTab("record");
                      }}
                    >
                      Perfil
                    </button>
                    <button
                      className="primary-action"
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setThreadId("");
                        setMessages([]);
                        setView("plan");
                      }}
                    >
                      Chat
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {selectedClient && clientTab === "record" && (
              <section className="client-record inline-editor">
                <div className="record-actions">
                  <div>
                    <h2>Editar {selectedClient.full_name}</h2>
                    <p>Atualize os dados usados pelo chat de plano alimentar.</p>
                  </div>
                  <button className="danger-action" onClick={() => deleteClient().catch(() => void 0)}>
                    Excluir cliente
                  </button>
                </div>
                <ClientForm value={editClient} onChange={setEditClient} />
                <div className="form-actions">
                  <button className="primary-action" onClick={() => updateClient().catch(() => void 0)}>
                    Salvar alterações
                  </button>
                  <button className="mini-action" onClick={() => setSelectedClientId("")}>
                    Fechar
                  </button>
                </div>
              </section>
            )}
          </section>
        )}
      </main>

      {showNewPatientModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="patient-modal">
            <header>
              <div>
                <h2>Adicionar novo paciente</h2>
                <p>Preencha os dados essenciais para começar o acompanhamento nutricional.</p>
              </div>
              <button className="icon-button" onClick={() => setShowNewPatientModal(false)}>
                Fechar
              </button>
            </header>
            <ClientForm value={newClient} onChange={setNewClient} />
            <footer>
              <button className="secondary-action" onClick={() => setShowNewPatientModal(false)}>
                Cancelar
              </button>
              <button className="primary-action" onClick={() => createClient().catch(() => void 0)}>
                Adicionar paciente
              </button>
            </footer>
          </section>
        </div>
      )}

      {sourcePanel && (
        <div className="source-drawer" role="dialog" aria-modal="true">
          <div className="source-card">
            <header>
              <div>
                <p className="eyebrow">Rastreabilidade</p>
                <h2>Fontes usadas na resposta</h2>
              </div>
              <button className="icon-button" onClick={() => setSourcePanel(null)}>
                Fechar
              </button>
            </header>
            <div className="source-list">
              {sourcePanel.map((item) => (
                <article key={`${item.id}-${item.title}`}>
                  <strong>
                    [{item.id}] {technicalTitle(item.title)}
                  </strong>
                  <span>{item.source || "Fonte sem caminho registrado"}</span>
                  <p>{item.excerpt}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyClientState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-state">
      <h2>Selecione ou cadastre um cliente.</h2>
      <p>O plano alimentar é construído a partir do contexto individual do cliente e das respostas do chat guiado.</p>
      <button className="primary-action" onClick={onCreate}>
        Cadastrar cliente
      </button>
    </div>
  );
}

function JudgeBadge({ judge }: { judge: ResponseJudge }) {
  const normalizedScore = judge.score > 1 && judge.score <= 10 ? judge.score / 10 : judge.score > 10 ? judge.score / 100 : judge.score;
  const score = Math.round(Math.max(0, Math.min(1, normalizedScore)) * 100);
  return (
    <div className={judge.passed ? "judge-badge passed" : "judge-badge warning"}>
      <strong>{judge.passed ? "Resposta completa" : "Revisar resposta"} · {score}%</strong>
      {!judge.passed && (
        <span>
          {[...judge.issues, ...judge.missing.map((item) => `Falta: ${item}`)]
            .filter(Boolean)
            .slice(0, 3)
            .join(" · ") || judge.recommendation}
        </span>
      )}
    </div>
  );
}

function ClientForm({
  value,
  onChange,
}: {
  value: ClientFormValue;
  onChange: (value: ClientFormValue) => void;
}) {
  const bmi = calculateBmi(value.weightKg, value.heightCm);
  return (
    <div className="client-form">
      <label>
        Nome completo
        <input value={value.fullName} onChange={(event) => onChange({ ...value, fullName: event.target.value })} />
      </label>
      <label>
        Nascimento
        <input placeholder="AAAA-MM-DD" value={value.birthDate} onChange={(event) => onChange({ ...value, birthDate: event.target.value })} />
      </label>
      <label>
        Telefone
        <input value={value.phone} onChange={(event) => onChange({ ...value, phone: event.target.value })} />
      </label>
      <label>
        Email
        <input value={value.email} onChange={(event) => onChange({ ...value, email: event.target.value })} />
      </label>
      <label>
        Objetivo principal
        <input value={value.objective} onChange={(event) => onChange({ ...value, objective: event.target.value })} />
      </label>
      <label className="wide">
        Resumo inicial
        <textarea value={value.notes} onChange={(event) => onChange({ ...value, notes: event.target.value })} />
      </label>
      <div className="form-section-title">
        <strong>Mais informações para o chat</strong>
        <span>Esses dados entram no contexto e evitam perguntas repetidas.</span>
      </div>
      <label>
        Sexo
        <select value={value.sex} onChange={(event) => onChange({ ...value, sex: event.target.value })}>
          <option value="">Não informado</option>
          <option value="feminino">Feminino</option>
          <option value="masculino">Masculino</option>
          <option value="outro">Outro</option>
        </select>
      </label>
      <label>
        Peso
        <input placeholder="kg" value={value.weightKg} onChange={(event) => onChange({ ...value, weightKg: event.target.value })} />
      </label>
      <label>
        Altura
        <input placeholder="cm" value={value.heightCm} onChange={(event) => onChange({ ...value, heightCm: event.target.value })} />
      </label>
      <label>
        IMC
        <input value={bmi || "Preencha peso e altura"} readOnly />
      </label>
      <label>
        Cintura
        <input placeholder="cm" value={value.waistCm} onChange={(event) => onChange({ ...value, waistCm: event.target.value })} />
      </label>
      <label>
        Quadril
        <input placeholder="cm" value={value.hipCm} onChange={(event) => onChange({ ...value, hipCm: event.target.value })} />
      </label>
      <label>
        Condição socioeconômica
        <input value={value.socioeconomic} onChange={(event) => onChange({ ...value, socioeconomic: event.target.value })} />
      </label>
      <label>
        Orçamento alimentar
        <input placeholder="Ex.: baixo, R$ 150/semana" value={value.budget} onChange={(event) => onChange({ ...value, budget: event.target.value })} />
      </label>
      <label>
        Refeições por dia
        <input value={value.mealsPerDay} onChange={(event) => onChange({ ...value, mealsPerDay: event.target.value })} />
      </label>
      <label>
        Rotina
        <input value={value.routine} onChange={(event) => onChange({ ...value, routine: event.target.value })} />
      </label>
      <label className="wide">
        Preferências alimentares
        <input value={value.preferences} onChange={(event) => onChange({ ...value, preferences: event.target.value })} />
      </label>
      <label className="wide">
        Restrições e aversões
        <input value={value.restrictions} onChange={(event) => onChange({ ...value, restrictions: event.target.value })} />
      </label>
      <label className="wide">
        Alergias
        <input value={value.allergies} onChange={(event) => onChange({ ...value, allergies: event.target.value })} />
      </label>
      <label className="wide">
        Patologias
        <input value={value.pathologies} onChange={(event) => onChange({ ...value, pathologies: event.target.value })} />
      </label>
      <label className="wide">
        Medicamentos
        <input value={value.medications} onChange={(event) => onChange({ ...value, medications: event.target.value })} />
      </label>
    </div>
  );
}

function ClientDetails({ client }: { client: Client }) {
  return (
    <dl className="details-grid">
      <div>
        <dt>Nome</dt>
        <dd>{client.full_name}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>{client.email || "Não informado"}</dd>
      </div>
      <div>
        <dt>Telefone</dt>
        <dd>{client.phone || "Não informado"}</dd>
      </div>
      <div>
        <dt>Objetivo</dt>
        <dd>{client.objective || "Não definido"}</dd>
      </div>
      <div className="wide">
        <dt>Resumo</dt>
        <dd>{client.notes || "Sem resumo registrado."}</dd>
      </div>
    </dl>
  );
}

function technicalTitle(title: string): string {
  const clean = title.replace(/_/g, " ").replace(/\s+\(1\)$/g, "").trim();
  const titles: Record<string, string> = {
    guia_alimentar_populacao_brasileira_2ed: "Guia Alimentar para a População Brasileira",
    guia_da_crianca_2019: "Guia Alimentar para Crianças Brasileiras Menores de 2 Anos",
    protocolo_sisvan: "SISVAN: protocolos de vigilância alimentar e nutricional",
    PCDT_DoencaCeliaca: "PCDT: doença celíaca",
    "PCDT DM2_17.04.2024_MSM": "PCDT: diabetes mellitus tipo 2",
  };
  return titles[title] || titles[clean] || clean;
}
