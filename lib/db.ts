import { Pool } from "pg";
import { assertServerEnv, env } from "@/lib/env";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    assertServerEnv();
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function sql<T = Record<string, unknown>>(
  query: string,
  values: unknown[] = []
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(query, values);
    return result.rows as T[];
  } finally {
    client.release();
  }
}
