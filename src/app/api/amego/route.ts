import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildIssuePayload,
  callAmego,
  dateToYmd,
  getAmegoCredentials,
  timestampToTaipeiDate,
} from "@/lib/amego";
import { runAmegoSync } from "@/lib/amego-sync";

export const maxDuration = 60;

/**
 * 光賀電子發票操作（需登入）。POST body：
 * - { action: "issue", invoice_id }：開立（自動配號），成功後回寫發票號碼與同步狀態
 * - { action: "void", invoice_id, void_date?, reason }：作廢已同步的發票
 * - { action: "allowance", invoice_id, amount_inc_tax, allowance_date?, reason? }：開立折讓
 * - { action: "file", invoice_id, download_style? }：取得發票 PDF 連結（10 分鐘有效）
 * - { action: "ban", ban }：統編查公司名稱（開票時自動帶抬頭）
 * - { action: "sync", days? }：把光賀端的發票同步回 ERP（預設近 60 天，上限 180）
 * 環境變數 AMEGO_BAN／AMEGO_APP_KEY 未設定時走光賀公開測試環境。
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase 未設定" }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "未授權" }, { status: 401 });
  const {
    data: { user },
    error: userErr,
  } = await createClient(url, anonKey).auth.getUser(token);
  if (userErr || !user) return NextResponse.json({ error: "登入已失效" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? anonKey);
  const creds = getAmegoCredentials();
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "issue":
        return await handleIssue(db, String(body.invoice_id ?? ""));
      case "void":
        return await handleVoid(db, String(body.invoice_id ?? ""), body);
      case "allowance":
        return await handleAllowance(db, String(body.invoice_id ?? ""), body);
      case "file":
        return await handleFile(db, String(body.invoice_id ?? ""), body);
      case "sync":
        return await handleSync(db, body);
      case "ban": {
        const ban = String(body.ban ?? "").trim();
        if (!/^\d{8}$/.test(ban)) return NextResponse.json({ error: "統編需為 8 碼數字" }, { status: 400 });
        const res = await callAmego("/json/ban_query", [{ ban }], creds);
        if (res.code !== 0) return NextResponse.json({ error: amegoError(res) }, { status: 502 });
        const row = (res.data as { ban: string; name: string }[] | undefined)?.[0];
        return NextResponse.json({ name: row?.name ?? "", environment: creds.environment });
      }
      default:
        return NextResponse.json({ error: `未知動作：${action}` }, { status: 400 });
    }
  } catch (e) {
    console.error("[amego]", action, e);
    const msg = e instanceof Error ? e.message : "光賀連線失敗，請稍後再試";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

function amegoError(res: { code: number; msg: string }): string {
  return `光賀回應錯誤（代碼 ${res.code}）：${res.msg || "無錯誤訊息"}`;
}

interface InvoiceRow {
  id: string;
  invoice_type: "B2B" | "B2C";
  invoice_number: string | null;
  invoice_date: string | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  buyer_email: string | null;
  carrier_type: string | null;
  carrier_id: string | null;
  donation_code: string | null;
  tax_type: number;
  status: string;
  sync_status: string;
  notes: string | null;
  orders: { order_number: string } | null;
}

async function loadInvoice(db: SupabaseClient, invoiceId: string): Promise<InvoiceRow | null> {
  if (!invoiceId) return null;
  const { data } = await db
    .from("sales_invoices")
    .select(
      // orders 需指定 FK：sales_invoice_orders 關聯表加入後有兩條路徑，不指定會回 PGRST201
      "id, invoice_type, invoice_number, invoice_date, buyer_name, buyer_tax_id, buyer_email, carrier_type, carrier_id, donation_code, tax_type, status, sync_status, notes, orders!sales_invoices_order_id_fkey (order_number)",
    )
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as unknown as InvoiceRow | null) ?? null;
}

/**
 * 光賀端訂單編號（唯一、≤40 字）：有來源訂單用「訂單號-發票id前8碼」方便後台對帳，
 * 同一張訂單分次開票（訂金＋尾款）也不會重複；無訂單則用發票 UUID
 */
function buildAmegoOrderId(inv: InvoiceRow): string {
  const orderNumber = inv.orders?.order_number?.replace(/^ORD-/i, "").trim();
  if (!orderNumber) return inv.id;
  return `${orderNumber}-${inv.id.slice(0, 8)}`.slice(0, 40);
}

