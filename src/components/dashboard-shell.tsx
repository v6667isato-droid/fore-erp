"use client";

import { useState, useEffect } from "react";
import {
  ClipboardList,
  LayoutGrid,
  ShoppingCart,
  Menu,
  Package,
  TrendingUp,
  Clock,
  Users,
  Building2,
  LogOut,
  LogIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OrdersPage } from "@/components/orders-page";
import { KanbanPage } from "@/components/kanban-page";
import { ProcurementPage } from "@/components/procurement-page";
import { VendorsPage } from "@/components/vendors-page";
import { ProductsPage } from "@/components/products-page";
import { CustomersPage } from "@/components/customers-page";
import { EmployeesPage } from "@/components/employees-page";
import { DashboardOverview } from "@/components/dashboard-overview";
import { dashboardStats } from "@/lib/mock-data";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Page = "dashboard" | "orders" | "kanban" | "procurement" | "vendors" | "products" | "customers" | "employees";
type AppRole = "admin" | "staff" | null;

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "總覽", icon: LayoutGrid },
  { id: "orders", label: "訂單管理", icon: ClipboardList },
  { id: "kanban", label: "生產看板", icon: Package },
  { id: "procurement", label: "採購成本", icon: ShoppingCart },
  { id: "vendors", label: "廠商資料", icon: Building2 },
  { id: "products", label: "產品資料", icon: Package },
  { id: "customers", label: "客戶資料", icon: Users },
  { id: "employees", label: "員工資料", icon: Users },
];

function Logo() {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--sidebar-accent)]">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 21V7l8-4 8 4v14" />
          <path d="M4 21h16" />
          <path d="M12 3v18" />
          <path d="M8 10v4" />
          <path d="M16 10v4" />
        </svg>
      </div>
      <div className="flex flex-col">
        <span className="font-serif text-lg font-semibold tracking-wide text-sidebar-foreground">Fore</span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/60">Furniture</span>
      </div>
    </div>
  );
}

function SidebarNav({ activePage, onNavigate }: { activePage: Page; onNavigate: (page: Page) => void }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activePage === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all",
              isActive ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function DesktopSidebar({
  activePage,
  onNavigate,
  userEmail,
  userRole,
  onLogout,
}: {
  activePage: Page;
  onNavigate: (page: Page) => void;
  userEmail: string | null;
  userRole: AppRole;
  onLogout: () => void;
}) {
  return (
    <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 bg-sidebar border-r border-sidebar-border">
      <div className="flex h-16 items-center px-4">
        <Logo />
      </div>
      <ScrollArea className="flex-1 py-4">
        <SidebarNav activePage={activePage} onNavigate={onNavigate} />
      </ScrollArea>
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-primary">
              {userEmail ? (userEmail[0] ?? "U").toUpperCase() : "?"}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-sidebar-foreground">
                {userRole === "admin" ? "Admin" : "Staff"}
              </span>
              <span className="text-[11px] text-sidebar-foreground/50 truncate">
                {userEmail ?? "尚未登入"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground/80 hover:text-sidebar-primary"
              onClick={onLogout}
              aria-label={userEmail ? "登出" : "前往登入"}
            >
              {userEmail ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader({ activePage, onNavigate }: { activePage: Page; onNavigate: (page: Page) => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const currentLabel = navItems.find((i) => i.id === activePage)?.label ?? "總覽";

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background px-4 lg:hidden">
      {mounted ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-foreground">
              <Menu className="h-5 w-5" />
              <span className="sr-only">開啟選單</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
            <SheetTitle className="sr-only">選單</SheetTitle>
            <div className="flex h-14 items-center px-4">
              <Logo />
            </div>
            <div className="py-4">
              <nav className="flex flex-col gap-1 px-3">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onNavigate(item.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all",
                        isActive ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground">
          <Menu className="h-5 w-5" />
          <span className="sr-only">開啟選單</span>
        </div>
      )}
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <span className="font-serif text-base font-semibold tracking-wide text-foreground truncate">Fore</span>
        <span className="text-muted-foreground shrink-0">|</span>
        <span className="text-sm text-muted-foreground truncate">{currentLabel}</span>
      </div>
      <ThemeToggle />
    </header>
  );
}

function StatsRow() {
  const stats = [
    { label: "生產中訂單", value: dashboardStats.activeOrders, unit: "件", icon: Package },
    { label: "進行中工序", value: dashboardStats.inProgressTasks, unit: "項", icon: TrendingUp },
    { label: "待付訂", value: dashboardStats.pendingPayments, unit: "件", icon: Clock },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="text-xl font-semibold text-foreground">
                {s.value}
                <span className="ml-1 text-sm font-normal text-muted-foreground">{s.unit}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardShell() {
  const [activePage, setActivePage] = useState<Page>("dashboard");
  const pageTitle = navItems.find((i) => i.id === activePage)?.label ?? "總覽";
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<AppRole>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;

      // 若尚未登入，導向 /login，並清空本地狀態
      if (!user) {
        setUserEmail(null);
        setUserRole(null);
        setAuthChecked(true);
        router.replace("/login");
        return;
      }

      setUserEmail(user.email ?? null);
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      const raw = ((profile?.role as string) ?? "").trim().toLowerCase();
      const appRole: AppRole =
        raw === "admin" ? "admin" : raw === "staff" ? "staff" : "staff";
      setUserRole(appRole);
      setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setUserEmail(null);
    setUserRole(null);
    router.push("/login");
  }

  // 尚未確認登入狀態前，先顯示簡單載入畫面，避免閃現內容
  if (!authChecked) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center text-sm text-muted-foreground">
        檢查登入狀態中…
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <DesktopSidebar
        activePage={activePage}
        onNavigate={setActivePage}
        userEmail={userEmail}
        userRole={userRole}
        onLogout={handleLogout}
      />
      <MobileHeader activePage={activePage} onNavigate={setActivePage} />

      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          <div className="mb-6 hidden lg:block">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          </div>

          {activePage === "dashboard" && (
            <div className="mb-6">
              <StatsRow />
            </div>
          )}

          {activePage === "dashboard" && <DashboardOverview />}
          {activePage === "orders" && <OrdersPage />}
          {activePage === "kanban" && <KanbanPage />}
          {activePage === "procurement" && (
            <ProcurementPage onNavigateToVendors={() => setActivePage("vendors")} />
          )}
          {activePage === "vendors" && <VendorsPage />}
          {activePage === "products" && <ProductsPage />}
          {activePage === "customers" && <CustomersPage />}
          {activePage === "employees" && <EmployeesPage />}
        </div>
      </main>
    </div>
  );
}
