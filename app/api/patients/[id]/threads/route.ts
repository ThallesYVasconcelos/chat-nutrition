import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";
import { generateMealPlanGuidance, judgeResponse, searchEvidence } from "@/lib/ai";

const messageSchema = z.object({
  message: z.string().min(2),
  threadId: z.string().optional().nullable(),
});

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    const threads = await sql(
      `
      select id::text as id, title, updated_at::text
      from public.chat_threads
      where user_id = $1 and patient_id = $2
      order by updated_at desc
      `,
      [user.id, id]
    );
    return NextResponse.json({ threads });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    const payload = messageSchema.parse(await request.json());

    let threadId = payload.threadId || "";
    const patientRows = await sql<{ full_name: string; objective: string | null; notes: string | null }>(
      `
      select full_name, objective, notes
      from public.patients
      where id = $1 and user_id = $2
      limit 1
      `,
      [id, user.id]
    );
    const patient = patientRows[0];

    if (!threadId) {
      const created = await sql<{ id: string }>(
        `
        insert into public.chat_threads (user_id, patient_id, title, mode, profile, last_evidence)
        values ($1, $2, $3, 'patient_chat', '{}'::jsonb, '[]'::jsonb)
        returning id::text as id
        `,
        [user.id, id, `Paciente: ${payload.message.slice(0, 72)}`]
      );
      threadId = created[0].id;
    }

    await sql(
      `
      insert into public.chat_messages (thread_id, user_id, role, content, metadata)
      values ($1, $2, 'user', $3, '{"kind":"patient_chat"}'::jsonb)
      `,
      [threadId, user.id, payload.message.trim()]
    );

    const evidence = await searchEvidence(payload.message);
    const evidencePayload = evidence.slice(0, 6).map((item, index) => ({
      id: `F${index + 1}`,
      title: item.title,
      source: item.source,
      similarity: item.similarity,
      excerpt: item.body.slice(0, 700),
    }));
    const answer = await generateMealPlanGuidance({
      clientName: patient?.full_name,
      clientObjective: patient?.objective,
      clientNotes: patient?.notes,
      message: payload.message,
      evidence,
    });
    const judge = await judgeResponse({
      mode: "meal_plan",
      userMessage: payload.message,
      answer,
      evidence,
    });

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
        JSON.stringify({ kind: "patient_chat_response", judge }),
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
      [
        `Paciente: ${payload.message.slice(0, 72)}`,
        JSON.stringify(evidencePayload),
        threadId,
        user.id,
      ]
    );

    return NextResponse.json({ threadId, answer, evidence: evidencePayload, judge });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_payload", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}
