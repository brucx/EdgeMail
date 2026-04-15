import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  HardDrive,
  FileText,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  Package,
} from "lucide-react";
import { api } from "@/lib/api";
import type { StorageStats } from "@shared/types";

export const Route = createFileRoute("/_authenticated/settings/storage")({
  component: StoragePage,
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function StoragePage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["storage-stats"],
    queryFn: () => api.get<StorageStats>("/storage/stats"),
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
  });

  return (
    <div className="px-8 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">
          Storage Usage
        </h2>
        {data?.configured && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[hsl(var(--card))] px-4 text-sm font-medium text-[hsl(var(--muted-foreground))] shadow-sm transition-all hover:bg-[hsl(var(--muted))] active:scale-[0.98] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      )}

      {error && !isLoading && (
        <ErrorCard message={error instanceof Error ? error.message : "Failed to load storage stats"} />
      )}

      {data && !isLoading && !data.configured && (
        <NotConfiguredCard error={data.error} />
      )}

      {data && !isLoading && data.configured && (
        <div className="space-y-6">
          {/* Partial error banner */}
          {data.error && (
            <div className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {data.error.includes("Account Analytics")
                    ? "API Token Missing Permissions"
                    : "Some metrics could not be loaded"}
                </p>
                {data.error.includes("Account Analytics") ? (
                  <div className="mt-1 space-y-1.5">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Your Cloudflare API token needs the{" "}
                      <strong>Account Analytics: Read</strong> permission to
                      query storage metrics.
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Go to{" "}
                      <strong>
                        Cloudflare Dashboard → My Profile → API Tokens
                      </strong>
                      , edit your token, and add:{" "}
                      <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/50">
                        Account / Account Analytics / Read
                      </code>
                    </p>
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                    {data.error}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Overview cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={Database}
              label="D1 Storage"
              value={data.d1 ? formatBytes(data.d1.totalSizeBytes) : "N/A"}
              iconColor="text-blue-500"
              iconBg="bg-blue-500/10"
            />
            <StatCard
              icon={HardDrive}
              label="R2 Storage"
              value={data.r2 ? formatBytes(data.r2.totalSizeBytes) : "N/A"}
              iconColor="text-violet-500"
              iconBg="bg-violet-500/10"
            />
            <StatCard
              icon={ArrowUpRight}
              label="Rows Read (24h)"
              value={data.d1 ? formatNumber(data.d1.rowsRead) : "N/A"}
              iconColor="text-emerald-500"
              iconBg="bg-emerald-500/10"
            />
            <StatCard
              icon={ArrowDownLeft}
              label="Rows Written (24h)"
              value={data.d1 ? formatNumber(data.d1.rowsWritten) : "N/A"}
              iconColor="text-orange-500"
              iconBg="bg-orange-500/10"
            />
          </div>

          {/* D1 Databases */}
          {data.d1 && data.d1.databases.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                <Database className="h-4 w-4" />
                D1 Databases
              </h3>
              <div className="space-y-2">
                {data.d1.databases.map((db) => (
                  <div
                    key={db.databaseId}
                    className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                        <Database className="h-5 w-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          {db.databaseId}
                        </p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          D1 SQL Database
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatBytes(db.databaseSizeBytes)}
                      </p>
                      <StorageBar
                        used={db.databaseSizeBytes}
                        total={5 * 1024 * 1024 * 1024}
                        color="bg-blue-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* R2 Buckets */}
          {data.r2 && data.r2.buckets.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                <HardDrive className="h-4 w-4" />
                R2 Buckets
              </h3>
              <div className="space-y-2">
                {data.r2.buckets.map((bucket) => (
                  <div
                    key={bucket.bucketName}
                    className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                        <HardDrive className="h-5 w-5 text-violet-500" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          {bucket.bucketName}
                        </p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          <Package className="mr-1 inline h-3 w-3" />
                          {formatNumber(bucket.objectCount)} objects
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatBytes(bucket.storageBytes)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state when no data returned despite being configured */}
          {!data.d1 && !data.r2 && !data.error && (
            <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-16">
              <FileText className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
              <h3 className="font-[family-name:var(--font-headline)] text-lg font-semibold">
                No usage data
              </h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                Storage analytics will appear here once data is available.
              </p>
            </div>
          )}

          {/* Free tier info */}
          <div className="rounded-xl border border-[hsl(var(--outline-variant))]/20 bg-[hsl(var(--card))]/50 px-4 py-3">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold">Free tier includes:</span>{" "}
              D1 — 5 GB storage, 5M reads/day, 100K writes/day{" "}
              <span className="mx-1">|</span>{" "}
              R2 — 10 GB storage, 10M Class A ops/month, 1M Class B ops/month.{" "}
              Metrics are refreshed from Cloudflare Analytics API and retained for 31 days.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  iconColor,
  iconBg,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="rounded-2xl bg-[hsl(var(--card))] p-4">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}
        >
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{label}</p>
          <p className="font-[family-name:var(--font-headline)] text-lg font-bold">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function StorageBar({
  used,
  total,
  color,
}: {
  used: number;
  total: number;
  color: string;
}) {
  const pct = Math.min((used / total) * 100, 100);
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-[hsl(var(--accent))]">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function NotConfiguredCard({ error }: { error?: string }) {
  const isTokenMissing = error?.includes("CLOUDFLARE_API_TOKEN");
  const isAccountMissing = error?.includes("CLOUDFLARE_ACCOUNT_ID");

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-16">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
      </div>
      <h3 className="font-[family-name:var(--font-headline)] text-lg font-semibold">
        Configuration Required
      </h3>
      <p className="mt-2 max-w-md text-center text-sm text-[hsl(var(--muted-foreground))]">
        Storage analytics requires Cloudflare API credentials to query the
        GraphQL Analytics API.
      </p>

      <div className="mt-6 w-full max-w-lg space-y-3 px-4">
        <ConfigStep
          step={1}
          done={!isTokenMissing}
          title="Set CLOUDFLARE_API_TOKEN"
          description={
            isTokenMissing
              ? "Create an API token in the Cloudflare dashboard with Account Analytics permission, then set it as a secret."
              : "API token is configured."
          }
          command={
            isTokenMissing
              ? "wrangler secret put CLOUDFLARE_API_TOKEN"
              : undefined
          }
        />
        <ConfigStep
          step={2}
          done={!isAccountMissing}
          title="Set CLOUDFLARE_ACCOUNT_ID"
          description={
            isAccountMissing
              ? "Add your Cloudflare Account ID as an environment variable in wrangler.jsonc or as a secret."
              : "Account ID is configured."
          }
          command={
            isAccountMissing
              ? 'vars: { "CLOUDFLARE_ACCOUNT_ID": "your-account-id" }'
              : undefined
          }
        />
        <ConfigStep
          step={3}
          done={false}
          title="Required Token Permissions"
          description="The API token needs: Account Analytics (Read). Optionally add: D1 (Read), R2 (Read) for more detailed metrics."
        />
      </div>
    </div>
  );
}

function ConfigStep({
  step,
  done,
  title,
  description,
  command,
}: {
  step: number;
  done: boolean;
  title: string;
  description: string;
  command?: string;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        done
          ? "border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20"
          : "border-[hsl(var(--outline-variant))]/30 bg-[hsl(var(--accent))]/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-emerald-500 text-white"
              : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
            {description}
          </p>
          {command && (
            <code className="mt-2 block rounded-lg bg-[hsl(var(--background))] px-3 py-2 text-xs font-mono text-[hsl(var(--foreground))]">
              {command}
            </code>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-16">
      <AlertTriangle className="mb-4 h-12 w-12 text-[hsl(var(--destructive))]" />
      <h3 className="font-[family-name:var(--font-headline)] text-lg font-semibold">
        Failed to Load
      </h3>
      <p className="mt-1 max-w-md text-center text-sm text-[hsl(var(--muted-foreground))]">
        {message}
      </p>
    </div>
  );
}
