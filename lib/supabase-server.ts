import { assertServerEnv, env } from "@/lib/env";

export type SupabaseUser = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

export async function getSupabaseUserFromToken(accessToken: string): Promise<SupabaseUser | null> {
  assertServerEnv();
  const token = accessToken.trim();
  if (!token) return null;

  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  const data = (await response.json()) as SupabaseUser;
  if (!data?.id || !data?.email) return null;
  return data;
}

export async function inspectSupabaseToken(accessToken: string): Promise<{
  ok: boolean;
  reason: string;
  status: number;
}> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return { ok: false, reason: "missing_supabase_env", status: 500 };
  }
  const token = accessToken.trim();
  if (!token) {
    return { ok: false, reason: "missing_bearer_token", status: 401 };
  }
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return { ok: false, reason: "token_validation_failed", status: response.status };
  }
  return { ok: true, reason: "ok", status: 200 };
}
