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

export async function searchEvidence(query: string): Promise<EvidenceDoc[]> {
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
    if (rows.length > 0) return rows;
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
  return rows;
}

export async function generateProfessionalRecommendation(input: {
  topic: string;
  question: string;
  evidence: EvidenceDoc[];
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
        "Você é um assistente para nutricionistas. Responda com linguagem técnica, objetiva e aplicável à rotina clínica. Nunca invente fonte. Sempre cite [F1], [F2] etc.",
    },
    {
      role: "user",
      content: `Tema: ${input.topic}\nPergunta: ${input.question}\n\nEvidências:\n${evidenceText}\n\nProduza: resumo clínico, recomendações práticas, alertas e lacunas.`,
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
  evidence: EvidenceDoc[];
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
        "Você é um assistente de apoio a nutricionistas para construir plano alimentar em formato ping-pong. Faça uma pergunta por vez quando faltarem dados. Antes de fechar um plano, verifique idade, sexo, altura, peso, medidas, objetivo, rotina, refeições por dia, orçamento, preferências, restrições, alergias, patologias e medicamentos. Se já houver dados suficientes, gere um rascunho de plano alimentar revisável pelo nutricionista. Toda afirmação baseada em documento deve citar [F1], [F2] etc. Não invente fonte e não substitua conduta clínica.",
    },
    {
      role: "user",
      content: `Cliente: ${input.clientName || "não informado"}\nObjetivo registrado: ${
        input.clientObjective || "não informado"
      }\nResumo do cadastro: ${input.clientNotes || "não informado"}\n\nMensagem atual:\n${
        input.message
      }\n\nEvidências recuperadas:\n${evidenceText}\n\nResponda de forma objetiva. Se faltam dados essenciais, pergunte somente o próximo dado mais importante. Se os dados forem suficientes, organize: síntese do caso, alertas, estrutura alimentar por refeições, substituições econômicas, lista de compras e pontos para validação profissional.`,
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
