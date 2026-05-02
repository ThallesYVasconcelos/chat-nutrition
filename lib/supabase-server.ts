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
