import Replicate from "replicate";
import { assertServerEnv, env } from "@/lib/env";
import { sql } from "@/lib/db";

export type EvidenceDoc = {
  id: string;
  title: string;
  source: string;
  body: string;
  similarity: number | null;
};

export type ResponseJudge = {
  passed: boolean;
  score: number;
  issues: string[];
  missing: string[];
  recommendation: string;
};

let client: Replicate | null = null;

function getReplicateClient(): Replicate {
  assertServerEnv();
  if (!client) {
    client = new Replicate({ auth: env.replicateApiToken });
  }
  return client;
}

function normalizeTextOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) return output.map((part) => String(part)).join("").trim();
  if (typeof output === "object") return JSON.stringify(output);
  return String(output);
}

function safeParseJudge(text: string): ResponseJudge | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<ResponseJudge>;
    const rawScore = Number(parsed.score || 0);
    const score = rawScore > 1 && rawScore <= 10 ? rawScore / 10 : rawScore > 10 ? rawScore / 100 : rawScore;
    return {
      passed: Boolean(parsed.passed),
      score: Math.max(0, Math.min(1, score)),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
      recommendation: String(parsed.recommendation || ""),
    };
  } catch {
    return null;
  }
}

type ReplicateModelRef = `${string}/${string}` | `${string}/${string}:${string}`;

async function embedQueryWithReplicate(query: string): Promise<number[] | null> {
  try {
    const output = await getReplicateClient().run(env.replicateEmbeddingModel as ReplicateModelRef, {
      input: {
        text: `query: ${query}`,
        normalize: true,
      },
    });

    if (Array.isArray(output) && output.length > 0) {
      const first = output[0] as unknown;
      if (Array.isArray(first)) return first.map((v) => Number(v));
      if (typeof first === "object" && first && "embedding" in first) {
        const emb = (first as { embedding?: unknown }).embedding;
        if (Array.isArray(emb)) return emb.map((v) => Number(v));
      }
    }
    if (typeof output === "object" && output && "embedding" in (output as Record<string, unknown>)) {
      const emb = (output as { embedding?: unknown }).embedding;
      if (Array.isArray(emb)) return emb.map((v) => Number(v));
    }
    return null;
  } catch {
    return null;
  }
}

export async function searchEvidence(query: string): Promise<{ documents: EvidenceDoc[]; usedFallback: boolean }> {
  const embedding = await embedQueryWithReplicate(query);

  if (embedding && embedding.length) {
    const rows = await sql<EvidenceDoc>(
      `
      select
        id::text as id,
        title,
        coalesce(source, '') as source,
        body,
        similarity
      from public.match_nutrition_documents($1::vector, $2::int, $3::float)
      `,
      [JSON.stringify(embedding), env.docMatchCount, env.docMatchThreshold]
    );
    if (rows.length > 0) return { documents: rankEvidence(rows, query), usedFallback: false };
  }

  const rows = await sql<EvidenceDoc>(
    `
    select
      id::text as id,
      title,
      coalesce(source, '') as source,
      body,
      null::float as similarity
    from public.nutrition_documents
    where body ilike ('%' || $1 || '%')
       or title ilike ('%' || $1 || '%')
    order by created_at desc
    limit $2
    `,
    [query, env.docMatchCount]
  );
  return { documents: rankEvidence(rows, query), usedFallback: true };
}

function rankEvidence(rows: EvidenceDoc[], query: string): EvidenceDoc[] {
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 3)
    )
  ).slice(0, 40);

  return [...rows].sort((a, b) => {
    const scoreA = evidenceScore(a, terms);
    const scoreB = evidenceScore(b, terms);
    return scoreB - scoreA;
  });
}

