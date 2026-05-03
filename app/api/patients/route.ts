import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";
import { ClinicalProfile, normalizeClinicalProfile } from "@/lib/clinical-profile";
import { hasPublicTable, optionalWrite } from "@/lib/optional-db";

const createPatientSchema = z.object({
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

type PatientRow = {
  id: string;
  full_name: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  objective: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  clinical_profile?: ClinicalProfile | null;
};

export async function GET() {
  try {
    const user = await requireAppUser();
    const rows = await sql<PatientRow>(
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
      where user_id = $1
      order by full_name
      `,
      [user.id]
    );
    if (rows.length && await hasPublicTable("patient_clinical_profiles")) {
      const profiles = await sql<{ patient_id: string; data: unknown }>(
        `
        select patient_id::text as patient_id, data
        from public.patient_clinical_profiles
        where user_id = $1 and patient_id = any($2::uuid[])
        `,
        [user.id, rows.map((row) => row.id)]
      );
      const byPatient = new Map(profiles.map((profile) => [profile.patient_id, normalizeClinicalProfile(profile.data)]));
      rows.forEach((row) => {
        row.clinical_profile = byPatient.get(row.id) || null;
      });
    }
    return NextResponse.json({ patients: rows });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAppUser();
    const parsed = createPatientSchema.parse(await request.json());
    const clinicalProfile = normalizeClinicalProfile(parsed.clinicalProfile);
    const rows = await sql<{ id: string }>(
      `
      insert into public.patients (user_id, full_name, birth_date, phone, email, objective, notes)
      values ($1, $2, $3::date, nullif($4, ''), nullif($5, ''), nullif($6, ''), nullif($7, ''))
      returning id::text as id
      `,
      [
        user.id,
        parsed.fullName.trim(),
        normalizeDate(parsed.birthDate),
        parsed.phone || "",
        parsed.email || "",
        parsed.objective || "",
        parsed.notes || "",
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
        [rows[0]?.id, user.id, JSON.stringify(clinicalProfile)]
      );
    }
    return NextResponse.json({ patientId: rows[0]?.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_payload", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}
