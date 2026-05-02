import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    const messages = await sql(
      `
      select role, content, created_at::text as created_at, evidence
      from public.chat_messages
      where thread_id = $1 and user_id = $2
      order by created_at
      `,
      [id, user.id]
    );
    return NextResponse.json({ messages });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
