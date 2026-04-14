import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { Globe, Key, Shield, Database, Mail, Cloud } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsLayout,
});

const tabs = [
  { to: "/settings/domains", label: "Domains", icon: Globe },
  { to: "/settings/api-tokens", label: "API Tokens", icon: Key },
  { to: "/settings/profile", label: "Profile", icon: Shield },
  { to: "/settings/resend", label: "Resend", icon: Mail },
  { to: "/settings/cloudflare", label: "Cloudflare", icon: Cloud },
  { to: "/settings/storage", label: "Storage", icon: Database },
] as const;

function SettingsLayout() {
  const location = useLocation();

  return (
    <div className="animate-fade-in flex h-full bg-[hsl(var(--accent))]">
      {/* Tab navigation */}
      <nav className="w-56 shrink-0 border-r border-[hsl(var(--outline-variant))]/10 bg-[hsl(var(--accent))] px-4 py-6">
        <h2 className="mb-4 px-3 font-[family-name:var(--font-headline)] text-xs font-bold uppercase tracking-widest text-[hsl(var(--outline))]">
          Settings
        </h2>
        <div className="space-y-1">
          {tabs.map((tab) => {
            const isActive = location.pathname.startsWith(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm font-semibold"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:translate-x-0.5"
                }`}
              >
                <tab.icon className="h-[18px] w-[18px] shrink-0" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <Outlet />
      </div>
    </div>
  );
}
