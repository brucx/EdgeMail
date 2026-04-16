import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  Plus,
  CheckCircle,
  AlertCircle,
  Clock,
  Trash2,
  ShieldCheck,
  X,
  Cloud,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { DomainInfo, ApiResponse } from "@shared/types";
import { CloudflareImportModal } from "@/components/CloudflareImportModal";

export const Route = createFileRoute("/_authenticated/settings/domains")({
  component: DomainsPage,
});

function DomainsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.get<{ data: DomainInfo[] }>("/domains"),
  });

  const createMutation = useMutation({
    mutationFn: (domain: string) =>
      api.post<ApiResponse<DomainInfo>>("/domains", { domain }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      setShowCreate(false);
      setNewDomain("");
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/domains/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["domains"] }),
  });

  const [verifyError, setVerifyError] = useState<string | null>(null);

  const verifyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/domains/${id}/verify`, { method: "POST" });
      const body = await res.json() as Record<string, any>;
      if (!res.ok) {
        const hint = body?.details?.hint || body?.error || "Verification failed";
        throw new Error(hint);
      }
      return body;
    },
    onSuccess: () => {
      setVerifyError(null);
      queryClient.invalidateQueries({ queryKey: ["domains"] });
    },
    onError: (err: Error) => setVerifyError(err.message),
  });

  const domains = data?.data ?? [];

  const statusConfig = {
    active: {
      icon: CheckCircle,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10",
      label: "Active",
    },
    pending: {
      icon: Clock,
      color: "text-amber-600",
      bg: "bg-amber-500/10",
      label: "Pending",
    },
    disabled: {
      icon: AlertCircle,
      color: "text-[hsl(var(--destructive))]",
      bg: "bg-[hsl(var(--destructive))]/10",
      label: "Disabled",
    },
  };

  return (
    <div className="px-8 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">
          Domains
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--foreground))] transition-all hover:bg-[hsl(var(--input))] active:scale-[0.98]"
          >
            <Cloud className="h-4 w-4" />
            Import from Cloudflare
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            Add Domain
          </button>
        </div>
      </div>

      {verifyError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1 text-sm text-amber-800 dark:text-amber-300">
            {verifyError}
          </div>
          <button onClick={() => setVerifyError(null)}>
            <X className="h-4 w-4 text-amber-600 hover:text-amber-800" />
          </button>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-ambient">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">Add Domain</h2>
              <button onClick={() => { setShowCreate(false); setError(""); }}>
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(newDomain); }}>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Domain Name
              </label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
                className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
              />
              {error && <p className="mt-2 text-sm text-[hsl(var(--destructive))]">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setError(""); }}
                  className="h-9 rounded-lg px-4 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !newDomain}
                  className="h-9 rounded-lg gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                >
                  {createMutation.isPending ? "Adding..." : "Add Domain"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-[hsl(var(--primary))]" />
        </div>
      )}

      {!isLoading && domains.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
          <Globe className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
          <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No domains configured</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Add your first domain to start receiving emails.
          </p>
        </div>
      )}

      {!isLoading && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((domain) => {
            const status = statusConfig[domain.status];
            const StatusIcon = status.icon;
            return (
              <div
                key={domain.id}
                className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4 transition-colors hover:bg-[hsl(var(--card))]/80"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
                    <Globe className="h-5 w-5 text-[hsl(var(--primary))]" />
                  </div>
                  <div>
                    <p className="font-semibold">{domain.domain}</p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${status.bg} ${status.color}`}>
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                      </span>
                      {domain.mxVerified && (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <ShieldCheck className="h-3 w-3" />
                          MX Verified
                        </span>
                      )}
                      {domain.cfSetupStatus === "complete" && (
                        <span className="inline-flex items-center gap-1 text-[hsl(var(--primary))]">
                          <Cloud className="h-3 w-3" />
                          CF Managed
                        </span>
                      )}
                      {domain.cfSetupStatus && domain.cfSetupStatus !== "complete" && (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <AlertCircle className="h-3 w-3" />
                          Setup Incomplete
                        </span>
                      )}
                      <span>
                        Added {new Date(domain.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!domain.mxVerified && !domain.cfSetupStatus && (
                    <button
                      onClick={() => verifyMutation.mutate(domain.id)}
                      disabled={verifyMutation.isPending}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium transition-colors hover:bg-[hsl(var(--input))]"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Verify
                    </button>
                  )}
                  {domain.cfSetupStatus && domain.cfSetupStatus !== "complete" && domain.cfZoneId && (
                    <button
                      onClick={() => {
                        setShowImport(true);
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20"
                    >
                      <Cloud className="h-3.5 w-3.5" />
                      Retry Setup
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Delete domain ${domain.domain}? This will remove all associated mailboxes, aliases, and groups.`)) {
                        deleteMutation.mutate(domain.id);
                      }
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--outline))] transition-colors hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CloudflareImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
      />
    </div>
  );
}
