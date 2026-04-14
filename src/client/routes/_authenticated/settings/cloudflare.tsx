import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Cloud, CheckCircle, XCircle, RefreshCw, Info } from "lucide-react";
import { api } from "@/lib/api";
import type { CloudflareStatusResponse } from "@shared/types";

export const Route = createFileRoute("/_authenticated/settings/cloudflare")({
  component: CloudflarePage,
});

function CloudflarePage() {
  const {
    data: status,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["cloudflare", "status"],
    queryFn: () => api.get<CloudflareStatusResponse>("/cloudflare/status"),
  });

  return (
    <div className="px-8 py-6">
      <h2 className="mb-6 font-[family-name:var(--font-headline)] text-lg font-bold">
        Cloudflare Integration
      </h2>

      {/* Connection Status Card */}
      <div className="rounded-2xl bg-[hsl(var(--card))] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
              <Cloud className="h-6 w-6 text-[hsl(var(--primary))]" />
            </div>
            <div>
              <h3 className="font-semibold">API Connection</h3>
              {isLoading ? (
                <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))]">
                  Checking connection...
                </p>
              ) : status?.connected ? (
                <span className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Connected
                </span>
              ) : (
                <span className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--destructive))]">
                  <XCircle className="h-3.5 w-3.5" />
                  Not Connected
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[hsl(var(--accent))] px-3 text-sm font-medium transition-colors hover:bg-[hsl(var(--input))] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            />
            Test Connection
          </button>
        </div>

        {/* Error message */}
        {!isLoading && !status?.connected && status?.error && (
          <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {status.error}
            </p>
          </div>
        )}
      </div>

      {/* Setup Instructions */}
      {!isLoading && !status?.connected && (
        <div className="mt-4 rounded-2xl bg-[hsl(var(--card))] p-6">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--primary))]" />
            <div>
              <h3 className="font-semibold">Setup Instructions</h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                To enable Cloudflare integration, set the following Worker
                secrets:
              </p>
              <div className="mt-3 space-y-2">
                <div className="rounded-lg bg-[hsl(var(--accent))] px-3 py-2">
                  <code className="font-[family-name:var(--font-mono)] text-xs">
                    npx wrangler secret put CLOUDFLARE_API_TOKEN
                  </code>
                </div>
                <div className="rounded-lg bg-[hsl(var(--accent))] px-3 py-2">
                  <code className="font-[family-name:var(--font-mono)] text-xs">
                    npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
                  </code>
                </div>
              </div>
              <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
                Create an API Token at{" "}
                <span className="font-medium text-[hsl(var(--primary))]">
                  Cloudflare Dashboard &rarr; My Profile &rarr; API Tokens
                </span>{" "}
                with <strong>Zone Read</strong>, <strong>DNS Edit</strong>, and{" "}
                <strong>Email Routing Edit</strong> permissions.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info when connected */}
      {!isLoading && status?.connected && (
        <div className="mt-4 rounded-2xl bg-[hsl(var(--card))] p-6">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--primary))]" />
            <div>
              <h3 className="font-semibold">How to Use</h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                Go to{" "}
                <span className="font-medium text-[hsl(var(--foreground))]">
                  Settings &rarr; Domains
                </span>{" "}
                and click{" "}
                <span className="font-medium text-[hsl(var(--foreground))]">
                  Import from Cloudflare
                </span>{" "}
                to automatically configure DNS records and Email Routing for
                your domains.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
