import { Megaphone } from "lucide-react";
import { epSection } from "@/lib/employee-portal-section-styles";
import { cn } from "@/lib/utils";

export interface CompanyAnnouncementItem {
  id: string;
  title: string;
  body: string;
  published_at: string;
}

function todayIsoDate(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate()
  ).padStart(2, "0")}`;
}

export function CompanyAnnouncementsBlock({
  items,
  subtitle,
}: {
  items: CompanyAnnouncementItem[];
  subtitle?: string;
}) {
  const today = todayIsoDate();
  const list = items.filter((a) => a.published_at >= today);

  return (
    <section className={epSection.card}>
      <div className={cn(epSection.headerRow, "mb-3")}>
        <div className={epSection.iconBox}>
          <Megaphone className="h-4 w-4" />
        </div>
        <div>
          <h3 className={epSection.title}>公司公告</h3>
          {subtitle ? <p className={cn("mt-0.5", epSection.subtitle)}>{subtitle}</p> : null}
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
        {list.length === 0 ? (
          <p className="py-1.5 text-sm text-muted-foreground">近期沒有公司公告。</p>
        ) : (
          <ul className="divide-y divide-border/60 pr-2">
            {list.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-[15px] font-medium text-foreground">{a.title}</span>
                <time className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {a.published_at}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
