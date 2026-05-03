import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";
import { ClinicalProfile, normalizeClinicalProfile } from "@/lib/clinical-profile";
import { hasPublicTable, optionalWrite } from "@/lib/optional-db";

const patchSchema = z.object({
  fullName: z.string().min(2),
  birthDate: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  clinicalProfile: z.record(z.string()).optional().nullable(),
});

function normalizeDate(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return trimmed;
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    const rows = await sql<(Record<string, unknown> & { id: string; clinical_profile?: ClinicalProfile | null })>(
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
    const patient = rows[0] || null;
    if (patient && await hasPublicTable("patient_clinical_profiles")) {
      const profiles = await sql<{ data: unknown }>(
        `
        select data
        from public.patient_clinical_profiles
        where patient_id = $1 and user_id = $2
        limit 1
        `,
        [id, user.id]
      );
      patient.clinical_profile = normalizeClinicalProfile(profiles[0]?.data);
    }
    return NextResponse.json({ patient });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const payload = patchSchema.parse(await request.json());
    const clinicalProfile = normalizeClinicalProfile(payload.clinicalProfile);
    const { id } = await params;
    await sql(
      `
      update public.patients
      set full_name = $1,
          birth_date = $2::date,
          phone = nullif($3, ''),
          email = nullif($4, ''),
          objective = nullif($5, ''),
          notes = nullif($6, '')
      where id = $7 and user_id = $8
      `,
      [
        payload.fullName.trim(),
        normalizeDate(payload.birthDate),
        payload.phone || "",
        payload.email || "",
        payload.objective || "",
        payload.notes || "",
        id,
        user.id,
      ]
    );
    if (Object.keys(clinicalProfile).length) {
      await optionalWrite(
        `
        insert into public.patient_clinical_profiles (patient_id, user_id, data)
        values ($1::uuid, $2, $3::jsonb)
        on conflict (patient_id)
        do update set data = excluded.data
        `,
        [id, user.id, JSON.stringify(clinicalProfile)]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_payload", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    await sql(
      `
      delete from public.chat_threads
      where patient_id = $1 and user_id = $2
      `,
      [id, user.id]
    );
    await sql(
      `
      delete from public.patients
      where id = $1 and user_id = $2
      `,
      [id, user.id]
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}
