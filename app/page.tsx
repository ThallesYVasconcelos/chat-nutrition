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

function cleanAssistantText(content: string): string {
  return content.replace(/\*\*(.*?)\*\*/g, "$1").trim();
}

function clientToFormValue(client: Client | null): ClientFormValue {
  return {
    fullName: client?.full_name || "",
    birthDate: client?.birth_date || "",
    phone: client?.phone || "",
    email: client?.email || "",
    objective: client?.objective || "",
    notes: client?.notes || "",
  };
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

  const [view, setView] = useState<"plan" | "recommendations" | "clients">("plan");
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

  const [newClient, setNewClient] = useState<ClientFormValue>({
    fullName: "",
    birthDate: "",
    phone: "",
    email: "",
    objective: "",
    notes: "",
  });
  const [editClient, setEditClient] = useState<ClientFormValue>(clientToFormValue(null));

  const selectedClient = clients.find((client) => client.id === selectedClientId) || null;

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
      body: JSON.stringify(newClient),
    });
    setNewClient({ fullName: "", birthDate: "", phone: "", email: "", objective: "", notes: "" });
    await refreshWorkspace(accessToken);
    setSelectedClientId(created.patientId);
    setThreadId("");
    setMessages([]);
    setClientTab("chat");
    setView("plan");
  }

  async function updateClient() {
    if (!accessToken || !selectedClientId || !editClient.fullName.trim()) return;
    await api(`/api/patients/${selectedClientId}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify(editClient),
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
    setView("clients");
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
          <div className="brand-mark">Prato Clínico</div>
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
      <aside className="sidebar">
        <div className="side-head">
          <div className="profile-block">
            {appUser.avatar_url ? (
              <img className="profile-photo" src={appUser.avatar_url} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="profile-fallback">{(appUser.full_name || authEmail || "P").slice(0, 1).toUpperCase()}</div>
            )}
            <div>
              <div className="brand">Prato Clínico</div>
              <p>{appUser.full_name || authEmail}</p>
            </div>
          </div>
          <button className="icon-button" onClick={logout} title="Sair da conta">
            Sair
          </button>
        </div>

        <nav className="nav-list">
          <button className={view === "plan" ? "nav-item active" : "nav-item"} onClick={() => setView("plan")}>
            Plano alimentar guiado
          </button>
          <button
            className={view === "recommendations" ? "nav-item active" : "nav-item"}
            onClick={() => setView("recommendations")}
          >
            Recomendações profissionais
          </button>
          <button className={view === "clients" ? "nav-item active" : "nav-item"} onClick={() => setView("clients")}>
            Clientes
          </button>
        </nav>

        <div className="sidebar-section">
          <div className="section-row">
            <span>Clientes</span>
            <button
              className="mini-action"
              onClick={() => {
                setSelectedClientId("");
                setView("clients");
              }}
            >
              Novo
            </button>
          </div>
          <div className="client-list">
            {clients.map((client) => (
              <button
                key={client.id}
                className={selectedClientId === client.id ? "client-item active" : "client-item"}
                onClick={() => {
                  setSelectedClientId(client.id);
                  setThreadId("");
                  setMessages([]);
                  setView("plan");
                }}
              >
                <strong>{client.full_name}</strong>
                <span>{client.objective || "Objetivo não definido"}</span>
              </button>
            ))}
          </div>
        </div>

        {threads.length > 0 && (
          <div className="sidebar-section">
            <div className="section-row">
              <span>Conversas do cliente</span>
            </div>
            <div className="client-list">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  className={thread.id === threadId ? "thread-item active" : "thread-item"}
                  onClick={() => setThreadId(thread.id)}
                >
                  {thread.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <main className="main-area">
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
              <EmptyClientState onCreate={() => setView("clients")} />
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
                        {message.role === "assistant" && selectedClient && (
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
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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
            <header className="page-header">
              <div>
                <p className="eyebrow">Apoio técnico</p>
                <h1>Recomendações para profissionais</h1>
                <p>
                  Consulte a base documental para revisar condutas, critérios, alertas e pontos de atenção antes de atender ou orientar um cliente.
                </p>
              </div>
            </header>

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
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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

        {view === "clients" && (
          <section className="clients-view">
            <header className="page-header compact">
              <div>
                <p className="eyebrow">Cadastro clínico</p>
                <h1>{selectedClient ? selectedClient.full_name : "Novo cliente"}</h1>
              </div>
            </header>

            {!selectedClient ? (
              <section className="form-card">
                <ClientForm value={newClient} onChange={setNewClient} />
                <button className="primary-action" onClick={() => createClient().catch(() => void 0)}>
                  Cadastrar cliente
                </button>
              </section>
            ) : (
              <section className="client-record">
                <div className="segmented">
                  <button className={clientTab === "chat" ? "active" : ""} onClick={() => setClientTab("chat")}>
                    Chat do plano
                  </button>
                  <button className={clientTab === "record" ? "active" : ""} onClick={() => setClientTab("record")}>
                    Dados
                  </button>
                  <button className={clientTab === "notes" ? "active" : ""} onClick={() => setClientTab("notes")}>
                    Observações
                  </button>
                </div>

                {clientTab === "chat" && (
                  <div className="record-panel">
                    <p>Abra o chat guiado para continuar a coleta e construção do plano alimentar.</p>
                    <button className="primary-action" onClick={() => setView("plan")}>
                      Continuar plano alimentar
                    </button>
                  </div>
                )}

                {clientTab === "record" && (
                  <div className="record-panel">
                    <div className="record-actions">
                      <div>
                        <h2>Dados do cliente</h2>
                        <p>Edite as informações que orientam o chat ping-pong e os planos gerados.</p>
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
                      <button className="mini-action" onClick={() => setEditClient(clientToFormValue(selectedClient))}>
                        Desfazer
                      </button>
                    </div>
                  </div>
                )}

                {clientTab === "notes" && (
                  <div className="record-panel">
                    <div className="note-form">
                      <select id="obs-category">
                        <option value="consulta">Consulta</option>
                        <option value="evolucao">Evolução</option>
                        <option value="conduta">Conduta</option>
                        <option value="exame">Exame</option>
                      </select>
                      <textarea id="obs-note" placeholder="Registre uma observação objetiva..." />
                      <button className="primary-action" onClick={() => addObservation().catch(() => void 0)}>
                        Adicionar observação
                      </button>
                    </div>
                    <div className="notes-list">
                      {observations.map((obs) => (
                        <article key={obs.id}>
                          <strong>{obs.category}</strong>
                          <p>{obs.note}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </section>
        )}
      </main>

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
  const score = Math.round(judge.score * 100);
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