/** 開立發票（自動配號 f0401） */
async function handleIssue(db: SupabaseClient, invoiceId: string) {
  const creds = getAmegoCredentials();
  const inv = await loadInvoice(db, invoiceId);
  if (!inv) return NextResponse.json({ error: "找不到發票" }, { status: 404 });
  if (inv.invoice_number) {
    return NextResponse.json({ error: "此發票已有號碼，不可再由光賀配號" }, { status: 400 });
  }
  if (inv.status === "voided") {
    return NextResponse.json({ error: "已作廢的發票不可開立" }, { status: 400 });
  }
  if (inv.tax_type === 2) {
    // 零稅率需通關方式與零稅率原因欄位，系統尚未支援，避免帶錯誤預設值申報
    return NextResponse.json({ error: "零稅率發票暫不支援光賀自動開立，請於光賀後台手動處理" }, { status: 400 });
  }
  if (inv.invoice_type === "B2B" && !/^\d{8}$/.test(inv.buyer_tax_id ?? "")) {
    return NextResponse.json({ error: "B2B 發票需先填買方統編（8 碼數字）" }, { status: 400 });
  }

  const { data: itemsData } = await db
    .from("sales_invoice_items")
    .select("description, quantity, unit, unit_price, amount")
    .eq("invoice_id", inv.id)
    .order("sort_order", { ascending: true });
  const items = (itemsData ?? []) as { description: string; quantity: number; unit: string | null; unit_price: number | null; amount: number }[];
  if (items.length === 0) return NextResponse.json({ error: "發票沒有品項明細" }, { status: 400 });

  // 手機條碼載具先驗證，錯誤訊息比開立失敗更明確
  if (inv.invoice_type === "B2C" && inv.carrier_type === "3J0002" && inv.carrier_id) {
    const check = await callAmego("/json/barcode", { barCode: inv.carrier_id }, creds);
    if (check.code !== 0) {
      return NextResponse.json({ error: `手機條碼 ${inv.carrier_id} 驗證失敗：${check.msg || "格式不正確"}` }, { status: 400 });
    }
  }

  const amegoOrderId = buildAmegoOrderId(inv);
  const payload = buildIssuePayload({
    orderId: amegoOrderId,
    invoiceType: inv.invoice_type,
    taxType: inv.tax_type,
    buyerTaxId: inv.buyer_tax_id,
    buyerName: inv.buyer_name,
    buyerEmail: inv.buyer_email,
    carrierType: inv.carrier_type,
    carrierId: inv.carrier_id,
    donationCode: inv.donation_code,
    notes: inv.notes,
    items,
  });
  const res = await callAmego("/json/f0401", payload, creds);

  if (res.code !== 0) {
    await db
      .from("sales_invoices")
      .update({ sync_status: "failed", sync_error: amegoError(res), synced_at: new Date().toISOString() })
      .eq("id", inv.id);
    return NextResponse.json({ error: amegoError(res) }, { status: 502 });
  }

  const invoiceNumber = String(res.invoice_number ?? "");
  const invoiceDate = typeof res.invoice_time === "number" ? timestampToTaipeiDate(res.invoice_time) : new Date().toISOString().slice(0, 10);
  const { error: updErr } = await db
    .from("sales_invoices")
    .update({
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      status: "issued",
      issued_at: new Date().toISOString(),
      sync_status: "confirmed",
      synced_at: new Date().toISOString(),
      sync_error: null,
      external_id: amegoOrderId,
    })
    .eq("id", inv.id);
  if (updErr) {
    // 光賀已開立但本地回寫失敗：務必讓前端知道號碼，避免重複開立
    console.error("[amego] 回寫失敗，發票已開立:", invoiceNumber, updErr);
    return NextResponse.json(
      { error: `發票 ${invoiceNumber} 已於光賀開立，但系統回寫失敗，請手動填入號碼：${updErr.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    random_number: res.random_number ?? "",
    environment: creds.environment,
  });
}

/** 作廢發票（f0501），限已由光賀開立者 */
async function handleVoid(db: SupabaseClient, invoiceId: string, body: Record<string, unknown>) {
  const creds = getAmegoCredentials();
  const inv = await loadInvoice(db, invoiceId);
  if (!inv) return NextResponse.json({ error: "找不到發票" }, { status: 404 });
  if (!inv.invoice_number) return NextResponse.json({ error: "發票尚未取號" }, { status: 400 });
  if (inv.status === "voided") return NextResponse.json({ error: "發票已是作廢狀態" }, { status: 400 });

  // 光賀規則：曾開過折讓單的發票不可作廢（錯誤碼 3050141），先預檢給明確訊息
  const { count: allowanceCount } = await db
    .from("sales_allowances")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", inv.id)
    .is("deleted_at", null);
  if ((allowanceCount ?? 0) > 0) {
    return NextResponse.json({ error: "此發票已開過折讓單，依規定不可作廢" }, { status: 400 });
  }

  const res = await callAmego("/json/f0501", [{ CancelInvoiceNumber: inv.invoice_number }], creds);
  if (res.code !== 0) return NextResponse.json({ error: amegoError(res) }, { status: 502 });

  const voidDate = typeof body.void_date === "string" && body.void_date ? body.void_date : new Date().toISOString().slice(0, 10);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const { error: updErr } = await db
    .from("sales_invoices")
    .update({
      status: "voided",
      void_date: voidDate,
      void_reason: reason || null,
      sync_status: "confirmed",
      synced_at: new Date().toISOString(),
      sync_error: null,
    })
    .eq("id", inv.id);
  if (updErr) {
    return NextResponse.json(
      { error: `發票 ${inv.invoice_number} 已於光賀作廢，但系統回寫失敗：${updErr.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, environment: creds.environment });
}

/** 開立折讓（g0401）：單列折讓，金額未稅＋稅額由含稅回推 */
async function handleAllowance(db: SupabaseClient, invoiceId: string, body: Record<string, unknown>) {
  const creds = getAmegoCredentials();
  const inv = await loadInvoice(db, invoiceId);
  if (!inv) return NextResponse.json({ error: "找不到發票" }, { status: 404 });
  if (!inv.invoice_number || !inv.invoice_date) {
    return NextResponse.json({ error: "發票需已開立（有號碼與日期）才能開折讓" }, { status: 400 });
  }
  const inc = Number(body.amount_inc_tax);
  if (!Number.isFinite(inc) || inc <= 0) return NextResponse.json({ error: "折讓含稅金額無效" }, { status: 400 });

  // 應稅 5% 內含回推；零稅率／免稅稅額 0（與前端 AllowanceDialog 相同邏輯）
  const ex = inv.tax_type === 1 ? Math.round(inc / 1.05) : Math.round(inc);
  const tax = Math.round(inc) - ex;
  const allowanceDate =
    typeof body.allowance_date === "string" && body.allowance_date ? body.allowance_date : new Date().toISOString().slice(0, 10);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  // 折讓單編號：發票號碼-序號（≤16 字），與光賀文件範例同款式
  const { count } = await db
    .from("sales_allowances")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", inv.id);
  const allowanceNumber = `${inv.invoice_number}-${count ?? 0}`;

  const payload = [
    {
      AllowanceNumber: allowanceNumber,
      AllowanceDate: String(dateToYmd(allowanceDate)),
      AllowanceType: "2",
      BuyerIdentifier: inv.invoice_type === "B2B" ? inv.buyer_tax_id ?? "0000000000" : "0000000000",
      BuyerName: inv.buyer_name?.trim() || "客人",
      BuyerAddress: "",
      BuyerTelephoneNumber: "",
      BuyerEmailAddress: inv.buyer_email ?? "",
      ProductItem: [
        {
          OriginalInvoiceDate: dateToYmd(inv.invoice_date),
          OriginalInvoiceNumber: inv.invoice_number,
          OriginalDescription: (reason || "銷貨折讓").slice(0, 256),
          Quantity: 1,
          UnitPrice: ex,
          Amount: ex,
          Tax: tax,
          TaxType: inv.tax_type,
        },
      ],
      TaxAmount: tax,
      TotalAmount: ex,
    },
  ];
  const res = await callAmego("/json/g0401", payload, creds);
  if (res.code !== 0) return NextResponse.json({ error: amegoError(res) }, { status: 502 });

  const { error: insErr } = await db.from("sales_allowances").insert({
    invoice_id: inv.id,
    allowance_number: allowanceNumber,
    allowance_date: allowanceDate,
    amount_ex_tax: ex,
    tax_amount: tax,
    amount_inc_tax: Math.round(inc),
    reason: reason || null,
    status: "issued",
    sync_status: "confirmed",
    synced_at: new Date().toISOString(),
    external_id: allowanceNumber,
  });
  if (insErr) {
    return NextResponse.json(
      { error: `折讓單 ${allowanceNumber} 已於光賀開立，但系統回寫失敗：${insErr.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ allowance_number: allowanceNumber, environment: creds.environment });
}

/** 把光賀端的發票同步回 ERP（核心邏輯在 lib/amego-sync，與排程共用） */
async function handleSync(db: SupabaseClient, body: Record<string, unknown>) {
  try {
    const result = await runAmegoSync(db, Number(body.days) || 60);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '光賀同步失敗';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/** 發票 PDF（invoice_file）：伺服器端代抓後回傳檔案內容，前端可自訂存檔檔名 */
async function handleFile(db: SupabaseClient, invoiceId: string, body: Record<string, unknown>) {
  const creds = getAmegoCredentials();
  const inv = await loadInvoice(db, invoiceId);
  if (!inv) return NextResponse.json({ error: "找不到發票" }, { status: 404 });
  if (!inv.invoice_number) return NextResponse.json({ error: "發票尚未取號" }, { status: 400 });

  const style = Number(body.download_style);
  const res = await callAmego(
    "/json/invoice_file",
    {
      type: "invoice",
      invoice_number: inv.invoice_number,
      ...(Number.isFinite(style) ? { download_style: style } : {}),
    },
    creds,
  );
  if (res.code !== 0) return NextResponse.json({ error: amegoError(res) }, { status: 502 });
  const fileUrl = (res.data as { file_url?: string } | undefined)?.file_url;
  if (!fileUrl) return NextResponse.json({ error: "光賀未回傳檔案連結" }, { status: 502 });

  const pdfRes = await fetch(fileUrl);
  if (!pdfRes.ok) {
    return NextResponse.json({ error: `發票檔案下載失敗（HTTP ${pdfRes.status}）` }, { status: 502 });
  }
  return new NextResponse(await pdfRes.arrayBuffer(), {
    headers: { "Content-Type": "application/pdf" },
  });
}
