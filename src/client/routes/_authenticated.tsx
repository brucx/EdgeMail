import {
  createFileRoute,
  Outlet,
  Link,
  useLocation,
  useNavigate,
  redirect,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  Send,
  Globe,
  Mailbox,
  AtSign,
  Users,
  Settings,
  Mail,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

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

const navItems = [
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/sent", label: "Sent", icon: Send },
  { to: "/domains", label: "Domains", icon: Globe },
  { to: "/mailboxes", label: "Mailboxes", icon: Mailbox },
  { to: "/aliases", label: "Aliases", icon: AtSign },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function AuthenticatedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Proceed with client-side cleanup even if logout API fails
    }
    queryClient.removeQueries({ queryKey: ["auth"] });
    navigate({ to: "/login" });
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[hsl(var(--sidebar-border))]
          bg-[hsl(var(--sidebar-background))] transition-transform duration-200
          lg:static lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-[hsl(var(--sidebar-border))] px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(243,75%,59%)] to-[hsl(262,83%,58%)]">
            <Mail className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">EdgeMail</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                  transition-all duration-150
                  ${
                    isActive
                      ? "bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-primary))] shadow-sm"
                      : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]"
                  }
                `}
              >
                <item.icon className="h-4.5 w-4.5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-[hsl(var(--sidebar-border))] p-3">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[hsl(var(--sidebar-foreground))] transition-colors hover:bg-[hsl(var(--sidebar-accent))]"
          >
            <LogOut className="h-4.5 w-4.5 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="flex h-16 items-center gap-4 border-b border-[hsl(var(--border))] px-6 lg:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-lg font-bold">EdgeMail</span>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
