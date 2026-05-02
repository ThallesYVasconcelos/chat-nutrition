import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";

const patchSchema = z.object({
  fullName: z.string().min(2),
  birthDate: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    const rows = await sql(
      `
      select
        id::text as id,
        full_name,
        birth_date::text,
        phone,
        email,
        objective,
        notes,
        created_at::text,
        updated_at::text
      from public.patients
      where id = $1 and user_id = $2
      limit 1
      `,
      [id, user.id]
    );
    return NextResponse.json({ patient: rows[0] || null });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const payload = patchSchema.parse(await request.json());
    const { id } = await params;
    await sql(
      `
      update public.patients
      set full_name = $1,
          birth_date = nullif($2, '')::date,
          phone = nullif($3, ''),
          email = nullif($4, ''),
          objective = nullif($5, ''),
          notes = nullif($6, '')
      where id = $7 and user_id = $8
      `,
      [
        payload.fullName.trim(),
        payload.birthDate || "",
        payload.phone || "",
        payload.email || "",
        payload.objective || "",
        payload.notes || "",
        id,
        user.id,
      ]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_payload", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}
