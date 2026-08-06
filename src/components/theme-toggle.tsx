"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Moon, Palette, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLOR_THEMES = [
  { id: "default", name: "大地棕", swatch: "#5c4033" },
  { id: "forest", name: "墨綠", swatch: "#3d5a3d" },
  { id: "indigo", name: "靛藍", swatch: "#3d5177" },
  { id: "mauve", name: "暖灰紫", swatch: "#6d5570" },
] as const;

export function ThemeToggle({
  menuDirection = "down",
}: {
  menuDirection?: "up" | "down";
}) {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);
  const [colorTheme, setColorTheme] = useState("default");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const root = document.documentElement;
    setDark(root.classList.contains("dark"));
    setColorTheme(root.getAttribute("data-theme") ?? "default");
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

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    setDark(next);
  }

  function applyColorTheme(id: string) {
    if (id === "default") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("colorTheme");
    } else {
      document.documentElement.setAttribute("data-theme", id);
      localStorage.setItem("colorTheme", id);
    }
    setColorTheme(id);
    setMenuOpen(false);
  }

  if (!mounted) {
    return (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="切換配色">
          <Palette className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="切換主題">
          <Sun className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
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
              "absolute right-0 z-50 w-36 rounded-md border border-border bg-card p-1 shadow-md",
              menuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"
            )}
          >
            {COLOR_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyColorTheme(t.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-card-foreground hover:bg-muted"
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: t.swatch }}
                />
                <span className="flex-1 text-left">{t.name}</span>
                {colorTheme === t.id && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={toggle}
        aria-label={dark ? "切換為淺色" : "切換為深色"}
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </div>
  );
}
