import { Megaphone } from "lucide-react";
import { epSection } from "@/lib/employee-portal-section-styles";
import { cn } from "@/lib/utils";

export interface CompanyAnnouncementItem {
  id: string;
  title: string;
  body: string;
  published_at: string;
}

export function CompanyAnnouncementsBlock({
  items,
  subtitle,
}: {
  items: CompanyAnnouncementItem[];
  subtitle?: string;
}) {
  return (
    <section className={epSection.card}>
      <div className={epSection.headerRow}>
        <div className={epSection.iconBox}>
          <Megaphone className="h-4 w-4" />
        </div>
        <div>
          <h3 className={epSection.title}>公司公告</h3>
          {subtitle ? <p className={cn("mt-0.5", epSection.subtitle)}>{subtitle}</p> : null}
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
        <ul className="space-y-4 pr-2">
          {items.length === 0 ? (
            <li className="text-sm text-muted-foreground">目前沒有公司公告。</li>
          ) : (
            items.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3.5 transition-colors hover:bg-muted/35"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{a.title}</span>
                  <time className="text-xs tabular-nums text-muted-foreground">{a.published_at}</time>
                </div>
                {a.body ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
