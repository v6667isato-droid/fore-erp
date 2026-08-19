"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { epSection } from "@/lib/employee-portal-section-styles";
import {
  checkinSourceLabel,
  checkinTypeLabel,
  taipeiHmOfIso,
  type CheckinType,
  type PortalCheckinScope,
} from "@/lib/attendance-checkin";
import { getSupabaseSession, isSupabaseConfigured } from "@/lib/supabase";

/**
 * 員工儀表板線上打卡卡片（attendance_logs, source='portal'）。
 * 開放範圍由 app_settings.portal_checkin_scope 控制（off／admin 測試／all）；
 * 未開放或 Mock 模式時整張卡不渲染。測試期資料僅作補卡審核佐證，不進月底出勤統計。
 */

type CheckinLog = {
  check_type: string;
  distance_meters: number;
  source: string;
  created_at: string;
};

type CheckinStatus = {
  scope: PortalCheckinScope;
  allowed: boolean;
  logs: CheckinLog[];
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await getSupabaseSession();
  return session?.access_token ?? null;
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("此瀏覽器不支援定位"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  });
}

function geolocationErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as GeolocationPositionError).code;
    if (code === 1) return "定位權限被拒絕，請允許瀏覽器取得位置後再打卡";
    if (code === 2) return "無法取得目前位置，請確認裝置定位已開啟";
    if (code === 3) return "定位逾時，請重試";
  }
  return e instanceof Error ? e.message : "無法取得定位";
}

export function EmployeeCheckinCard({
  showAdminFieldHints,
}: {
  showAdminFieldHints: boolean;
}) {
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [punching, setPunching] = useState<CheckinType | null>(null);

  const loadStatus = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch("/api/employee/check-in", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as {
        ok?: boolean;
        scope?: PortalCheckinScope;
        allowed?: boolean;
        logs?: CheckinLog[];
      };
      if (!json.ok) return;
      setStatus({
        scope: json.scope ?? "off",
        allowed: json.allowed === true,
        logs: json.logs ?? [],
      });
    } catch (e) {
      console.warn("[employee-checkin-card] status:", e);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function punch(type: CheckinType) {
    if (punching) return;
    setPunching(type);
    try {
      let pos: GeolocationPosition;
      try {
        pos = await getCurrentPosition();
      } catch (e) {
        toast.error(geolocationErrorMessage(e));
        return;
      }
      const token = await getAccessToken();
      if (!token) {
        toast.error("登入已失效，請重新登入");
        return;
      }
      const res = await fetch("/api/employee/check-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          check_type: type,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        warning?: string;
        error?: string;
        distance_meters?: number;
        logs?: CheckinLog[];
      };
      if (json.ok) {
        toast.success(
          `${type === "in" ? "上班" : "下班"}打卡成功（距廠區 ${json.distance_meters ?? "?"} 公尺）`,
        );
        if (json.logs) {
          setStatus((s) => (s ? { ...s, logs: json.logs! } : s));
        } else {
          void loadStatus();
        }
      } else {
        toast.error(json.warning ?? json.error ?? "打卡失敗");
      }
    } catch (e) {
      console.warn("[employee-checkin-card] punch:", e);
      toast.error("打卡失敗，請確認網路後重試");
    } finally {
      setPunching(null);
    }
  }

  if (!isSupabaseConfigured || !status?.allowed) return null;

  return (
    <section className={epSection.card}>
      <div className={cn(epSection.headerRowBetween, "sm:items-start")}>
        <div className="flex items-center gap-2">
          <div className={epSection.iconBox}>
            <MapPin className="h-4 w-4" />
          </div>
          <div>
            <h3 className={epSection.title}>
              線上打卡
              {status.scope === "admin" ? (
                <span className="ml-2 inline-flex items-center rounded-full border border-amber-600/40 bg-amber-100/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
                  測試中
                </span>
              ) : null}
            </h3>
            {showAdminFieldHints ? (
              <p className={cn("mt-0.5", epSection.subtitle)}>
                attendance_logs · source=portal · 限廠區 100 公尺內；測試期不進月底出勤統計
              </p>
            ) : (
              <p className={cn("mt-0.5", epSection.subtitle)}>
                需在廠區 100 公尺內，並允許瀏覽器取得定位。
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
          <Button
            type="button"
            className="gap-1.5"
            disabled={punching != null}
            onClick={() => void punch("in")}
          >
            {punching === "in" ? "定位中…" : "上班打卡"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={punching != null}
            onClick={() => void punch("out")}
          >
            {punching === "out" ? "定位中…" : "下班打卡"}
          </Button>
        </div>
      </div>
      <div className="mt-1">
        {status.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">今日尚無線上打卡紀錄。</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {status.logs.map((log, i) => (
              <li
                key={`${log.created_at}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-foreground"
              >
                <span className="font-medium">{checkinTypeLabel(log.check_type)}</span>
                <span className="tabular-nums">{taipeiHmOfIso(log.created_at)}</span>
                <span className="text-muted-foreground">
                  · {checkinSourceLabel(log.source)} · 距廠區{" "}
                  {Math.round(Number(log.distance_meters))}m
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
