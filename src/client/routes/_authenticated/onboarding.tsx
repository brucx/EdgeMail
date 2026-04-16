import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  ShieldCheck,
  Mailbox,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Copy,
  Check,
  Cloud,
  Loader2,
  XCircle,
} from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type {
  DomainInfo,
  MailboxInfo,
  ApiResponse,
  CloudflareStatusResponse,
  CloudflareZone,
  CloudflareSetupResult,
} from "@shared/types";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

// ─── Setup step definitions for the CF progress indicator ──────────────────

type CfStepKey = keyof CloudflareSetupResult["steps"];
const CF_SETUP_STEPS: { key: CfStepKey; label: string }[] = [
  { key: "dns_mx", label: "Create MX record" },
  { key: "dns_spf", label: "Create SPF record" },
  { key: "routing_enable", label: "Enable Email Routing" },
  { key: "routing_catchall", label: "Configure catch-all rule" },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Shared state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [domainName, setDomainName] = useState("");
  const [domainId, setDomainId] = useState("");
  const [domainData, setDomainData] = useState<
    (DomainInfo & { dnsInstructions?: Record<string, unknown> }) | null
  >(null);
  const [mailboxLocal, setMailboxLocal] = useState("");
  const [mailboxDisplayName, setMailboxDisplayName] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // ── Track which onboarding mode we're in ──────────────────────────────
  // "choose" = initial choice screen, "cf" = cloudflare flow, "manual" = manual flow
  const [mode, setMode] = useState<"choose" | "cf" | "manual">("choose");

  // ── Cloudflare status check ───────────────────────────────────────────
  const { data: cfStatus, isLoading: cfStatusLoading } = useQuery({
    queryKey: ["cloudflare", "status"],
    queryFn: () => api.get<CloudflareStatusResponse>("/cloudflare/status"),
  });

  const cfAvailable = cfStatus?.connected === true;

  // ── CF zone list ──────────────────────────────────────────────────────
  const { data: zonesData, isLoading: zonesLoading } = useQuery({
    queryKey: ["cloudflare", "zones"],
    queryFn: () => api.get<{ data: CloudflareZone[] }>("/cloudflare/zones"),
    enabled: mode === "cf",
  });

  // ── CF setup mutation ─────────────────────────────────────────────────
  const cfSetupMutation = useMutation({
    mutationFn: (params: {
      zoneId: string;
      domainName: string;
      forceOverwrite?: boolean;
    }) =>
      api.post<ApiResponse<CloudflareSetupResult>>(`/cloudflare/zones/${params.zoneId}/setup`, {
        domainName: params.domainName,
        forceOverwrite: params.forceOverwrite || undefined,
      }),
    onSuccess: (result) => {
      if (result.data) {
        setDomainId(result.data.domainId);
        setError("");
        queryClient.invalidateQueries({ queryKey: ["domains"] });
        queryClient.invalidateQueries({ queryKey: ["cloudflare", "zones"] });
        // Move to mailbox creation step
        setStep(1);
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  // ── Manual flow mutations ─────────────────────────────────────────────
  const createDomainMutation = useMutation({
    mutationFn: (domain: string) =>
      api.post<ApiResponse<DomainInfo>>("/domains", { domain }),
    onSuccess: async (result) => {
      const id = result.data!.id;
      setDomainId(id);
      setError("");
      const detail = await api.get<{
        data: DomainInfo & { dnsInstructions?: Record<string, unknown> };
      }>(`/domains/${id}`);
      setDomainData(detail.data);
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      setStep(1);
    },
    onError: (err: Error) => setError(err.message),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/domains/${domainId}/verify`, {
        method: "POST",
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const details = body?.details as Record<string, string> | undefined;
        const hint =
          details?.hint || (body?.error as string) || "Verification failed";
        throw new Error(hint);
      }
      return body;
    },
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      setStep(3);
    },
    onError: (err: Error) => setError(err.message),
  });

  // ── Create mailbox (shared by both flows) ─────────────────────────────
  const createMailboxMutation = useMutation({
    mutationFn: (input: {
      address: string;
      domainId: string;
      displayName: string;
      canSend: boolean;
    }) => api.post<ApiResponse<MailboxInfo>>("/mailboxes", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      navigate({ to: "/d/$domainId/inbox", params: { domainId } });
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSelectZone = (zone: CloudflareZone) => {
    setDomainName(zone.name);
    setError("");
    cfSetupMutation.mutate({
      zoneId: zone.id,
      domainName: zone.name,
      forceOverwrite: true,
    });
  };

  // ── CF flow: compute if setup completed ───────────────────────────────
  const cfSetupComplete =
    cfSetupMutation.isSuccess &&
    cfSetupMutation.data?.data?.steps &&
    Object.values(cfSetupMutation.data.data.steps).every(
      (s) => s === "success" || s === "skipped",
    );

  // ── Progress indicators ───────────────────────────────────────────────
  const cfSteps = [
    { label: "Select Domain", icon: Cloud },
    { label: "Create Mailbox", icon: Mailbox },
  ];

  const manualSteps = [
    { label: "Add Domain", icon: Globe },
    { label: "Configure DNS", icon: ShieldCheck },
    { label: "Verify MX", icon: CheckCircle },
    { label: "Create Mailbox", icon: Mailbox },
  ];

  const currentSteps = mode === "cf" ? cfSteps : manualSteps;

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-full items-center justify-center bg-[hsl(var(--accent))] p-8">
      <div className="w-full max-w-lg">
        {/* ─── Mode: Choose ─────────────────────────────────────────── */}
        {mode === "choose" && (
          <div className="rounded-2xl bg-[hsl(var(--card))] p-8 shadow-sm">
            <div className="mb-6 text-center">
              <Globe className="mx-auto mb-3 h-10 w-10 text-[hsl(var(--primary))]" />
              <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                Set Up Your Domain
              </h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                Choose how you'd like to add your first domain.
              </p>
            </div>

            <div className="space-y-3">
              {/* Cloudflare import option */}
              {cfStatusLoading ? (
                <div className="flex items-center justify-center rounded-xl bg-[hsl(var(--accent))] p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--outline))]" />
                </div>
              ) : cfAvailable ? (
                <button
                  onClick={() => setMode("cf")}
                  className="flex w-full items-center gap-4 rounded-xl bg-[hsl(var(--accent))] p-4 text-left transition-all hover:bg-[hsl(var(--input))] hover:shadow-sm"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl gradient-primary">
                    <Cloud className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">Import from Cloudflare</p>
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      Select a domain and auto-configure DNS & Email Routing in one click.
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(var(--outline))]" />
                </button>
              ) : null}

              {/* Manual option */}
              <button
                onClick={() => setMode("manual")}
                className="flex w-full items-center gap-4 rounded-xl bg-[hsl(var(--accent))] p-4 text-left transition-all hover:bg-[hsl(var(--input))] hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))]">
                  <Globe className="h-5 w-5 text-[hsl(var(--primary))]" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Add Manually</p>
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    Enter your domain and configure DNS records yourself.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(var(--outline))]" />
              </button>
            </div>
          </div>
        )}

        {/* ─── Mode: CF or Manual — show progress + steps ───────────── */}
        {mode !== "choose" && (
          <>
            {/* Progress bar */}
            <div className="mb-8 flex items-center justify-center gap-2">
              {currentSteps.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      i <= step
                        ? "gradient-primary text-white"
                        : "bg-[hsl(var(--muted))] text-[hsl(var(--outline))]"
                    }`}
                  >
                    {i < step ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  {i < currentSteps.length - 1 && (
                    <div
                      className={`h-px w-8 transition-colors ${
                        i < step
                          ? "bg-[hsl(var(--primary))]"
                          : "bg-[hsl(var(--outline-variant))]"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-2xl bg-[hsl(var(--card))] p-8 shadow-sm">
              {/* ─── CF Flow: Step 0 — Select zone ──────────────────── */}
              {mode === "cf" && step === 0 && !cfSetupMutation.isPending && !cfSetupComplete && (
                <>
                  <div className="mb-6 text-center">
                    <Cloud className="mx-auto mb-3 h-10 w-10 text-[hsl(var(--primary))]" />
                    <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                      Select a Domain
                    </h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      Choose a domain from your Cloudflare account.
                    </p>
                  </div>

                  {zonesLoading && (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
                    </div>
                  )}

                  {!zonesLoading &&
                    (!zonesData?.data || zonesData.data.length === 0) && (
                      <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                        No active domains found in your Cloudflare account.
                      </div>
                    )}

                  {!zonesLoading &&
                    zonesData?.data &&
                    zonesData.data.length > 0 && (
                      <div className="max-h-64 space-y-2 overflow-y-auto custom-scrollbar">
                        {zonesData.data
                          .filter((z) => !z.linked)
                          .map((zone) => (
                            <button
                              key={zone.id}
                              onClick={() => handleSelectZone(zone)}
                              className="flex w-full items-center justify-between rounded-xl bg-[hsl(var(--accent))] p-3 text-left transition-all hover:bg-[hsl(var(--input))] hover:shadow-sm"
                            >
                              <div className="flex items-center gap-3">
                                <Globe className="h-4 w-4 text-[hsl(var(--primary))]" />
                                <span className="text-sm font-medium">
                                  {zone.name}
                                </span>
                              </div>
                              <ArrowRight className="h-4 w-4 text-[hsl(var(--outline))]" />
                            </button>
                          ))}
                      </div>
                    )}

                  {error && (
                    <p className="mt-3 text-sm text-[hsl(var(--destructive))]">
                      {error}
                    </p>
                  )}

                  <button
                    onClick={() => {
                      setMode("manual");
                      setStep(0);
                      setError("");
                    }}
                    className="mt-4 w-full text-center text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
                  >
                    Or add domain manually
                  </button>
                </>
              )}

              {/* ─── CF Flow: Step 0 — Setup in progress ────────────── */}
              {mode === "cf" && step === 0 && cfSetupMutation.isPending && (
                <>
                  <div className="mb-6 text-center">
                    <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-[hsl(var(--primary))]" />
                    <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                      Configuring {domainName}
                    </h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      Setting up DNS records and Email Routing...
                    </p>
                  </div>
                  <div className="space-y-3">
                    {CF_SETUP_STEPS.map((s) => (
                      <div
                        key={s.key}
                        className="flex items-center gap-3 rounded-lg px-3 py-2"
                      >
                        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--outline))]" />
                        <span className="text-sm text-[hsl(var(--muted-foreground))]">
                          {s.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ─── CF Flow: Step 0 — Setup failed ─────────────────── */}
              {mode === "cf" && step === 0 && cfSetupMutation.isError && (
                <>
                  <div className="mb-6 text-center">
                    <XCircle className="mx-auto mb-3 h-10 w-10 text-[hsl(var(--destructive))]" />
                    <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                      Setup Failed
                    </h2>
                    <p className="mt-2 text-sm text-[hsl(var(--destructive))]">
                      {error}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setError("");
                        cfSetupMutation.reset();
                      }}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl gradient-primary py-3 text-sm font-semibold text-white"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => {
                        setMode("manual");
                        setStep(0);
                        setError("");
                        cfSetupMutation.reset();
                      }}
                      className="flex-1 rounded-xl py-3 text-center text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))]"
                    >
                      Add Manually
                    </button>
                  </div>
                </>
              )}

              {/* ─── CF Flow: Step 0 → auto-advance to Step 1 ────────── */}
              {mode === "cf" && step === 0 && cfSetupComplete && (
                // Auto-advance: show brief success then go to mailbox step
                <CfSuccessAutoAdvance
                  domainName={domainName}
                  onNext={() => setStep(1)}
                />
              )}

              {/* ─── Manual Flow: Step 0 — Enter domain ─────────────── */}
              {mode === "manual" && step === 0 && (
                <>
                  <div className="mb-6 text-center">
                    <Globe className="mx-auto mb-3 h-10 w-10 text-[hsl(var(--primary))]" />
                    <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                      Add Your Domain
                    </h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      Enter the domain you want to receive emails on.
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createDomainMutation.mutate(domainName);
                    }}
                  >
                    <input
                      type="text"
                      value={domainName}
                      onChange={(e) => setDomainName(e.target.value)}
                      placeholder="example.com"
                      className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                    />
                    {error && (
                      <p className="mt-2 text-sm text-[hsl(var(--destructive))]">
                        {error}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={
                        createDomainMutation.isPending || !domainName
                      }
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl gradient-primary py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                    >
                      {createDomainMutation.isPending
                        ? "Adding..."
                        : "Continue"}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </form>
                </>
              )}

              {/* ─── Manual Flow: Step 1 — DNS Instructions ─────────── */}
              {mode === "manual" && step === 1 && (
                <>
                  <div className="mb-6 text-center">
                    <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-[hsl(var(--primary))]" />
                    <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                      Configure DNS
                    </h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      Add these records to your domain's DNS settings.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {[
                      { host: "route1.mx.cloudflare.net", pri: 36 },
                      { host: "route2.mx.cloudflare.net", pri: 84 },
                      { host: "route3.mx.cloudflare.net", pri: 12 },
                    ].map((mx) => (
                      <div key={mx.host} className="rounded-xl bg-[hsl(var(--accent))] p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--outline))]">
                            MX Record
                          </span>
                          <button
                            onClick={() => handleCopy(mx.host, mx.host)}
                            className="rounded p-1 hover:bg-[hsl(var(--muted))]"
                          >
                            {copied === mx.host ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 text-[hsl(var(--outline))]" />
                            )}
                          </button>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p>
                            <span className="text-[hsl(var(--outline))]">Type:</span> MX
                          </p>
                          <p>
                            <span className="text-[hsl(var(--outline))]">Name:</span>{" "}
                            {domainName}
                          </p>
                          <p>
                            <span className="text-[hsl(var(--outline))]">Value:</span>{" "}
                            <code className="rounded bg-[hsl(var(--card))] px-1.5 py-0.5 text-xs font-mono">
                              {mx.host}
                            </code>
                          </p>
                          <p>
                            <span className="text-[hsl(var(--outline))]">Priority:</span>{" "}
                            {mx.pri}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setStep(2)}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl gradient-primary py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
                  >
                    I've configured DNS
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              )}

              {/* ─── Manual Flow: Step 2 — Verify MX ────────────────── */}
              {mode === "manual" && step === 2 && (
                <>
                  <div className="mb-6 text-center">
                    <CheckCircle className="mx-auto mb-3 h-10 w-10 text-[hsl(var(--primary))]" />
                    <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                      Verify MX Records
                    </h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      Click below to verify your MX records are configured
                      correctly.
                    </p>
                  </div>
                  {error && (
                    <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        {error}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setError("");
                      verifyMutation.mutate();
                    }}
                    disabled={verifyMutation.isPending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl gradient-primary py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                  >
                    {verifyMutation.isPending
                      ? "Verifying..."
                      : "Verify MX Records"}
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="mt-3 w-full text-center text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
                  >
                    Skip for now
                  </button>
                </>
              )}

              {/* ─── Shared: Create Mailbox ─────────────────────────── */}
              {/* CF flow step 1, Manual flow step 3 */}
              {((mode === "cf" && step === 1) ||
                (mode === "manual" && step === 3)) && (
                <>
                  <div className="mb-6 text-center">
                    <Mailbox className="mx-auto mb-3 h-10 w-10 text-[hsl(var(--primary))]" />
                    <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
                      Create Your First Mailbox
                    </h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      Set up an email address to start receiving emails.
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createMailboxMutation.mutate({
                        address: `${mailboxLocal}@${domainName}`,
                        domainId,
                        displayName: mailboxDisplayName,
                        canSend: true,
                      });
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={mailboxDisplayName}
                        onChange={(e) =>
                          setMailboxDisplayName(e.target.value)
                        }
                        placeholder="John Doe"
                        className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                        Email Address
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={mailboxLocal}
                          onChange={(e) => setMailboxLocal(e.target.value)}
                          placeholder="admin"
                          className="flex-1 rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                        />
                        <span className="text-sm text-[hsl(var(--outline))]">
                          @{domainName}
                        </span>
                      </div>
                    </div>
                    {error && (
                      <p className="text-sm text-[hsl(var(--destructive))]">
                        {error}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={
                        createMailboxMutation.isPending ||
                        !mailboxLocal ||
                        !mailboxDisplayName
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-xl gradient-primary py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                    >
                      {createMailboxMutation.isPending
                        ? "Creating..."
                        : "Create & Go to Inbox"}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </form>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Mini component: auto-advance after CF setup success ────────────────────

function CfSuccessAutoAdvance({
  domainName,
  onNext,
}: {
  domainName: string;
  onNext: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onNext, 1200);
    return () => clearTimeout(timer);
  }, [onNext]);

  return (
    <div className="text-center">
      <CheckCircle className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
      <h2 className="font-[family-name:var(--font-headline)] text-xl font-bold">
        {domainName} is Ready
      </h2>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        DNS and Email Routing configured successfully.
      </p>
    </div>
  );
}
