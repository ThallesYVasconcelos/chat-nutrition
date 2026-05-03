import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/api-auth";
import { sql } from "@/lib/db";
import { hasPublicTable } from "@/lib/optional-db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAppUser();
    const { id } = await params;
    if (!(await hasPublicTable("meal_plans"))) return NextResponse.json({ mealPlans: [] });
    const mealPlans = await sql(
      `
      select
        id::text as id,
        title,
        content,
        coalesce(evidence, '[]'::jsonb) as evidence,
        status,
        version,
        created_at::text,
        updated_at::text
      from public.meal_plans
      where user_id = $1 and patient_id = $2
      order by updated_at desc
      limit 12
      `,
      [user.id, id]
    );
    return NextResponse.json({ mealPlans });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
