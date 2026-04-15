import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, Copy, Check, X, AlertCircle } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { ApiTokenInfo, ApiTokenCreateResponse, DomainInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/settings/api-tokens")({
  component: ApiTokensPage,
});

function ApiTokensPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domainId: "",
  });
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["tokens"],
    queryFn: () => api.get<{ data: ApiTokenInfo[] }>("/tokens"),
  });

  const { data: domainsData } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.get<{ data: DomainInfo[] }>("/domains"),
  });

  const createMutation = useMutation({
    mutationFn: (input: { name: string; permissions: string[]; domainId?: string }) =>
      api.post<ApiTokenCreateResponse>("/tokens", input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      setNewToken(result.token);
      setForm({ name: "", domainId: "" });
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tokens/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const tokens = data?.data ?? [];
  const domains = domainsData?.data ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: form.name,
      permissions: ["read:messages"],
      domainId: form.domainId || undefined,
    });
  };

  const handleCopy = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const closeTokenModal = () => {
    setNewToken(null);
    setShowCreate(false);
    setCopied(false);
  };

  return (
    <div className="px-8 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">
          API Tokens
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex h-9 items-center gap-2 rounded-xl gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Create Token
        </button>
      </div>

      {/* Create / Token display modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-ambient">
            {newToken ? (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">Token Created</h2>
                  <button onClick={closeTokenModal}>
                    <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                  </button>
                </div>
                <div className="mb-3 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Copy this token now. It won't be shown again.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-[hsl(var(--accent))] px-3 py-2.5 text-xs font-mono break-all">
                    {newToken}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="shrink-0 rounded-lg bg-[hsl(var(--accent))] p-2.5 transition-colors hover:bg-[hsl(var(--input))]"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Copy className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                    )}
                  </button>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={closeTokenModal}
                    className="h-9 rounded-lg gradient-primary px-4 text-sm font-semibold text-white shadow-sm"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">Create API Token</h2>
                  <button onClick={() => { setShowCreate(false); setError(""); }}>
                    <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      Token Name
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. AI Agent Token"
                      className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      Permissions
                    </label>
                    <div className="rounded-xl bg-[hsl(var(--accent))] p-3">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked
                          disabled
                          className="h-4 w-4 rounded text-[hsl(var(--primary))]"
                        />
                        <span>Read Messages</span>
                        <span className="text-xs text-[hsl(var(--outline))]">(read:messages)</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      Domain Scope (optional)
                    </label>
                    <select
                      value={form.domainId}
                      onChange={(e) => setForm({ ...form, domainId: e.target.value })}
                      className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-3 py-3 text-sm transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                    >
                      <option value="">All domains</option>
                      {domains.map((d) => (
                        <option key={d.id} value={d.id}>{d.domain}</option>
                      ))}
                    </select>
                  </div>
                  {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowCreate(false); setError(""); }}
                      className="h-9 rounded-lg px-4 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createMutation.isPending || !form.name}
                      className="h-9 rounded-lg gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                    >
                      {createMutation.isPending ? "Creating..." : "Create"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      )}

      {!isLoading && tokens.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
          <Key className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
          <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No API tokens</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Create a token to access the API programmatically.
          </p>
        </div>
      )}

      {!isLoading && tokens.length > 0 && (
        <div className="space-y-3">
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4 transition-colors hover:bg-[hsl(var(--card))]/80"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
                  <Key className="h-5 w-5 text-[hsl(var(--primary))]" />
                </div>
                <div>
                  <p className="font-semibold">{token.name}</p>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                    <code className="rounded bg-[hsl(var(--accent))] px-1.5 py-0.5 font-mono">
                      {token.prefix}...
                    </code>
                    <span>{token.permissions.join(", ")}</span>
                    {token.domainId && (
                      <span className="text-[hsl(var(--outline))]">
                        Scoped
                      </span>
                    )}
                    {token.lastUsedAt && (
                      <span>
                        Last used {new Date(token.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Revoke token "${token.name}"?`)) {
                    deleteMutation.mutate(token.id);
                  }
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--outline))] transition-colors hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
