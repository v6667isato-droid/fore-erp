"use client";

import { useState, useEffect } from "react";
import {
  ClipboardList,
  LayoutGrid,
  ShoppingCart,
  Menu,
  Package,
  Users,
  LogOut,
  LogIn,
  ExternalLink,
  MessageSquare,
  UserCircle2,
  ClipboardCheck,
  BarChart3,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OrdersPage } from "@/components/orders-page";
import { WorkOrdersPage } from "@/components/work-orders-page";
import { ProcurementPage } from "@/components/procurement-page";
import { ProductsPage } from "@/components/products-page";
import { CustomersPage } from "@/components/customers-page";
import { LeaveApprovalsPage } from "@/components/leave-approvals-page";
import { FeedbackPage } from "@/components/feedback-page";
import { DashboardOverview } from "@/components/dashboard-overview";
import { CompanyCalendarPage } from "@/components/company-calendar-page";
import { CostStatisticsPage } from "@/components/cost-statistics-page";
import { LineMessagesPage } from "@/components/line-messages-page";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  getSupabaseSession,
  isAuthSessionMissingError,
  isLikelySupabaseNetworkError,
  isSupabaseConfigured,
  supabase,
  SUPABASE_CONFIG_HELP,
} from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { isAdminOrManagerRole } from "@/lib/post-login-redirect";

type Page =
  | "dashboard"
  | "quotes"
  | "orders"
  | "kanban"
  | "procurement"
  | "cost_statistics"
  | "products"
  | "customers"
  | "leave_approvals"
  | "feedback"
  | "line_messages";
type AppRole = "admin" | "manager" | "staff" | null;

/** 報價／訂單／產品等：admin 與 manager 可編輯；員工出勤管理（含員工資料分頁）僅 admin */
function isErpEditorRole(role: AppRole): boolean {
  return role === "admin" || role === "manager";
}

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "總覽", icon: LayoutGrid },
  { id: "products", label: "產品資料", icon: Package },
  { id: "customers", label: "客戶資料", icon: Users },
  { id: "line_messages", label: "LINE 訊息", icon: MessageCircle },
  { id: "quotes", label: "報價管理", icon: ClipboardList },
  { id: "orders", label: "訂單管理", icon: ShoppingCart },
  { id: "kanban", label: "生產管理", icon: Package },
  { id: "procurement", label: "採購管理", icon: ShoppingCart },
  { id: "cost_statistics", label: "成本統計", icon: BarChart3 },
  { id: "leave_approvals", label: "員工出勤管理", icon: ClipboardCheck },
  { id: "feedback", label: "使用回饋", icon: MessageSquare },
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

