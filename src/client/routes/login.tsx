import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Loader2, ArrowRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { LoginInput, ApiResponse, UserInfo, DomainInfo } from "@shared/types";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LoginInput>({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.email.trim()) {
      setError("Email is required");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const result = await api.post<ApiResponse<UserInfo>>(
        "/auth/login",
        form,
      );
      queryClient.setQueryData(["auth", "me"], { data: result.data });

      // Check domains to determine redirect target
      const domainsResult = await api.get<{ data: DomainInfo[] }>("/domains");
      const domains = domainsResult.data ?? [];
      if (domains.length === 0) {
        navigate({ to: "/onboarding" });
      } else {
        navigate({ to: "/d/$domainId/inbox", params: { domainId: domains[0].id } });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-6 selection:bg-[hsl(var(--secondary))]">
      {/* Ambient background blurs */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -right-[5%] -top-[10%] h-[60%] w-[40%] rounded-full bg-[hsl(var(--input))] opacity-40 blur-[120px]" />
        <div className="absolute -bottom-[10%] -left-[5%] h-[50%] w-[35%] rounded-full bg-[hsl(var(--secondary))] opacity-30 blur-[100px]" />
      </div>

      {/* Main container — asymmetric split */}
      <main className="w-full max-w-[1100px] grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden rounded-xl bg-[hsl(var(--accent))] shadow-ambient">
        {/* Left: Editorial branding */}
        <section className="hidden lg:flex lg:col-span-7 flex-col justify-between p-12 gradient-primary relative overflow-hidden">
          <div className="z-10">
            <div className="mb-16 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
                <Mail className="h-5 w-5 text-[hsl(var(--primary))]" />
              </div>
              <span className="font-[family-name:var(--font-headline)] text-2xl font-extrabold tracking-tight text-white">
                EdgeMail
              </span>
            </div>
            <h1 className="font-[family-name:var(--font-headline)] text-5xl font-extrabold tracking-tighter leading-[1.1] text-white mb-6">
              Your domain, <br /> your infrastructure.
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-white/80">
              Open-source email system running at the edge.
              Full control over your domain communications
              with zero vendor lock-in.
            </p>
          </div>

          <div className="z-10 flex gap-8">
            <div className="flex flex-col">
              <span className="font-[family-name:var(--font-headline)] text-3xl font-bold text-white">Open</span>
              <span className="mt-1 text-xs font-semibold uppercase tracking-widest text-white/60">Source</span>
            </div>
            <div className="flex flex-col">
              <span className="font-[family-name:var(--font-headline)] text-3xl font-bold text-white">Edge</span>
              <span className="mt-1 text-xs font-semibold uppercase tracking-widest text-white/60">Native</span>
            </div>
            <div className="flex flex-col">
              <span className="font-[family-name:var(--font-headline)] text-3xl font-bold text-white">Zero</span>
              <span className="mt-1 text-xs font-semibold uppercase tracking-widest text-white/60">Trust</span>
            </div>
          </div>

          {/* Subtle geometric pattern overlay */}
          <div className="absolute inset-0 z-0 opacity-[0.07]">
            <div className="absolute inset-0" style={{
              backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
              backgroundSize: "32px 32px",
            }} />
          </div>
        </section>

        {/* Right: Login form */}
        <section className="col-span-1 lg:col-span-5 bg-[hsl(var(--card))] p-8 md:p-16 flex flex-col justify-center">
          {/* Mobile brand */}
          <div className="mb-10 flex items-center gap-2 lg:hidden">
            <Mail className="h-5 w-5 text-[hsl(var(--primary))]" />
            <span className="font-[family-name:var(--font-headline)] text-xl font-bold tracking-tight text-[hsl(var(--primary))]">
              EdgeMail
            </span>
          </div>

          <div className="w-full max-w-md mx-auto">
            <header className="mb-10">
              <h2 className="font-[family-name:var(--font-headline)] text-3xl font-bold tracking-tight text-[hsl(var(--foreground))] mb-2">
                Welcome Back
              </h2>
              <p className="text-[hsl(var(--muted-foreground))]">
                Sign in to access your admin console.
              </p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="rounded-lg bg-[hsl(var(--destructive))]/5 px-4 py-3 text-sm text-[hsl(var(--destructive))]">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="ml-1 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]"
                >
                  Email
                </label>
                <div className="group relative">
                  <input
                    id="email"
                    type="email"
                    placeholder="admin@yourdomain.com"
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                    disabled={loading}
                    className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-4 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-[hsl(var(--card))] focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="ml-1 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]"
                >
                  Password
                </label>
                <div className="group relative">
                  <input
                    id="password"
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    disabled={loading}
                    className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-4 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-[hsl(var(--card))] focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group flex w-full items-center justify-center gap-2 rounded-xl gradient-primary py-4 font-[family-name:var(--font-headline)] font-bold text-white shadow-lg transition-all hover:shadow-xl active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-12 flex items-center justify-between border-t border-[hsl(var(--border))]/50 pt-8">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold uppercase tracking-tight text-[hsl(var(--muted-foreground))]">
                  System Operational
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
