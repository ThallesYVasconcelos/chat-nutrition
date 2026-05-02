import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";

const createSchema = z.object({
  category: z.string().min(2),
  note: z.string().min(3),
});

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    const rows = await sql(
      `
      select id::text as id, category, note, created_at::text
      from public.patient_observations
      where patient_id = $1 and user_id = $2
      order by created_at desc
      `,
      [id, user.id]
    );
    return NextResponse.json({ observations: rows });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    const payload = createSchema.parse(await request.json());
    await sql(
      `
      insert into public.patient_observations (patient_id, user_id, category, note)
      values ($1, $2, $3, $4)
      `,
      [id, user.id, payload.category.trim(), payload.note.trim()]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_payload", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}