function SidebarNav({
  activePage,
  onNavigate,
  userRole,
}: {
  activePage: Page;
  onNavigate: (page: Page) => void;
  userRole: AppRole;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map((item) => {
        if ((item.id === "leave_approvals" || item.id === "cost_statistics") && userRole !== "admin") {
          return null;
        }
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
        <SidebarNav activePage={activePage} onNavigate={onNavigate} userRole={userRole} />
      </ScrollArea>
      <div className="flex flex-col gap-1 px-3 py-2">
        <a
          href="/employee/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <UserCircle2 className="h-4 w-4" />
          員工儀表板
        </a>
        <a
          href="/portal"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          通路下單
        </a>
      </div>
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-primary">
              {userEmail ? (userEmail[0] ?? "U").toUpperCase() : "?"}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-sidebar-foreground">
                {userRole === "admin"
                  ? "Admin"
                  : userRole === "manager"
                    ? "Manager"
                    : "Staff"}
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

function MobileHeader({
  activePage,
  onNavigate,
  userRole,
}: {
  activePage: Page;
  onNavigate: (page: Page) => void;
  userRole: AppRole;
}) {
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
                  if ((item.id === "leave_approvals" || item.id === "cost_statistics") && userRole !== "admin") {
                    return null;
                  }
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
                <a
                  href="/employee/dashboard"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                >
                  <UserCircle2 className="h-[18px] w-[18px] shrink-0" />
                  員工儀表板
                </a>
                <a
                  href="/portal"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                >
                  <ExternalLink className="h-[18px] w-[18px] shrink-0" />
                  通路下單
                </a>
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

const PAGE_IDS = new Set(navItems.map((i) => i.id));

export default function DashboardShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageParam = searchParams.get("page");
  const [activePage, setActivePage] = useState<Page>(() => {
    if (pageParam === "employees") return "leave_approvals";
    if (pageParam === "vendors") return "procurement";
    if (pageParam === "channels") return "customers";
    if (pageParam === "calendar") return "dashboard";
    if (pageParam === "orders_overview") return "orders";
    return pageParam && PAGE_IDS.has(pageParam as Page)
      ? (pageParam as Page)
      : "dashboard";
  });
  const pageTitle =
    navItems.find((i) => i.id === activePage)?.label ?? "總覽";
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<AppRole>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [externalOrderId, setExternalOrderId] = useState<string | null>(null);

  // 從 URL 同步頁面（例如瀏覽器上一頁 / 開新視窗後重繪時維持在當前頁）
  useEffect(() => {
    const p = searchParams.get("page");
    if (p === "employees") {
      router.replace("/?page=leave_approvals&attendanceTab=employees");
      setActivePage("leave_approvals");
      return;
    }
    if (p === "vendors") {
      router.replace("/?page=procurement&procurementTab=vendors");
      setActivePage("procurement");
      return;
    }
    if (p === "channels") {
      router.replace("/?page=customers&customersTab=channels");
      setActivePage("customers");
      return;
    }
    if (p === "calendar") {
      router.replace("/?page=dashboard");
      setActivePage("dashboard");
      return;
    }
    if (p === "orders_overview") {
      router.replace("/?page=orders");
      setActivePage("orders");
      return;
    }
    if (p && PAGE_IDS.has(p as Page)) setActivePage(p as Page);
  }, [searchParams, router]);

  // 監聽網址 hash，如為 orders:<id>，則切換到訂單頁並記住要自動打開的訂單
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleHashChange() {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      if (!hash.startsWith("orders:")) return;
      const id = decodeURIComponent(hash.slice("orders:".length));
      if (!id) return;
      setExternalOrderId(id);
      setActivePage("orders");
      // 清掉 hash，避免重新整理後又重複觸發
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function onNavigate(page: Page) {
    setActivePage(page);
    router.replace("/?page=" + page);
  }

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      if (!isSupabaseConfigured) {
        if (!cancelled) {
          setAuthError(SUPABASE_CONFIG_HELP);
          setAuthChecked(true);
        }
        return;
      }

      try {
        const {
          data: { session },
          error: sessionErr,
        } = await getSupabaseSession();
        if (cancelled) return;
        if (sessionErr && !isAuthSessionMissingError(sessionErr)) throw sessionErr;

        const user = session?.user ?? null;
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

        if (cancelled) return;

        const raw = ((profile?.role as string) ?? "").trim().toLowerCase();
        if (!isAdminOrManagerRole(raw)) {
          router.replace("/employee/dashboard");
          return;
        }
        let appRole: AppRole;
        if (raw === "admin") appRole = "admin";
        else if (raw === "manager") appRole = "manager";
        else if (raw === "staff" || raw === "") appRole = "staff";
        else appRole = "admin";
        setUserRole(appRole);
        setAuthChecked(true);
      } catch (err) {
        if (cancelled) return;
        console.error("[fore-erp] auth check failed:", err);
        const hint = isLikelySupabaseNetworkError(err)
          ? "無法連線至 Supabase（網路中斷、專案暫停或 URL 錯誤）。請檢查網路與 .env.local，或稍後再試。"
          : err instanceof Error
            ? err.message
            : "登入狀態檢查失敗";
        setAuthError(hint);
        setAuthChecked(true);
      }
    }

    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // 非 admin 不可開員工出勤管理（含書籤或手動改 ?page=）
  useEffect(() => {
    if (!authChecked || userRole === null) return;
    if (
      userRole !== "admin" &&
      (activePage === "leave_approvals" || activePage === "cost_statistics")
    ) {
      setActivePage("dashboard");
      router.replace("/?page=dashboard");
    }
  }, [authChecked, userRole, activePage, router]);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      if (!isAuthSessionMissingError(e)) console.error("[fore-erp] signOut:", e);
    }
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

  if (authError) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-destructive">無法載入 ERP</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{authError}</p>
          <Button type="button" className="w-full" onClick={() => window.location.reload()}>
            重新載入
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <DesktopSidebar
        activePage={activePage}
        onNavigate={onNavigate}
        userEmail={userEmail}
        userRole={userRole}
        onLogout={handleLogout}
      />
      <MobileHeader
        activePage={activePage}
        onNavigate={onNavigate}
        userRole={userRole}
      />

      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          <div className="mb-6 hidden lg:block">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          </div>

          {activePage === "dashboard" && (
            <>
              <DashboardOverview />
              <section className="mt-10 lg:mt-12 pt-8 border-t border-border scroll-mt-6" aria-labelledby="dashboard-calendar-heading">
                <h2
                  id="dashboard-calendar-heading"
                  className="font-serif text-xl font-semibold tracking-tight text-foreground mb-6"
                >
                  行事曆
                </h2>
                <CompanyCalendarPage />
              </section>
            </>
          )}
          {activePage === "quotes" && (
            <OrdersPage
              mode="quotation"
              isAdmin={isErpEditorRole(userRole)}
            />
          )}
          {activePage === "orders" && (
            <OrdersPage
              mode="order"
              isAdmin={isErpEditorRole(userRole)}
              initialOpenOrderId={externalOrderId ?? undefined}
            />
          )}
          {activePage === "kanban" && <WorkOrdersPage />}
          {activePage === "procurement" && (
            <ProcurementPage isAdmin={isErpEditorRole(userRole)} />
          )}
          {activePage === "cost_statistics" && userRole === "admin" && <CostStatisticsPage />}
          {activePage === "line_messages" && <LineMessagesPage />}
          {activePage === "products" && <ProductsPage isAdmin={isErpEditorRole(userRole)} />}
          {activePage === "customers" && <CustomersPage isAdmin={isErpEditorRole(userRole)} />}
          {activePage === "leave_approvals" && userRole === "admin" && (
            <LeaveApprovalsPage />
          )}
          {activePage === "feedback" && <FeedbackPage />}
        </div>
      </main>
    </div>
  );
}
