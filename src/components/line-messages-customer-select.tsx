"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

export type LineMessageCustomerOption = { id: string; name: string | null; alias: string | null };

function optionLabel(c: LineMessageCustomerOption): string {
  const alias = c.alias?.trim();
  const name = c.name?.trim();
  if (alias && name && alias !== name) return `${alias}（${name}）`;
  if (alias) return alias;
  if (name) return name;
  return "—";
}

function displaySelected(c: LineMessageCustomerOption | undefined): string {
  if (!c) return "未綁定";
  return optionLabel(c);
}

type PanelPos = { top: number; left: number; width: number };

export function LineMessageCustomerSelect({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: string | null;
  options: LineMessageCustomerOption[];
  onChange: (customerId: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);

  const selected = useMemo(
    () => (value ? options.find((o) => o.id === value) : undefined),
    [value, options]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      const alias = (c.alias ?? "").toLowerCase();
      const combined = `${alias} ${name}`.trim();
      return name.includes(q) || alias.includes(q) || combined.includes(q);
    });
  }, [options, search]);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 260);
    let left = r.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setPanelPos({
      top: r.bottom + 4,
      left,
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onScroll() {
      updatePosition();
    }
    function onResize() {
      updatePosition();
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setSearch("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | PointerEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
      setSearch("");
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const showPanel = open && panelPos && typeof document !== "undefined";

  return (
    <div ref={triggerRef} className="relative min-w-[200px] max-w-[280px]">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className={cn(
          "h-9 w-full justify-between gap-1 px-2 font-normal",
          !value && "text-muted-foreground"
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
      >
        <span className="truncate text-left text-xs">{displaySelected(selected)}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 opacity-50", open && "rotate-180")} aria-hidden />
      </Button>

      {showPanel &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className="fixed z-[200] rounded-lg border border-border bg-card text-card-foreground shadow-lg outline-none"
            style={{
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              maxHeight: "min(320px, calc(100vh - 24px))",
            }}
          >
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  ref={inputRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜尋客戶名稱、別名…"
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  autoComplete="off"
                  aria-label="搜尋客戶"
                />
              </div>
            </div>
            <ScrollArea className="h-[min(240px,calc(100vh-120px))]">
              <ul className="p-1">
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === null}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
                      "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                      value === null && "bg-muted/80"
                    )}
                    onClick={() => {
                      onChange(null);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span className="text-muted-foreground">未綁定</span>
                    {value === null && <Check className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden />}
                  </button>
                </li>
                {filtered.length === 0 ? (
                  <li className="px-2 py-4 text-center text-xs text-muted-foreground">找不到符合的客戶</li>
                ) : (
                  filtered.map((c) => {
                    const selectedRow = value === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedRow}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
                            "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                            selectedRow && "bg-muted/80"
                          )}
                          onClick={() => {
                            onChange(c.id);
                            setOpen(false);
                            setSearch("");
                          }}
                        >
                          <span className="min-w-0 flex-1 break-words leading-snug">{optionLabel(c)}</span>
                          {selectedRow && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </ScrollArea>
          </div>,
          document.body
        )}
    </div>
  );
}
