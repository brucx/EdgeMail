import {
  createFileRoute,
  Outlet,
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearch,
  redirect,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  Send,
  Mailbox,
  AtSign,
  Users,
  Settings,
  Mail,
  LogOut,
  Menu,
  X,
  Search,
  PenSquare,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { DomainInfo } from "@shared/types";
import { ComposeModal } from "@/components/ComposeModal";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData({
        queryKey: ["auth", "me"],
        queryFn: () => api.get<{ data: any }>("/auth/me"),
      });
    } catch (error) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  // Get current domainId from URL if on a domain-scoped route
  const params = useParams({ strict: false }) as { domainId?: string };
  const urlDomainId = params.domainId;

  // Fetch domains for the switcher
  const { data: domainsData } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.get<{ data: DomainInfo[] }>("/domains"),
  });
  const domains = domainsData?.data ?? [];

  const searchParams = useSearch({ strict: false }) as {
    q?: string;
    folder?: "inbox" | "sent";
  };
  const searchQuery = searchParams.q || "";
  // When viewing a message detail page the URL path is /d/:id/messages/:id so
  // neither /inbox nor /sent is in the pathname. The list views add a
  // `folder=inbox|sent` search param when navigating to the detail so the
  // sidebar can still highlight the originating folder.
  const onMessageDetail = /^\/d\/[^/]+\/messages\/[^/]+/.test(location.pathname);
  const detailFolder = onMessageDetail ? searchParams.folder : undefined;

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value || undefined;
    // `_authenticated` has no search schema, so TanStack Router infers the
    // reducer's `prev`/return as `never`. Widen with `as any` — the runtime
    // merge is shape-safe and the concrete search schema is owned by child
    // routes (e.g. inbox/sent consuming `q`).
    navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, q })) as any,
      replace: true,
    });
  };

  const isSearchablePage =
    location.pathname.endsWith("/inbox") || location.pathname.endsWith("/sent");

  // Track last domain ID so it doesn't clear when navigating to Settings
  const [lastDomainId, setLastDomainId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("edge_mail_last_domain_id");
    } catch {
      return null;
    }
  });

  // Update last domain id when url domain id changes to a valid one
  useEffect(() => {
    if (urlDomainId && urlDomainId !== lastDomainId) {
      setLastDomainId(urlDomainId);
      try {
        localStorage.setItem("edge_mail_last_domain_id", urlDomainId);
      } catch {}
    }
  }, [urlDomainId, lastDomainId]);

  const activeDomainId = urlDomainId || lastDomainId;
  const currentDomainId = domains.some((d) => d.id === activeDomainId) ? activeDomainId : undefined;
  const currentDomain = domains.find((d) => d.id === currentDomainId);

  const handleSignOut = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Proceed with client-side cleanup even if logout API fails
    }
    queryClient.removeQueries({ queryKey: ["auth"] });
    navigate({ to: "/login" });
  };

  const handleDomainSwitch = (newDomainId: string) => {
    navigate({ to: "/d/$domainId/inbox", params: { domainId: newDomainId } });
  };

  // On onboarding page, render full-page without sidebar
  if (location.pathname === "/onboarding") {
    return <Outlet />;
  }

  const domainNavItems = [
    { path: "/d/$domainId/inbox" as const, label: "Inbox", icon: Inbox },
    { path: "/d/$domainId/sent" as const, label: "Sent", icon: Send },
  ];

  const domainManageItems = [
    { path: "/d/$domainId/mailboxes" as const, label: "Mailboxes", icon: Mailbox },
    { path: "/d/$domainId/aliases" as const, label: "Aliases", icon: AtSign },
    { path: "/d/$domainId/groups" as const, label: "Groups", icon: Users },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--background))]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex w-64 flex-col
          bg-[hsl(var(--accent))] transition-transform duration-200
          lg:static lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary">
            <Mail className="h-5 w-5 text-white" />
          </div>
          <span className="font-[family-name:var(--font-headline)] text-lg font-extrabold tracking-tight text-[hsl(var(--primary))]">
            EdgeMail
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto rounded-lg p-1 hover:bg-[hsl(var(--muted))] lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Domain Switcher */}
        {domains.length > 0 && (
          <div className="px-3 pb-2">
            <div className="relative">
              <select
                value={currentDomainId || ""}
                onChange={(e) => handleDomainSwitch(e.target.value)}
                className="w-full appearance-none rounded-lg bg-[hsl(var(--card))] px-3 py-2.5 pr-8 text-sm font-semibold text-[hsl(var(--foreground))] shadow-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20 cursor-pointer"
              >
                {!currentDomainId && (
                  <option value="" disabled>Select domain</option>
                )}
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.domain}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--outline))]" />
            </div>
          </div>
        )}

        {/* Compose button */}
        <div className="px-3 pb-4">
          <button
            onClick={() => setComposeOpen(true)}
            className="flex w-full items-center justify-center gap-3 rounded-xl gradient-primary py-3.5 px-6 text-sm font-semibold text-white shadow-lg shadow-[hsl(var(--primary))]/10 transition-all active:scale-[0.98] hover:shadow-xl"
          >
            <PenSquare className="h-[18px] w-[18px]" />
            <span>Compose</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 overflow-y-auto">
          {/* Domain-scoped nav - mail */}
          {currentDomainId && (
            <>
              {domainNavItems.map((item) => {
                const slug = item.path.split("/").pop(); // "inbox" | "sent"
                const isActive =
                  location.pathname.startsWith(`/d/${currentDomainId}/${slug}`) ||
                  detailFolder === slug;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    params={{ domainId: currentDomainId }}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                      transition-all duration-200
                      ${
                        isActive
                          ? "bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm font-semibold"
                          : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:translate-x-0.5"
                      }
                    `}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    {item.label}
                  </Link>
                );
              })}

              {/* Separator */}
              <div className="my-2 h-px bg-[hsl(var(--outline-variant))]/10 mx-1" />

              {/* Domain-scoped nav - manage */}
              {domainManageItems.map((item) => {
                const isActive = location.pathname.startsWith(`/d/${currentDomainId}/${item.path.split("/").pop()}`);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    params={{ domainId: currentDomainId }}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                      transition-all duration-200
                      ${
                        isActive
                          ? "bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm font-semibold"
                          : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:translate-x-0.5"
                      }
                    `}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="space-y-1 p-3">
          <Link
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              location.pathname.startsWith("/settings")
                ? "bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm font-semibold"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            }`}
          >
            <Settings className="h-[18px] w-[18px] shrink-0" />
            Settings
          </Link>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-all duration-200 hover:bg-[hsl(var(--muted))]"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[hsl(var(--accent))]">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-4 px-8 pt-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 hover:bg-[hsl(var(--accent))] lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-[family-name:var(--font-headline)] text-lg font-bold tracking-tight text-[hsl(var(--primary))] lg:hidden">
            EdgeMail
          </span>

          {/* Search (desktop) */}
          {isSearchablePage && (
            <div className="relative hidden max-w-md flex-1 lg:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--outline))]" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search messages..."
                className="h-10 w-full rounded-xl border-none bg-[hsl(var(--card))] shadow-sm pl-10 pr-4 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--outline))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20 transition-all"
              />
            </div>
          )}
          <div className="ml-auto" />
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <Outlet />
        </div>
      </main>

      {/* Compose Modal */}
      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        domainId={currentDomainId ?? undefined}
      />
    </div>
  );
}
