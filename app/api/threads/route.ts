import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireAppUser();
    const rows = await sql(
      `
      select id::text as id, title, mode, updated_at::text as updated_at
      from public.chat_threads
      where user_id = $1 and patient_id is null
      order by updated_at desc
      limit 30
      `,
      [user.id]
    );
    return NextResponse.json({ threads: rows });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
