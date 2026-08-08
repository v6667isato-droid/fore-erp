"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export const COLOR_THEMES = [
  { id: "default", name: "曉雨原色", sidebar: "#2c2418", accent: "#5c4033" },
  { id: "dark", name: "深夜工坊", sidebar: "#141008", accent: "#f0a030" },
  { id: "ink", name: "墨青", sidebar: "#16202e", accent: "#2563a8" },
  { id: "forest", name: "森林", sidebar: "#22301f", accent: "#3d7a34" },
  { id: "mono", name: "紙上極簡", sidebar: "#111111", accent: "#e8940a" },
  { id: "mauve", name: "暖灰紫", sidebar: "#2e2633", accent: "#7c5299" },
] as const;

export type ColorThemeId = (typeof COLOR_THEMES)[number]["id"];

export function isColorThemeId(v: unknown): v is ColorThemeId {
  return typeof v === "string" && COLOR_THEMES.some((t) => t.id === v);
}

/** 套用主題到 <html> 並寫入 localStorage 快取（不含 DB 同步） */
export function applyColorTheme(id: ColorThemeId) {
  const root = document.documentElement;
  if (id === "default") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
  try {
    localStorage.setItem("colorTheme", id);
  } catch {
    /* private mode 等情況忽略 */
  }
}

async function persistThemeToProfile(id: ColorThemeId) {
  if (!isSupabaseConfigured) return;
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    if (!uid) return;
    await supabase.from("user_profiles").update({ theme: id }).eq("user_id", uid);
  } catch {
    /* 離線或未登入時僅存 localStorage */
  }
}

export function ThemeToggle({
  menuDirection = "down",
}: {
  menuDirection?: "up" | "down";
}) {
  const [mounted, setMounted] = useState(false);
  const [colorTheme, setColorTheme] = useState<ColorThemeId>("default");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const attr = document.documentElement.getAttribute("data-theme");
    setColorTheme(isColorThemeId(attr) ? attr : "default");
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  function select(id: ColorThemeId) {
    applyColorTheme(id);
    setColorTheme(id);
    setMenuOpen(false);
    void persistThemeToProfile(id);
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="切換配色">
        <Palette className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="切換配色"
        aria-expanded={menuOpen}
      >
        <Palette className="h-4 w-4" />
      </Button>
      {menuOpen && (
        <div
          className={cn(
            "absolute right-0 z-50 w-44 rounded-md border border-border bg-card p-1 shadow-md",
            menuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"
          )}
        >
          {COLOR_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => select(t.id)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-card-foreground hover:bg-muted"
            >
              <span className="flex shrink-0 items-center gap-1">
                <span
                  className="h-4 w-4 rounded-full border border-border"
                  style={{ backgroundColor: t.sidebar }}
                />
                <span
                  className="h-4 w-4 rounded-full border border-border"
                  style={{ backgroundColor: t.accent }}
                />
              </span>
              <span className="flex-1 text-left">{t.name}</span>
              {colorTheme === t.id && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