function evidenceScore(doc: EvidenceDoc, terms: string[]): number {
  const text = `${doc.title} ${doc.body}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const lexicalScore = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
  return Number(doc.similarity || 0) * 10 + lexicalScore;
}

export async function generateProfessionalRecommendation(input: {
  topic: string;
  question: string;
  evidence: EvidenceDoc[];
  qualityFeedback?: ResponseJudge | null;
}): Promise<string> {
  const evidenceText = input.evidence
    .slice(0, 6)
    .map(
      (doc, index) =>
        `[F${index + 1}] Fonte: ${doc.title} (${doc.source || "sem fonte"})\nTrecho: ${doc.body.slice(0, 1200)}`
    )
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content:
        "Você é um assistente para nutricionistas. Responda com linguagem técnica, objetiva e aplicável à rotina clínica. Nunca invente fonte. Sempre cite [F1], [F2] etc. Não use asteriscos para negrito.",
    },
    {
      role: "user",
      content: `Tema: ${input.topic}\nPergunta: ${input.question}\n\nEvidências:\n${evidenceText}\n\n${
        input.qualityFeedback
          ? `Correção interna obrigatória antes de responder:\nProblemas: ${input.qualityFeedback.issues.join("; ") || "não informado"}\nLacunas: ${input.qualityFeedback.missing.join("; ") || "não informado"}\nRecomendação do avaliador: ${input.qualityFeedback.recommendation || "melhore completude, segurança e citações"}\n\n`
          : ""
      }Produza: resumo clínico, recomendações práticas, alertas e lacunas.`,
    },
  ];

  try {
    const output = await getReplicateClient().run(env.replicateChatModel as ReplicateModelRef, {
      input: {
        messages,
        temperature: 0.2,
        max_completion_tokens: env.replicateMaxCompletionTokens,
      },
    });
    const text = normalizeTextOutput(output);
    if (text) return text;
  } catch {
    // fallback below
  }

  return "Não foi possível gerar resposta da LLM neste momento. Revise os trechos recuperados e tente novamente.";
}

export async function generateMealPlanGuidance(input: {
  clientName?: string;
  clientObjective?: string | null;
  clientNotes?: string | null;
  message: string;
  conversationHistory?: string;
  evidence: EvidenceDoc[];
  qualityFeedback?: ResponseJudge | null;
}): Promise<string> {
  const evidenceText = input.evidence
    .slice(0, 6)
    .map(
      (doc, index) =>
        `[F${index + 1}] Fonte: ${doc.title} (${doc.source || "sem fonte"})\nTrecho: ${doc.body.slice(0, 1200)}`
    )
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content:
        "Você é um assistente de apoio a nutricionistas para construir plano alimentar em formato ping-pong. Use os dados do cadastro do cliente e o histórico da conversa como fonte principal de contexto. Considere como já informados todos os dados presentes no cadastro, incluindo idade/data de nascimento, sexo, peso, altura, IMC, medidas, objetivo, rotina, refeições por dia, orçamento, rotina alimentar por refeição, restrições, alergias, patologias, medicamentos e condição socioeconômica. Se o profissional responder apenas um número ou frase curta, interprete como resposta à última pergunta feita. Nunca repita uma pergunta que já foi respondida no cadastro ou no histórico. Não repita o plano completo a cada mensagem. Quando o plano já tiver sido gerado e o profissional pedir ajuste, semana, horários, atividade física ou mudança de hábitos, responda apenas com a atualização incremental e como ela se encaixa no plano. Se o profissional disser que o paciente quer mudar hábitos, avance para estratégia comportamental e metas pequenas, sem perguntar novamente alimentos já descritos. Faça uma pergunta por vez quando faltar dado realmente essencial. Quando perguntar rotina alimentar, divida por momentos: café da manhã, lanche da manhã, almoço, lanche da tarde, jantar, ceia e fim de semana. Antes de fechar um plano, verifique idade, sexo, altura, peso, medidas, objetivo, rotina, refeições por dia, orçamento, rotina alimentar, restrições, alergias, patologias e medicamentos. Se já houver dados suficientes, gere um rascunho de plano alimentar revisável pelo nutricionista. Em plano consolidado, cada refeição deve trazer quantidades em gramas/ml ou medidas caseiras e pelo menos três opções/substituições equivalentes quando isso for clinicamente possível. Toda afirmação baseada em documento deve citar [F1], [F2] etc. Não invente fonte, não substitua conduta clínica e não use asteriscos para negrito.",
    },
    {
      role: "user",
      content: `Cliente: ${input.clientName || "não informado"}\nObjetivo registrado: ${
        input.clientObjective || "não informado"
      }\nResumo do cadastro: ${input.clientNotes || "não informado"}\n\nHistórico recente:\n${
        input.conversationHistory || "sem histórico"
      }\n\nMensagem atual:\n${
        input.message
      }\n\nEvidências recuperadas:\n${evidenceText}\n\n${
        input.qualityFeedback
          ? `Correção interna obrigatória antes de responder:\nProblemas: ${input.qualityFeedback.issues.join("; ") || "não informado"}\nLacunas: ${input.qualityFeedback.missing.join("; ") || "não informado"}\nRecomendação do avaliador: ${input.qualityFeedback.recommendation || "melhore completude e segurança"}\n\n`
          : ""
      }Responda de forma objetiva. Primeiro use os dados já informados no cadastro e no histórico. Se já existe um plano no histórico, não reescreva a síntese, estrutura, substituições e lista de compras; responda apenas ao ajuste solicitado. Se o pedido for semanal, transforme o plano em uma rotina semanal simples com opções por dia. Se o usuário trouxer intenção de mudança de hábitos, proponha um próximo passo prático e pergunte somente um detalhe comportamental que ainda não esteja no cadastro. Se faltam dados essenciais, pergunte somente o próximo dado mais importante; se a lacuna for hábito alimentar, pergunte por uma refeição ou momento por vez. Se os dados forem suficientes e ainda não existir plano no histórico, organize: síntese do caso, alertas, estrutura alimentar por refeições com quantidade e medida caseira, pelo menos três opções/substituições por refeição, substituições econômicas, lista de compras e pontos para validação profissional.`,
    },
  ];

  try {
    const output = await getReplicateClient().run(env.replicateChatModel as ReplicateModelRef, {
      input: {
        messages,
        temperature: 0.15,
        max_completion_tokens: env.replicateMaxCompletionTokens,
      },
    });
    const text = normalizeTextOutput(output);
    if (text) return text;
  } catch {
    // fallback below
  }

  return "Não consegui consultar a LLM agora. Continue a coleta com: idade, sexo, altura, peso, objetivo, rotina, orçamento, restrições, alergias, patologias e medicamentos.";
}

export async function judgeResponse(input: {
  mode: "meal_plan" | "professional_recommendation";
  userMessage: string;
  answer: string;
  conversationHistory?: string;
  evidence: EvidenceDoc[];
}): Promise<ResponseJudge> {
  const evidenceIds = input.evidence.slice(0, 6).map((_, index) => `[F${index + 1}]`).join(", ");
  const rubric =
    input.mode === "meal_plan"
      ? "Avalie se a resposta apoia a construção de plano alimentar em ping-pong: usa o histórico, não repete perguntas já respondidas, interpreta respostas curtas conforme a última pergunta, pergunta uma coisa por vez quando faltam dados essenciais, divide hábitos alimentares por refeições/momentos quando o pedido for amplo, não fecha plano sem contexto suficiente, considera segurança clínica, orçamento, rotina, restrições, alergias, patologias, medicamentos e cita fontes quando usa evidência. Quando houver plano consolidado, avalie se há quantidades em gramas/ml ou medidas caseiras e pelo menos três opções/substituições por refeição quando clinicamente possível. Use passed=true quando a próxima pergunta for adequada e não repetida, ou quando o plano consolidado estiver completo."
      : "Avalie se a resposta profissional está completa: responde a pergunta, cita fontes quando usa evidência, aponta limites/lacunas, não inventa condutas e mantém segurança clínica.";

  const messages = [
    {
      role: "system",
      content:
        "Você é um avaliador de qualidade para respostas de IA em nutrição. Responda somente JSON válido, sem markdown.",
    },
    {
      role: "user",
      content: `${rubric}\n\nHistórico recente:\n${input.conversationHistory || "sem histórico"}\n\nPergunta/mensagem do usuário:\n${input.userMessage}\n\nResposta da IA:\n${input.answer}\n\nFontes disponíveis: ${
        evidenceIds || "nenhuma"
      }\n\nRetorne JSON neste formato exato. O score deve ser entre 0 e 1:\n{\"passed\":boolean,\"score\":number,\"issues\":[string],\"missing\":[string],\"recommendation\":string}`,
    },
  ];

  try {
    const output = await getReplicateClient().run(env.replicateChatModel as ReplicateModelRef, {
      input: {
        messages,
        temperature: 0,
        max_completion_tokens: 900,
      },
    });
    const parsed = safeParseJudge(normalizeTextOutput(output));
    if (parsed) {
      if (
        input.mode === "meal_plan" &&
        input.conversationHistory &&
        /\bqual (é|e) a idade\b|\bidade do cliente\b/i.test(input.answer) &&
        /\bidade\b[\s\S]{0,180}\b\d{1,3}\b|\bprofissional:\s*\d{1,3}\b/i.test(input.conversationHistory)
      ) {
        return {
          passed: false,
          score: Math.min(parsed.score, 0.35),
          issues: [...parsed.issues, "A resposta repetiu uma pergunta já respondida no histórico."],
          missing: Array.from(new Set([...parsed.missing, "próximo dado clínico não coletado"])),
          recommendation: "Use o histórico e avance para o próximo dado faltante em vez de repetir idade.",
        };
      }
      return parsed;
    }
  } catch {
    // fallback below
  }

  const issues: string[] = [];
  const missing: string[] = [];
  if (input.evidence.length > 0 && !/\[F\d+\]/.test(input.answer)) {
    issues.push("A resposta não citou as fontes recuperadas.");
    missing.push("citações [F1], [F2]");
  }
  if (input.mode === "meal_plan" && /plano alimentar|cardápio|refeições/i.test(input.answer)) {
    const essential = ["idade", "altura", "peso", "rotina", "orçamento"];
    for (const item of essential) {
      if (!new RegExp(item, "i").test(input.userMessage + input.answer)) missing.push(item);
    }
  }
  if (input.mode === "meal_plan" && /plano alimentar|cardápio|estrutura alimentar/i.test(input.answer)) {
    if (!/\b(g|kg|ml|colher|xícara|fatia|unidade|porção de \d)/i.test(input.answer)) {
      issues.push("O plano não trouxe quantidades ou medidas caseiras.");
      missing.push("quantidades por refeição");
    }
    if (!/opção\s*1|1\./i.test(input.answer) || !/opção\s*2|2\./i.test(input.answer) || !/opção\s*3|3\./i.test(input.answer)) {
      issues.push("O plano não trouxe três opções/substituições de forma clara.");
      missing.push("três opções por refeição");
    }
  }
  return {
    passed: issues.length === 0 && missing.length === 0,
    score: issues.length === 0 && missing.length === 0 ? 0.82 : 0.55,
    issues,
    missing: Array.from(new Set(missing)),
    recommendation:
      issues.length || missing.length
        ? "Revise a resposta antes de usar e peça os dados ausentes."
        : "Resposta adequada para revisão profissional.",
  };
}
