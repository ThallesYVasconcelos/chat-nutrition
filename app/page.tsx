"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type AppUser = { id: string; email: string; full_name: string | null };
type Patient = {
  id: string;
  full_name: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  objective: string | null;
  notes: string | null;
};
type Observation = { id: string; category: string; note: string; created_at: string };
type Thread = { id: string; title: string; mode?: string; updated_at: string };
type ChatMessage = { role: "user" | "assistant"; content: string; created_at?: string };

const TOPICS = [
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

const API_BASE = "";

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
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
  const [accessToken, setAccessToken] = useState<string>("");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState<string>("");

  const [view, setView] = useState<"recommendations" | "patients" | "documents" | "evidence">(
    "recommendations"
  );
  const [topic, setTopic] = useState("Patologias");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [generalThreads, setGeneralThreads] = useState<Thread[]>([]);
  const [documents, setDocuments] = useState<string[]>([]);
  const [lastEvidence, setLastEvidence] = useState<{ id: string; title: string; source: string; excerpt: string }[]>(
    []
  );

  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [patientTab, setPatientTab] = useState<"record" | "observations" | "chat">("chat");
  const [patientObservations, setPatientObservations] = useState<Observation[]>([]);
  const [patientThreads, setPatientThreads] = useState<Thread[]>([]);
  const [patientMessages, setPatientMessages] = useState<ChatMessage[]>([]);
  const [patientThreadId, setPatientThreadId] = useState<string>("");

  const [newPatient, setNewPatient] = useState({
    fullName: "",
    birthDate: "",
    phone: "",
    email: "",
    objective: "",
    notes: "",
  });

  const selectedPatient = patients.find((p) => p.id === selectedPatientId) || null;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token || "";
      setAccessToken(token);
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
    refreshBaseData(accessToken).catch(() => void 0);
  }, [accessToken]);

  async function refreshBaseData(token: string) {
    try {
      const [sync, p, t] = await Promise.all([
        api<{ user: AppUser }>("/api/auth/sync", token),
        api<{ patients: Patient[] }>("/api/patients", token),
        api<{ threads: Thread[] }>("/api/threads", token),
      ]);
      setAuthError("");
      setAppUser(sync.user);
      setPatients(p.patients);
      setGeneralThreads(t.threads);
      if (!selectedPatientId && p.patients[0]) setSelectedPatientId(p.patients[0].id);
    } catch (error) {
      const e = error as Error & { payload?: unknown; status?: number };
      const debug =
        typeof e.payload === "object" && e.payload && "debug" in e.payload
          ? JSON.stringify((e.payload as { debug: unknown }).debug, null, 2)
          : "";
      setAuthError(
        `Não foi possível concluir o acesso da conta.\nStatus: ${e.status || "?"}\nDetalhe: ${e.message}${
          debug ? `\n\nDebug:\n${debug}` : ""
        }`
      );
      setAppUser(null);
    }
  }

  useEffect(() => {
    if (!accessToken || !selectedPatientId) return;
    api<{ observations: Observation[] }>(`/api/patients/${selectedPatientId}/observations`, accessToken)
      .then((data) => setPatientObservations(data.observations))
      .catch(() => setPatientObservations([]));
    api<{ threads: Thread[] }>(`/api/patients/${selectedPatientId}/threads`, accessToken)
      .then((data) => {
        setPatientThreads(data.threads);
        if (!patientThreadId && data.threads[0]) setPatientThreadId(data.threads[0].id);
      })
      .catch(() => setPatientThreads([]));
  }, [accessToken, selectedPatientId, patientThreadId]);

  useEffect(() => {
    if (!accessToken || !patientThreadId) return;
    api<{ messages: ChatMessage[] }>(`/api/threads/${patientThreadId}/messages`, accessToken)
      .then((data) => setPatientMessages(data.messages))
      .catch(() => setPatientMessages([]));
  }, [accessToken, patientThreadId]);

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
    setPatientMessages([]);
  }

  async function sendRecommendation() {
    if (!question.trim() || !accessToken) return;
    const userMsg = `[${topic}] ${question.trim()}`;
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setQuestion("");
    const data = await api<{ answer: string; evidence: { id: string; title: string; source: string; excerpt: string }[] }>(
      "/api/recommendations",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ topic, question: userMsg }),
      }
    );
    setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    setLastEvidence(data.evidence);
    const threads = await api<{ threads: Thread[] }>("/api/threads", accessToken);
    setGeneralThreads(threads.threads);
  }

  async function createPatient() {
    if (!accessToken || !newPatient.fullName.trim()) return;
    await api("/api/patients", accessToken, {
      method: "POST",
      body: JSON.stringify(newPatient),
    });
    setNewPatient({ fullName: "", birthDate: "", phone: "", email: "", objective: "", notes: "" });
    await refreshBaseData(accessToken);
    setView("patients");
  }

  async function addObservation() {
    if (!accessToken || !selectedPatientId) return;
    const category = (document.getElementById("obs-category") as HTMLSelectElement).value;
    const note = (document.getElementById("obs-note") as HTMLTextAreaElement).value;
    if (!note.trim()) return;
    await api(`/api/patients/${selectedPatientId}/observations`, accessToken, {
      method: "POST",
      body: JSON.stringify({ category, note }),
    });
    (document.getElementById("obs-note") as HTMLTextAreaElement).value = "";
    const data = await api<{ observations: Observation[] }>(`/api/patients/${selectedPatientId}/observations`, accessToken);
    setPatientObservations(data.observations);
  }

  async function sendPatientChat() {
    if (!accessToken || !selectedPatientId) return;
    const input = document.getElementById("patient-chat-input") as HTMLTextAreaElement;
    const message = input.value.trim();
    if (!message) return;
    setPatientMessages((prev) => [...prev, { role: "user", content: message }]);
    input.value = "";
    const data = await api<{ threadId: string; answer: string }>(`/api/patients/${selectedPatientId}/threads`, accessToken, {
      method: "POST",
      body: JSON.stringify({ message, threadId: patientThreadId || null }),
    });
    setPatientThreadId(data.threadId);
    setPatientMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    const threads = await api<{ threads: Thread[] }>(`/api/patients/${selectedPatientId}/threads`, accessToken);
    setPatientThreads(threads.threads);
  }

  async function loadDocuments() {
    if (!accessToken) return;
    const data = await api<{ documents: string[] }>("/api/documents", accessToken);
    setDocuments(data.documents);
  }

  if (!supabase) {
    return (
      <main className="main">
        <h1 className="title">Configuração pendente</h1>
        <p className="muted">Defina `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no ambiente.</p>
      </main>
    );
  }

  if (!accessToken || !appUser) {
    return (
      <main className="auth-wrap">
        <div className="auth-card">
          <section className="auth-hero">
            <div className="panda-logo" aria-hidden="true">
              🐼
            </div>
            <span className="auth-chip">Nutrição baseada em evidências</span>
            <h1 className="auth-title" style={{ marginTop: 14 }}>
              Nutri AI Workspace
            </h1>
            <p style={{ marginTop: 12, lineHeight: 1.5 }}>
              Plataforma clínica para nutricionistas com centralização de pacientes, registro de evolução e recomendações técnicas rastreáveis.
            </p>
          </section>
          <section className="auth-panel">
            <h2 style={{ margin: 0 }}>Acesso profissional</h2>
            <p className="muted" style={{ margin: 0 }}>
              Entre com Google para acessar seu workspace.
            </p>
            <div className="login-action">
              <button className="auth-google-btn" onClick={loginWithGoogle}>
                Entrar com Google
              </button>
              <span className="panda-wave" aria-hidden="true">
                🐼
              </span>
            </div>
            {authError && <div className="auth-alert">{authError}</div>}
          </section>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Nutri AI</div>
        <p className="subtitle">Workspace clínico</p>

        <div className="nav-col">
          <button className={`nav-btn ${view === "recommendations" ? "active" : ""}`} onClick={() => setView("recommendations")}>
            Novo chat
          </button>
          <button className={`nav-btn ${view === "patients" ? "active" : ""}`} onClick={() => setView("patients")}>
            Pacientes
          </button>
          <button
            className={`nav-btn ${view === "documents" ? "active" : ""}`}
            onClick={() => {
              setView("documents");
              loadDocuments().catch(() => void 0);
            }}
          >
            Fontes
          </button>
          <button className={`nav-btn ${view === "evidence" ? "active" : ""}`} onClick={() => setView("evidence")}>
            Evidências
          </button>
        </div>

        <div className="sidebar-section">
          <div className="section-title">Pacientes</div>
          <div className="nav-col">
            {patients.map((p) => (
              <button
                key={p.id}
                className={`tiny-btn ${selectedPatientId === p.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedPatientId(p.id);
                  setPatientThreadId("");
                  setView("patients");
                }}
              >
                {p.full_name}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-title">Conversas gerais</div>
          <div className="nav-col">
            {generalThreads.map((thread) => (
              <button key={thread.id} className="tiny-btn">
                {thread.title}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1 className="title">Nutri AI</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              {authEmail}
            </p>
          </div>
          <button className="danger-btn" onClick={logout}>
            Sair da conta
          </button>
        </div>

        {view === "recommendations" && (
          <div className="content-card">
            <h2 style={{ marginTop: 0 }}>Recomendações para profissionais</h2>
            <div className="tabs">
              {TOPICS.map((t) => (
                <button key={t} className={`tab-btn ${topic === t ? "active" : ""}`} onClick={() => setTopic(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="chat-box">
              {messages.map((message, index) => (
                <div key={index} className={`msg ${message.role}`}>
                  {message.content}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <textarea
                className="textarea"
                placeholder={`Pergunte sobre ${topic}`}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button className="primary" onClick={() => sendRecommendation().catch(() => void 0)} style={{ marginTop: 8 }}>
                Enviar pergunta
              </button>
            </div>
          </div>
        )}

        {view === "patients" && (
          <div className="grid-2">
            {!selectedPatient && (
              <section className="content-card">
                <h2 style={{ marginTop: 0 }}>Novo paciente</h2>
                <label className="label">Nome completo</label>
                <input className="input" value={newPatient.fullName} onChange={(e) => setNewPatient({ ...newPatient, fullName: e.target.value })} />
                <label className="label">Nascimento</label>
                <input className="input" placeholder="AAAA-MM-DD" value={newPatient.birthDate} onChange={(e) => setNewPatient({ ...newPatient, birthDate: e.target.value })} />
                <label className="label">Telefone</label>
                <input className="input" value={newPatient.phone} onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })} />
                <label className="label">Email</label>
                <input className="input" value={newPatient.email} onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })} />
                <label className="label">Objetivo principal</label>
                <input className="input" value={newPatient.objective} onChange={(e) => setNewPatient({ ...newPatient, objective: e.target.value })} />
                <label className="label">Resumo inicial</label>
                <textarea className="textarea" value={newPatient.notes} onChange={(e) => setNewPatient({ ...newPatient, notes: e.target.value })} />
                <button className="primary" onClick={() => createPatient().catch(() => void 0)} style={{ marginTop: 8 }}>
                  Cadastrar paciente
                </button>
              </section>
            )}

            {selectedPatient && (
              <section className="content-card" style={{ gridColumn: "1 / -1" }}>
                <h2 style={{ marginTop: 0 }}>{selectedPatient.full_name}</h2>
                <p className="muted">{selectedPatient.objective || "Sem objetivo registrado"}</p>
                <div className="tabs">
                  <button className={`tab-btn ${patientTab === "record" ? "active" : ""}`} onClick={() => setPatientTab("record")}>
                    Dados
                  </button>
                  <button className={`tab-btn ${patientTab === "observations" ? "active" : ""}`} onClick={() => setPatientTab("observations")}>
                    Observações
                  </button>
                  <button className={`tab-btn ${patientTab === "chat" ? "active" : ""}`} onClick={() => setPatientTab("chat")}>
                    Chat clínico
                  </button>
                </div>

                {patientTab === "record" && (
                  <div className="grid-2">
                    <div>
                      <label className="label">Nome completo</label>
                      <input
                        className="input"
                        value={selectedPatient.full_name}
                        onChange={(e) =>
                          setPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, full_name: e.target.value } : p)))
                        }
                      />
                      <label className="label">Nascimento</label>
                      <input
                        className="input"
                        value={selectedPatient.birth_date || ""}
                        onChange={(e) =>
                          setPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, birth_date: e.target.value } : p)))
                        }
                      />
                      <label className="label">Telefone</label>
                      <input
                        className="input"
                        value={selectedPatient.phone || ""}
                        onChange={(e) =>
                          setPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, phone: e.target.value } : p)))
                        }
                      />
                    </div>
                    <div>
                      <label className="label">Email</label>
                      <input
                        className="input"
                        value={selectedPatient.email || ""}
                        onChange={(e) =>
                          setPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, email: e.target.value } : p)))
                        }
                      />
                      <label className="label">Objetivo</label>
                      <input
                        className="input"
                        value={selectedPatient.objective || ""}
                        onChange={(e) =>
                          setPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, objective: e.target.value } : p)))
                        }
                      />
                      <label className="label">Notas</label>
                      <textarea
                        className="textarea"
                        value={selectedPatient.notes || ""}
                        onChange={(e) =>
                          setPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, notes: e.target.value } : p)))
                        }
                      />
                    </div>
                  </div>
                )}

                {patientTab === "observations" && (
                  <div>
                    <label className="label">Categoria</label>
                    <select id="obs-category" className="select">
                      <option value="consulta">consulta</option>
                      <option value="evolucao">evolução</option>
                      <option value="conduta">conduta</option>
                      <option value="exame">exame</option>
                    </select>
                    <label className="label">Observação</label>
                    <textarea id="obs-note" className="textarea" />
                    <button className="primary" onClick={() => addObservation().catch(() => void 0)} style={{ marginTop: 8 }}>
                      Adicionar observação
                    </button>
                    <div style={{ marginTop: 12 }}>
                      {patientObservations.map((obs) => (
                        <div className="msg" key={obs.id}>
                          <strong>{obs.category}</strong>
                          {"\n"}
                          {obs.note}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {patientTab === "chat" && (
                  <div>
                    <div className="chat-box">
                      {patientMessages.map((message, index) => (
                        <div key={index} className={`msg ${message.role}`}>
                          {message.content}
                        </div>
                      ))}
                    </div>
                    <textarea id="patient-chat-input" className="textarea" placeholder={`Conversar sobre ${selectedPatient.full_name}`} />
                    <button className="primary" onClick={() => sendPatientChat().catch(() => void 0)} style={{ marginTop: 8 }}>
                      Enviar no chat clínico
                    </button>
                  </div>
                )}
              </section>
            )}

            {!selectedPatient && (
              <section className="content-card">
                <h3 style={{ marginTop: 0 }}>Pacientes cadastrados</h3>
                {patients.map((patient) => (
                  <button
                    key={patient.id}
                    className="tiny-btn"
                    style={{ marginBottom: 8 }}
                    onClick={() => {
                      setSelectedPatientId(patient.id);
                      setPatientTab("chat");
                    }}
                  >
                    {patient.full_name}
                  </button>
                ))}
              </section>
            )}
          </div>
        )}

        {view === "documents" && (
          <div className="content-card">
            <h2 style={{ marginTop: 0 }}>Documentos usados pelo RAG</h2>
            <p className="muted">Base técnica disponível para fundamentação das respostas.</p>
            <div className="nav-col">
              {documents.map((doc) => (
                <div key={doc} className="msg">
                  {doc}
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "evidence" && (
          <div className="content-card">
            <h2 style={{ marginTop: 0 }}>Trechos de evidência</h2>
            {lastEvidence.length === 0 && <p className="muted">Ainda não há evidências de uma resposta recente.</p>}
            {lastEvidence.map((item) => (
              <div className="msg" key={item.id}>
                <strong>
                  [{item.id}] {item.title}
                </strong>
                {"\n"}
                <span className="muted">{item.source}</span>
                {"\n\n"}
                {item.excerpt}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
