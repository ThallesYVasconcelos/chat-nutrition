import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";
import { generateProfessionalRecommendation, judgeResponse, searchEvidence } from "@/lib/ai";

const schema = z.object({
  topic: z.string().min(2),
  question: z.string().min(3),
  threadId: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAppUser();
    const payload = schema.parse(await request.json());
    const evidence = await searchEvidence(`${payload.topic}. ${payload.question}`);
    let answer = await generateProfessionalRecommendation({
      topic: payload.topic,
      question: payload.question,
      evidence,
    });
    let judge = await judgeResponse({
      mode: "professional_recommendation",
      userMessage: payload.question,
      answer,
      evidence,
    });
    let refinementCount = 0;
    while ((!judge.passed || judge.score < 0.78) && refinementCount < 2) {
      refinementCount += 1;
      answer = await generateProfessionalRecommendation({
        topic: payload.topic,
        question: payload.question,
        evidence,
        qualityFeedback: judge,
      });
      judge = await judgeResponse({
        mode: "professional_recommendation",
        userMessage: payload.question,
        answer,
        evidence,
      });
    }

    let threadId = payload.threadId || "";
    if (!threadId) {
      const created = await sql<{ id: string }>(
        `
        insert into public.chat_threads (user_id, title, mode, profile, last_evidence)
        values ($1, $2, 'professional', '{}'::jsonb, '[]'::jsonb)
        returning id::text as id
        `,
        [user.id, `${payload.topic}: ${payload.question.slice(0, 72)}`]
      );
      threadId = created[0].id;
    }

    await sql(
      `
      insert into public.chat_messages (thread_id, user_id, role, content, metadata)
      values ($1, $2, 'user', $3, $4::jsonb)
      `,
      [threadId, user.id, `[${payload.topic}] ${payload.question}`, JSON.stringify({ topic: payload.topic })]
    );

    const evidencePayload = evidence.slice(0, 6).map((doc, index) => ({
      id: `F${index + 1}`,
      title: doc.title,
      source: doc.source,
      similarity: doc.similarity,
      excerpt: doc.body.slice(0, 700),
    }));

    await sql(
      `
      insert into public.chat_messages (thread_id, user_id, role, content, evidence, metadata)
      values ($1, $2, 'assistant', $3, $4::jsonb, $5::jsonb)
      `,
      [
        threadId,
        user.id,
        answer,
        JSON.stringify(evidencePayload),
        JSON.stringify({ topic: payload.topic, judge, refinementCount }),
      ]
    );

    await sql(
      `
      update public.chat_threads
      set updated_at = now(),
          title = $1,
          last_evidence = $2::jsonb
      where id = $3 and user_id = $4
      `,
      [`${payload.topic}: ${payload.question.slice(0, 72)}`, JSON.stringify(evidencePayload), threadId, user.id]
    );

    return NextResponse.json({ threadId, answer, evidence: evidencePayload, judge });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_payload", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}
