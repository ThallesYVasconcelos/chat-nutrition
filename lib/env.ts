function read(name: string, fallback = ""): string {
  const value = process.env[name];
  return (value || fallback).trim();
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  appUrl: read("APP_BASE_URL", "http://localhost:3000"),
  supabaseUrl: read("SUPABASE_URL"),
  supabaseAnonKey: read("SUPABASE_ANON_KEY"),
  databaseUrl: read("SUPABASE_DB_URL_PRODUCTION") || read("DATABASE_URL"),
  replicateApiToken: read("REPLICATE_API_TOKEN"),
  replicateChatModel: read("REPLICATE_CHAT_MODEL", "openai/gpt-4o-mini"),
  replicateEmbeddingModel: read("REPLICATE_EMBEDDING_MODEL", "beautyyuyanli/multilingual-e5-small"),
  replicateMaxCompletionTokens: readNumber("REPLICATE_MAX_COMPLETION_TOKENS", 4096),
  docMatchCount: readNumber("NUTRI_DOC_MATCH_COUNT", 6),
  docMatchThreshold: readNumber("NUTRI_DOC_MATCH_THRESHOLD", 0.68),
};

export function assertServerEnv(): void {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("SUPABASE_URL");
  if (!env.supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
  if (!env.databaseUrl) missing.push("SUPABASE_DB_URL_PRODUCTION or DATABASE_URL");
  if (!env.replicateApiToken) missing.push("REPLICATE_API_TOKEN");
  if (missing.length) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }
}
