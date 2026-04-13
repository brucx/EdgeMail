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
  MoreVertical,
  X,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { DomainInfo, ApiResponse } from "@shared/types";

export const Route = createFileRoute("/_authenticated/domains")({
  component: DomainsPage,
});

function DomainsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
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

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.post(`/domains/${id}/verify`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["domains"] }),
  });

  const domains = data?.data ?? [];

  const statusConfig = {
    active: {
      icon: CheckCircle,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      label: "Active",
    },
    pending: {
      icon: Clock,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      label: "Pending",
    },
    disabled: {
      icon: AlertCircle,
      color: "text-red-500",
      bg: "bg-red-500/10",
      label: "Disabled",
    },
  };

  return (
    <div className="animate-fade-in p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="h-6 w-6 text-[hsl(var(--primary))]" />
          <h1 className="text-2xl font-bold tracking-tight">Domains</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add Domain
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add Domain</h2>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setError("");
                }}
              >
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate(newDomain);
              }}
            >
              <label className="mb-1 block text-sm font-medium">
                Domain Name
              </label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
                className="h-10 w-full rounded-lg border border-[hsl(var(--input))] bg-transparent px-3 text-sm placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              />
              {error && (
                <p className="mt-2 text-sm text-red-500">{error}</p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setError("");
                  }}
                  className="h-9 rounded-lg border border-[hsl(var(--border))] px-4 text-sm font-medium transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !newDomain}
                  className="h-9 rounded-lg bg-[hsl(var(--primary))] px-4 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {createMutation.isPending ? "Adding..." : "Add Domain"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && domains.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-24">
          <Globe className="mb-4 h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h2 className="text-lg font-semibold">No domains configured</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Add your first domain to start receiving emails.
          </p>
        </div>
      )}

      {/* Domain list */}
      {!isLoading && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((domain) => {
            const status = statusConfig[domain.status];
            const StatusIcon = status.icon;
            return (
              <div
                key={domain.id}
                className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition-colors hover:bg-[hsl(var(--accent))]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--accent))]">
                    <Globe className="h-5 w-5 text-[hsl(var(--primary))]" />
                  </div>
                  <div>
                    <p className="font-semibold">{domain.domain}</p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${status.bg} ${status.color}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                      </span>
                      {domain.mxVerified && (
                        <span className="inline-flex items-center gap-1 text-emerald-500">
                          <ShieldCheck className="h-3 w-3" />
                          MX Verified
                        </span>
                      )}
                      <span>
                        Added{" "}
                        {new Date(domain.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!domain.mxVerified && (
                    <button
                      onClick={() => verifyMutation.mutate(domain.id)}
                      disabled={verifyMutation.isPending}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-medium transition-colors hover:bg-[hsl(var(--accent))]"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Verify
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Delete domain ${domain.domain}? This will remove all associated mailboxes, aliases, and groups.`)) {
                        deleteMutation.mutate(domain.id);
                      }
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
