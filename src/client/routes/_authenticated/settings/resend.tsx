import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Cloud,
  Globe,
  Mail,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import type {
  ApiResponse,
  DomainInfo,
  SendCapabilitiesResponse,
} from "@shared/types";

// URL path kept at /settings/resend for back-compat; the rendered UI is the
// multi-provider "Sending" page.
export const Route = createFileRoute("/_authenticated/settings/resend")({
  component: SendingPage,
});

type SenderProviderValue = "auto" | "cloudflare" | "resend";

function senderProviderOf(d: DomainInfo): SenderProviderValue {
  return d.senderProvider ?? "auto";
}

/** The provider that will actually be used for a domain given its preference
 *  and the current capabilities. Mirrors server-side resolveMailer(). */
function effectiveProvider(
  d: DomainInfo,
  caps: SendCapabilitiesResponse | undefined,
): "cloudflare" | "resend" | "none" {
  const pref = senderProviderOf(d);
  if (pref === "cloudflare") return "cloudflare";
  if (pref === "resend") return "resend";
  // auto
  if (!caps) return "none";
  return caps.defaultProvider;
}

function SendingPage() {
  const queryClient = useQueryClient();

  const domainsQuery = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.get<{ data: DomainInfo[] }>("/domains"),
  });

  const capsQuery = useQuery({
    queryKey: ["send-capabilities"],
    queryFn: () =>
      api.get<{ data: SendCapabilitiesResponse }>("/send/capabilities"),
    staleTime: 60_000,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");

  const updateMutation = useMutation({
    mutationFn: (input: {
      id: string;
      resendApiKey?: string | null;
      senderProvider?: "resend" | "cloudflare" | null;
    }) =>
      api.patch<ApiResponse<DomainInfo>>(`/domains/${input.id}`, {
        ...(input.resendApiKey !== undefined ? { resendApiKey: input.resendApiKey } : {}),
        ...(input.senderProvider !== undefined ? { senderProvider: input.senderProvider } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      queryClient.invalidateQueries({ queryKey: ["send-capabilities"] });
      setEditingId(null);
      setNewKey("");
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const domains = domainsQuery.data?.data ?? [];
  const caps = capsQuery.data?.data;

  return (
    <div className="px-8 py-6">
      <h2 className="mb-2 font-[family-name:var(--font-headline)] text-lg font-bold">
        Email Sending
      </h2>
      <p className="mb-6 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
        Each domain sends outbound mail via one of two providers:{" "}
        <strong>Cloudflare Email Service</strong> (no extra vendor, auto SPF /
        DKIM / DMARC; requires Workers Paid for external recipients) or{" "}
        <strong>Resend</strong> (works on Workers Free; needs an API key).
        Leave a domain on <em>Auto</em> to let EdgeMail pick the first ready
        provider.
      </p>

      <SendingStatusCard caps={caps} loading={capsQuery.isLoading} />

      {domainsQuery.isLoading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-[hsl(var(--primary))]" />
        </div>
      )}

      {!domainsQuery.isLoading && domains.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
          <Mail className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
          <h3 className="font-[family-name:var(--font-headline)] text-lg font-semibold">
            No domains yet
          </h3>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Add a domain under Settings → Domains first.
          </p>
        </div>
      )}

      {!domainsQuery.isLoading && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((domain) => (
            <div
              key={domain.id}
              className="rounded-2xl bg-[hsl(var(--card))] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
                    <Globe className="h-5 w-5 text-[hsl(var(--primary))]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{domain.domain}</p>
                      <DomainOnboardBadge
                        domain={domain}
                        caps={caps}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {domain.resendApiKeyConfigured ? (
                        <>
                          <span className="font-medium text-[hsl(var(--primary))]">
                            Per-domain Resend key
                          </span>
                          {domain.resendApiKeyHint && (
                            <>
                              {" · "}
                              <code className="rounded bg-[hsl(var(--accent))] px-1.5 py-0.5 font-mono">
                                {domain.resendApiKeyHint}
                              </code>
                            </>
                          )}
                        </>
                      ) : (
                        <span>Using global RESEND_API_KEY (when Resend is selected)</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    Provider
                    <select
                      value={senderProviderOf(domain)}
                      onChange={(e) => {
                        const v = e.target.value as SenderProviderValue;
                        updateMutation.mutate({
                          id: domain.id,
                          senderProvider: v === "auto" ? null : v,
                        });
                      }}
                      className="rounded-lg border border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-2 py-1 text-xs font-medium text-[hsl(var(--foreground))] transition-colors focus:border-[hsl(var(--primary))] focus:outline-none"
                    >
                      <option value="auto">Auto</option>
                      <option value="cloudflare">Cloudflare</option>
                      <option value="resend">Resend</option>
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      setEditingId(domain.id);
                      setNewKey("");
                      setError("");
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium transition-colors hover:bg-[hsl(var(--input))]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {domain.resendApiKeyConfigured
                      ? "Replace key"
                      : "Set Resend key"}
                  </button>
                  {domain.resendApiKeyConfigured && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Remove the per-domain Resend key for ${domain.domain}? It will fall back to the global RESEND_API_KEY.`,
                          )
                        ) {
                          updateMutation.mutate({
                            id: domain.id,
                            resendApiKey: null,
                          });
                        }
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--outline))] transition-colors hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
                      title="Clear override"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-ambient">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">
                Set Resend API Key
              </h2>
              <button
                onClick={() => {
                  setEditingId(null);
                  setError("");
                }}
              >
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newKey) return;
                updateMutation.mutate({ id: editingId, resendApiKey: newKey });
              }}
            >
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Resend API Key
              </label>
              <input
                type="password"
                autoComplete="off"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 font-mono text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
              />
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                Stored encrypted. The plaintext is never displayed again after
                saving.
              </p>
              {error && (
                <p className="mt-2 text-sm text-[hsl(var(--destructive))]">
                  {error}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setError("");
                  }}
                  className="h-9 rounded-lg px-4 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending || !newKey}
                  className="h-9 rounded-lg gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                >
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sending Status Card ───────────────────────────────────────────────────

function SendingStatusCard({
  caps,
  loading,
}: {
  caps: SendCapabilitiesResponse | undefined;
  loading: boolean;
}) {
  if (loading || !caps) {
    return (
      <div className="mb-6 h-24 animate-pulse rounded-2xl bg-[hsl(var(--card))]" />
    );
  }

  const cfReady =
    caps.cloudflare.bindingConfigured && caps.cloudflare.accountStatus === "ready";
  const cfGated =
    caps.cloudflare.bindingConfigured && caps.cloudflare.accountStatus === "gated";
  const resendReady = caps.resend.globalConfigured || caps.resend.perDomainKeys > 0;

  const nothingReady = !cfReady && !resendReady;

  return (
    <div className="mb-6 space-y-3">
      {/* Top-level "nothing works" banner */}
      {nothingReady && (
        <div className="flex gap-3 rounded-2xl border border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/5 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-[hsl(var(--destructive))]" />
          <div className="text-sm">
            <p className="font-semibold text-[hsl(var(--destructive))]">
              No outbound provider is ready to send.
            </p>
            <p className="mt-1 text-[hsl(var(--muted-foreground))]">
              {cfGated
                ? "Cloudflare Email Service is not available on this account (likely Workers Free). Either upgrade to Workers Paid, or set a Resend API key below."
                : "Set up Cloudflare Email Service (uncomment the send_email binding + upgrade to Workers Paid if needed), or register a Resend account and set RESEND_API_KEY or a per-domain key."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="https://dash.cloudflare.com/?to=/:account/workers/plans"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 text-xs font-semibold text-white hover:opacity-90"
              >
                <Cloud className="h-3.5 w-3.5" />
                Upgrade to Workers Paid
              </a>
              <a
                href="https://resend.com/signup"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[hsl(var(--outline-variant))] bg-[hsl(var(--card))] px-3 text-xs font-semibold hover:bg-[hsl(var(--accent))]"
              >
                <Mail className="h-3.5 w-3.5" />
                Sign up for Resend
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Provider status grid */}
      <div className="grid gap-3 md:grid-cols-2">
        <ProviderTile
          icon={<Cloud className="h-5 w-5" />}
          title="Cloudflare Email Service"
          status={
            !caps.cloudflare.bindingConfigured
              ? "offline"
              : caps.cloudflare.accountStatus === "ready"
                ? "ready"
                : caps.cloudflare.accountStatus === "gated"
                  ? "gated"
                  : "unknown"
          }
          message={
            !caps.cloudflare.bindingConfigured
              ? "send_email binding is not bound. Uncomment it in wrangler.jsonc to enable."
              : caps.cloudflare.message
          }
          details={
            caps.cloudflare.configuredDomains &&
            caps.cloudflare.configuredDomains.length > 0
              ? `Onboarded: ${caps.cloudflare.configuredDomains.join(", ")}`
              : undefined
          }
          actionHref={
            caps.cloudflare.accountStatus === "gated"
              ? "https://dash.cloudflare.com/?to=/:account/workers/plans"
              : caps.cloudflare.bindingConfigured
                ? "https://dash.cloudflare.com/?to=/:account/email-service/sending"
                : undefined
          }
          actionLabel={
            caps.cloudflare.accountStatus === "gated"
              ? "Upgrade to Workers Paid"
              : caps.cloudflare.bindingConfigured
                ? "Manage in dashboard"
                : undefined
          }
        />
        <ProviderTile
          icon={<Mail className="h-5 w-5" />}
          title="Resend"
          status={resendReady ? "ready" : "offline"}
          message={
            resendReady
              ? [
                  caps.resend.globalConfigured ? "Global API key set." : null,
                  caps.resend.perDomainKeys > 0
                    ? `${caps.resend.perDomainKeys} per-domain override${caps.resend.perDomainKeys === 1 ? "" : "s"}.`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : "No Resend API key. Set RESEND_API_KEY on the Worker or configure a per-domain key below."
          }
          actionHref={!resendReady ? "https://resend.com/signup" : undefined}
          actionLabel={!resendReady ? "Sign up for Resend" : undefined}
        />
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Auto-pick default: <strong>{caps.defaultProvider}</strong>. Override
        per-domain with the dropdown below.
      </p>
    </div>
  );
}

// ─── Per-domain onboarding badge ────────────────────────────────────────────

function DomainOnboardBadge({
  domain,
  caps,
}: {
  domain: DomainInfo;
  caps: SendCapabilitiesResponse | undefined;
}) {
  // Only meaningful when this domain will actually send via Cloudflare.
  const effective = effectiveProvider(domain, caps);
  if (effective !== "cloudflare") return null;
  const status = caps?.cloudflare.domainStatus?.find((d) => d.domain === domain.domain);
  if (!status) return null;
  if (status.onboarded) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        Onboarded
      </Badge>
    );
  }
  return (
    <Badge
      variant="destructive"
      title="No cf-bounce._domainkey TXT record found. Outbound mail will be DKIM-signed by the shared cloudflare-email.com key and fail DMARC alignment — most receivers (QQ, Outlook, strict Gmail) will reject or flag it. Onboard this domain at Cloudflare → Email Service → Email Sending → Domains."
    >
      <AlertTriangle className="h-3 w-3" />
      Not onboarded
    </Badge>
  );
}

type TileStatus = "ready" | "offline" | "gated" | "unknown";

function ProviderTile({
  icon,
  title,
  status,
  message,
  details,
  actionHref,
  actionLabel,
}: {
  icon: React.ReactNode;
  title: string;
  status: TileStatus;
  message: string;
  details?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const badge = {
    ready: (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </Badge>
    ),
    offline: (
      <Badge variant="outline" className="text-[hsl(var(--muted-foreground))]">
        Offline
      </Badge>
    ),
    gated: (
      <Badge variant="destructive">
        <AlertTriangle className="h-3 w-3" />
        Paid plan required
      </Badge>
    ),
    unknown: (
      <Badge variant="outline">
        <CircleHelp className="h-3 w-3" />
        Unknown
      </Badge>
    ),
  }[status];

  return (
    <div className="rounded-2xl bg-[hsl(var(--card))] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <span className="text-[hsl(var(--primary))]">{icon}</span>
          {title}
        </div>
        {badge}
      </div>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p>
      {details && (
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          {details}
        </p>
      )}
      {actionHref && actionLabel && (
        <a
          href={actionHref}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium transition-colors hover:bg-[hsl(var(--input))]"
        >
          {actionLabel}
        </a>
      )}
    </div>
  );
}
