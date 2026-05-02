import { headers } from "next/headers";
import { getSupabaseUserFromToken } from "@/lib/supabase-server";
import { sql } from "@/lib/db";

export type AppUser = {
  id: string;
  email: string;
  full_name: string | null;
};

export async function requireAppUser(): Promise<AppUser> {
  const h = await headers();
  const auth = h.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const supabaseUser = await getSupabaseUserFromToken(token);
  if (!supabaseUser) {
    throw new Error("UNAUTHORIZED");
  }

  const fullName =
    (supabaseUser.user_metadata?.full_name as string | undefined) ||
    (supabaseUser.user_metadata?.name as string | undefined) ||
    null;

  const rows = await sql<AppUser>(
    `
    insert into public.app_users (email, full_name, password_hash, oauth_provider, oauth_subject, last_login_at)
    values ($1, $2, null, 'google', $3, now())
    on conflict (email) do update
      set full_name = coalesce(excluded.full_name, app_users.full_name),
          oauth_provider = 'google',
          oauth_subject = excluded.oauth_subject,
          last_login_at = now()
    returning id::text as id, email, full_name
    `,
    [supabaseUser.email.toLowerCase(), fullName, supabaseUser.id]
  );

  if (!rows[0]) throw new Error("UNAUTHORIZED");
  return rows[0];
}
