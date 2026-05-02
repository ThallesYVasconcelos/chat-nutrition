import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";

export async function GET() {
  try {
    await requireAppUser();
    const rows = await sql<{ title: string }>(
      `
      select title
      from public.nutrition_documents
      group by title
      order by title
      `
    );
    return NextResponse.json({ documents: rows.map((row) => row.title) });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
