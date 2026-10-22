"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { investDb } from "@/lib/invest-client";
import type { InvestMarket } from "@/lib/invest-types";
import { InvestDialog, inputClass, labelClass } from "@/components/investments/invest-ui";

const MARKET_CURRENCY: Record<InvestMarket, string> = { TW: "TWD", US: "USD" };

export function AccountFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [market, setMarket] = useState<InvestMarket>("TW");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("請輸入帳戶名稱");
      return;
    }
    setSaving(true);
    const { error } = await investDb.from("invest_accounts").insert({
      name: name.trim(),
      market,
      currency: MARKET_CURRENCY[market],
      note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(`新增帳戶失敗：${error.message}`);
      return;
    }
    toast.success("已新增帳戶");
    setName("");
    setNote("");
    onOpenChange(false);
    await onSaved();
  }

  return (
    <InvestDialog
      open={open}
      onOpenChange={onOpenChange}
      title="新增帳戶"
      description="每個券商一個帳戶；台股與美股（複委託）請分開建立。"
      footer={
        <>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className={labelClass}>帳戶名稱</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：台股－XX證券"
          />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>市場</span>
          <select className={inputClass} value={market} onChange={(e) => setMarket(e.target.value as InvestMarket)}>
            <option value="TW">台股（台幣）</option>
            <option value="US">美股（美元）</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>備註</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </InvestDialog>
  );
}
