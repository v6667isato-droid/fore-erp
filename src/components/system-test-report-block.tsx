"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bug, Loader2 } from "lucide-react";

/**
 * 員工儀表板「系統測試回報」：主旨＋問題描述，回報人自動帶入員工姓名，
 * 寫入 user_feedback（類別固定「系統測試」），於後台「使用回饋」頁統一追蹤。
 */
export function SystemTestReportBlock({
  employeeName,
  sectionClassName,
  headerRowClassName,
  iconBoxClassName,
  titleClassName,
  subtitle,
}: {
  employeeName: string;
  sectionClassName: string;
  headerRowClassName: string;
  iconBoxClassName: string;
  titleClassName: string;
  subtitle?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const t = title.trim();
    const d = description.trim();
    if (!t) {
      toast.error("請填寫主旨");
      return;
    }
    if (!d) {
      toast.error("請填寫問題描述");
      return;
    }
    if (!isSupabaseConfigured) {
      toast.error("尚未連線資料庫，無法送出回報");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("user_feedback").insert({
        category: "系統測試",
        title: t,
        description: d,
        reporter: employeeName.trim() || null,
        status: "待處理",
      });
      if (error) {
        toast.error(error.message || "送出失敗，請稍後再試");
        return;
      }
      toast.success("已送出系統問題回報，感謝！");
      setTitle("");
      setDescription("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={sectionClassName}>
      <div className={headerRowClassName}>
        <div className={iconBoxClassName}>
          <Bug className="h-4 w-4" />
        </div>
        <div>
          <h3 className={titleClassName}>系統測試回報</h3>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="system-test-report-title"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            主旨
          </label>
          <input
            id="system-test-report-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="例如：訂單頁儲存後畫面沒有更新"
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label
            htmlFor="system-test-report-description"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            問題描述
          </label>
          <textarea
            id="system-test-report-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="發生了什麼？在哪個頁面？操作步驟為何？"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            回報人：<span className="text-foreground">{employeeName || "—"}</span>（自動帶入）
          </p>
          <Button type="submit" disabled={submitting} className="gap-1.5">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            送出回報
          </Button>
        </div>
      </form>
    </section>
  );
}
