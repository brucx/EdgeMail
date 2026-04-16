import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Plus, Trash2, ArrowRight, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AliasInfo, MailboxInfo, DomainInfo, ApiResponse } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/aliases")({
  component: AliasesPage,
});

function AliasesPage() {
  const { domainId } = Route.useParams();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    localPart: "",
    allowSendAs: false,
    targetMailboxIds: [] as string[],
  });
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["aliases", { domainId }],
    queryFn: () => api.get<{ data: AliasInfo[] }>(`/aliases?domainId=${domainId}`),
  });

  const { data: domainData } = useQuery({
    queryKey: ["domain", domainId],
    queryFn: () => api.get<{ data: DomainInfo }>(`/domains/${domainId}`),
  });

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes", { domainId }],
    queryFn: () => api.get<{ data: MailboxInfo[] }>(`/mailboxes?domainId=${domainId}`),
  });

  const domain = domainData?.data;

  const createMutation = useMutation({
    mutationFn: (input: {
      address: string;
      domainId: string;
      allowSendAs: boolean;
      targetMailboxIds: string[];
    }) => api.post<ApiResponse<AliasInfo>>("/aliases", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aliases"] });
      setShowCreate(false);
      setForm({ localPart: "", allowSendAs: false, targetMailboxIds: [] });
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/aliases/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aliases"] }),
  });

  const aliases = data?.data ?? [];
  const allMailboxes = mailboxesData?.data ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain || form.targetMailboxIds.length === 0) return;
    const address = `${form.localPart}@${domain.domain}`;
    createMutation.mutate({
      address,
      domainId,
      allowSendAs: form.allowSendAs,
      targetMailboxIds: form.targetMailboxIds,
    });
  };

  const toggleTarget = (id: string) => {
    setForm((prev) => ({
      ...prev,
      targetMailboxIds: prev.targetMailboxIds.includes(id)
        ? prev.targetMailboxIds.filter((t) => t !== id)
        : [...prev.targetMailboxIds, id],
    }));
  };

  return (
    <div className="animate-fade-in bg-[hsl(var(--accent))] min-h-full">
      <div className="px-8 py-6">
        <div className="mb-6 flex items-center justify-end">
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            Create Alias
          </button>
        </div>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-ambient">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">Create Alias</h2>
                <button onClick={() => { setShowCreate(false); setError(""); }}>
                  <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Alias Address
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={form.localPart}
                      onChange={(e) => setForm({ ...form, localPart: e.target.value })}
                      placeholder="info"
                      className="flex-1 rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                    />
                    <span className="text-sm text-[hsl(var(--outline))]">@{domain?.domain}</span>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Forward To
                  </label>
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl bg-[hsl(var(--accent))] p-3 custom-scrollbar">
                    {allMailboxes.length === 0 && (
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">No mailboxes available.</p>
                    )}
                    {allMailboxes.map((mb) => (
                      <label key={mb.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.targetMailboxIds.includes(mb.id)}
                          onChange={() => toggleTarget(mb.id)}
                          className="h-4 w-4 rounded text-[hsl(var(--primary))] focus:ring-[hsl(var(--ring))]/20"
                        />
                        <span>{mb.address}</span>
                        <span className="text-[hsl(var(--outline))]">({mb.displayName})</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    id="allowSendAs"
                    checked={form.allowSendAs}
                    onChange={(e) => setForm({ ...form, allowSendAs: e.target.checked })}
                    className="h-4 w-4 rounded text-[hsl(var(--primary))] focus:ring-[hsl(var(--ring))]/20"
                  />
                  <label htmlFor="allowSendAs" className="text-sm text-[hsl(var(--muted-foreground))]">Allow sending as this alias</label>
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
                    disabled={createMutation.isPending || !form.localPart || form.targetMailboxIds.length === 0}
                    className="h-9 rounded-lg gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                  >
                    {createMutation.isPending ? "Creating..." : "Create"}
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

        {!isLoading && aliases.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
            <AtSign className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
            <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No aliases yet</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Create an alias to forward emails to one or more mailboxes.
            </p>
          </div>
        )}

        {!isLoading && aliases.length > 0 && (
          <div className="space-y-3">
            {aliases.map((alias) => (
              <div
                key={alias.id}
                className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4 transition-colors hover:bg-[hsl(var(--card))]/80"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
                    <AtSign className="h-5 w-5 text-[hsl(var(--primary))]" />
                  </div>
                  <div>
                    <p className="font-semibold">{alias.address}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                      <ArrowRight className="h-3 w-3" />
                      {alias.targets.map((t, i) => (
                        <span key={t.id}>
                          {t.address}
                          {i < alias.targets.length - 1 && ", "}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete alias ${alias.address}?`)) {
                      deleteMutation.mutate(alias.id);
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
    </div>
  );
}
