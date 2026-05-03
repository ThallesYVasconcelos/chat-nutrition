import { sql } from "@/lib/db";

const tableCache = new Map<string, boolean>();

export async function hasPublicTable(tableName: string): Promise<boolean> {
  if (tableCache.has(tableName)) return Boolean(tableCache.get(tableName));
  try {
    const rows = await sql<{ exists: boolean }>(
      "select to_regclass($1) is not null as exists",
      [`public.${tableName}`]
    );
    const exists = Boolean(rows[0]?.exists);
    tableCache.set(tableName, exists);
    return exists;
  } catch {
    return false;
  }
}

export async function optionalWrite(query: string, values: unknown[] = []): Promise<void> {
  try {
    await sql(query, values);
  } catch {
    // Optional persistence must not block the clinical workflow.
  }
}
