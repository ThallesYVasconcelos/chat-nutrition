import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { inspectSupabaseToken } from "@/lib/supabase-server";
import { headers } from "next/headers";

export async function GET() {
  try {
    const user = await requireAppUser();
    return NextResponse.json({ user });
  } catch {
    const h = await headers();
    const auth = h.get("authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const check = await inspectSupabaseToken(bearer);
    return NextResponse.json(
      {
        error: "unauthorized",
        debug: {
          reason: check.reason,
          supabaseStatus: check.status,
          hasAuthorizationHeader: Boolean(auth),
          hasBearerToken: Boolean(bearer),
          hasSupabaseUrl: Boolean(env.supabaseUrl),
          hasSupabaseAnonKey: Boolean(env.supabaseAnonKey),
          hasDatabaseUrl: Boolean(env.databaseUrl),
        },
      },
      { status: 401 }
    );
  }
}
