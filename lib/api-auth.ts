import { headers } from "next/headers";
import { getSupabaseUserFromToken } from "@/lib/supabase-server";
import { sql } from "@/lib/db";

export type AppUser = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
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
  const avatarUrl =
    (supabaseUser.user_metadata?.avatar_url as string | undefined) ||
    (supabaseUser.user_metadata?.picture as string | undefined) ||
    null;

  const normalizedEmail = supabaseUser.email.toLowerCase();
  const rows = await sql<AppUser>(
    `
    with updated as (
      update public.app_users
      set email = $1,
          full_name = coalesce(nullif($2, ''), full_name),
          oauth_provider = 'google',
          oauth_subject = $3,
          last_login_at = now()
      where oauth_provider = 'google' and oauth_subject = $3
      returning id::text as id, email, full_name
    ),
    updated_by_email as (
      update public.app_users
      set full_name = coalesce(nullif($2, ''), full_name),
          oauth_provider = 'google',
          oauth_subject = $3,
          last_login_at = now()
      where lower(email) = $1
        and not exists (select 1 from updated)
      returning id::text as id, email, full_name
    ),
    inserted as (
      insert into public.app_users (email, full_name, password_hash, oauth_provider, oauth_subject, last_login_at)
      select $1, nullif($2, ''), null, 'google', $3, now()
      where not exists (select 1 from updated)
        and not exists (select 1 from updated_by_email)
      returning id::text as id, email, full_name
    )
    select * from updated
    union all
    select * from updated_by_email
    union all
    select * from inserted
    limit 1
    `,
    [normalizedEmail, fullName || "", supabaseUser.id]
  );

  if (!rows[0]) throw new Error("UNAUTHORIZED");
  return { ...rows[0], avatar_url: avatarUrl };
}
