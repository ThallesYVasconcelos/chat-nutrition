import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/api-auth";

export async function GET() {
  try {
    const user = await requireAppUser();
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
