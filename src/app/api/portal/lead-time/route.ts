import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPortalSession } from "@/lib/portal-token";
import { getLeadTimeEstimates, type LeadTimeCategoryEstimate } from "@/lib/lead-time-estimates";
import type { Database } from "@/types/database.types";

/**
 * 通路商下單頁的訂單水位與交期預估。
 * 瀏覽器為 anon（無法讀 app_settings／orders），以 portal_token 驗證後用 service role 代查。
 * 僅回傳月數負載與交期，不含 NT$ 金額與產能參數（對外不揭露）。
 */

function toPublicEstimate(e: LeadTimeCategoryEstimate): {
  months_load: number;
  base_months: number;
  display_months: number;
} {
  return {
    months_load: e.capacityPerMonth > 0 ? e.backlogAmount / e.capacityPerMonth : 0,
    base_months: e.baseMonths,
    display_months: e.displayMonths,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token : "";

    const v = verifyPortalSession(token);
    if (!v) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url?.trim() || !key?.trim()) {
      console.error("lead-time: missing SUPABASE_SERVICE_ROLE_KEY");
      return NextResponse.json({ error: "server_config" }, { status: 500 });
    }

    const supabase = createClient<Database>(url, key);
    const estimates = await getLeadTimeEstimates(supabase);

    return NextResponse.json({
      chair: toPublicEstimate(estimates.chair),
      table_shelf: toPublicEstimate(estimates.tableShelf),
      other: toPublicEstimate(estimates.other),
    });
  } catch (e) {
    console.error("lead-time:", e);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
