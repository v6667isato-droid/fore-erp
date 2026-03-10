import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!code || !password) {
      return NextResponse.json(
        { success: false, error: "請輸入通路代碼與密碼" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, name, portal_code, portal_password, delivery_address")
      .eq("portal_code", code)
      .maybeSingle();

    if (error) {
      console.error("portal-login query error:", error);
      return NextResponse.json(
        { success: false, error: "驗證失敗，請稍後再試" },
        { status: 500 }
      );
    }

    if (!customer?.portal_code) {
      return NextResponse.json(
        { success: false, error: "通路代碼或密碼錯誤" },
        { status: 401 }
      );
    }

    const storedPassword = customer.portal_password ?? "";
    if (storedPassword !== password) {
      return NextResponse.json(
        { success: false, error: "通路代碼或密碼錯誤" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      customer_id: customer.id,
      customer_name: customer.name ?? "",
      delivery_address: customer.delivery_address ?? null,
    });
  } catch (e) {
    console.error("portal-login error:", e);
    return NextResponse.json(
      { success: false, error: "伺服器錯誤" },
      { status: 500 }
    );
  }
}
