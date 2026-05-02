import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";

export async function GET() {
  try {
    await requireAppUser();
    const rows = await sql<{ title: string; source: string; chunks: string }>(
      `
      select
        title,
        coalesce(max(source), '') as source,
        count(*)::text as chunks
      from public.nutrition_documents
      group by title
      order by count(*) desc, title
      `
    );
    return NextResponse.json({ documents: rows });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
