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

    // 先從 channels 依通路代碼尋找通路
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, name, portal_code, portal_password")
      .eq("portal_code", code)
      .maybeSingle();

    if (channelError) {
      console.error("portal-login channel query error:", channelError);
      return NextResponse.json(
        { success: false, error: "驗證失敗，請稍後再試" },
        { status: 500 }
      );
    }

    if (!channel?.portal_code) {
      return NextResponse.json(
        { success: false, error: "通路代碼或密碼錯誤" },
        { status: 401 }
      );
    }

    const storedPassword = channel.portal_password ?? "";
    if (storedPassword !== password) {
      return NextResponse.json(
        { success: false, error: "通路代碼或密碼錯誤" },
        { status: 401 }
      );
    }

    // 以通路為單位找對應客戶（通路商），用於訂單的 customer_id
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, name, delivery_address")
      .eq("channel_id", channel.id)
      .limit(1)
      .maybeSingle();

    if (customerError) {
      console.error("portal-login customer query error:", customerError);
      return NextResponse.json(
        { success: false, error: "驗證失敗，請稍後再試" },
        { status: 500 }
      );
    }

    if (!customer) {
      return NextResponse.json(
        {
          success: false,
          error: "此通路尚未綁定客戶資料，請先在 ERP 客戶資料中建立一筆客戶並指定所屬通路。",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      customer_id: customer.id,
      customer_name: customer.name ?? "",
      delivery_address: (customer as any).delivery_address ?? null,
      channel_id: channel.id,
      channel_name: channel.name ?? "",
    });
  } catch (e) {
    console.error("portal-login error:", e);
    return NextResponse.json(
      { success: false, error: "伺服器錯誤" },
      { status: 500 }
    );
  }
}
