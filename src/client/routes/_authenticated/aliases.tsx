import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Plus, Trash2, ArrowRight, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AliasInfo, MailboxInfo, DomainInfo, ApiResponse } from "@shared/types";

export const Route = createFileRoute("/_authenticated/aliases")({
  component: AliasesPage,
});

function AliasesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    localPart: "",
    domainId: "",
    allowSendAs: false,
    targetMailboxIds: [] as string[],
  });
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["aliases"],
    queryFn: () => api.get<{ data: AliasInfo[] }>("/aliases"),
  });

  const { data: domainsData } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.get<{ data: DomainInfo[] }>("/domains"),
  });

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => api.get<{ data: MailboxInfo[] }>("/mailboxes"),
  });

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
      setForm({ localPart: "", domainId: "", allowSendAs: false, targetMailboxIds: [] });
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/aliases/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aliases"] }),
  });

  const aliases = data?.data ?? [];
  const domains = domainsData?.data ?? [];
  const allMailboxes = mailboxesData?.data ?? [];
  const selectedDomain = domains.find((d) => d.id === form.domainId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDomain || form.targetMailboxIds.length === 0) return;
    const address = `${form.localPart}@${selectedDomain.domain}`;
    createMutation.mutate({
      address,
      domainId: form.domainId,
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
    <div className="animate-fade-in p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AtSign className="h-6 w-6 text-[hsl(var(--primary))]" />
          <h1 className="text-2xl font-bold tracking-tight">Aliases</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Create Alias
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Create Alias</h2>
              <button onClick={() => { setShowCreate(false); setError(""); }}>
                <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Alias Address</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.localPart}
                    onChange={(e) => setForm({ ...form, localPart: e.target.value })}
                    placeholder="info"
                    className="h-10 flex-1 rounded-lg border border-[hsl(var(--input))] bg-transparent px-3 text-sm placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                  />
                  <span className="flex h-10 items-center text-sm text-[hsl(var(--muted-foreground))]">@</span>
                  <select
                    value={form.domainId}
                    onChange={(e) => setForm({ ...form, domainId: e.target.value })}
                    className="h-10 flex-1 rounded-lg border border-[hsl(var(--input))] bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                  >
                    <option value="">Select domain</option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.id}>{d.domain}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Forward To</label>
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-[hsl(var(--border))] p-3">
                  {allMailboxes.length === 0 && (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">No mailboxes available. Create a mailbox first.</p>
                  )}
                  {allMailboxes.map((mb) => (
                    <label key={mb.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.targetMailboxIds.includes(mb.id)}
                        onChange={() => toggleTarget(mb.id)}
                        className="h-4 w-4 rounded border-[hsl(var(--input))]"
                      />
                      <span>{mb.address}</span>
                      <span className="text-[hsl(var(--muted-foreground))]">({mb.displayName})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowSendAs"
                  checked={form.allowSendAs}
                  onChange={(e) => setForm({ ...form, allowSendAs: e.target.checked })}
                  className="h-4 w-4 rounded border-[hsl(var(--input))]"
                />
                <label htmlFor="allowSendAs" className="text-sm">Allow sending as this alias</label>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setError(""); }}
                  className="h-9 rounded-lg border border-[hsl(var(--border))] px-4 text-sm font-medium transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !form.localPart || !form.domainId || form.targetMailboxIds.length === 0}
                  className="h-9 rounded-lg bg-[hsl(var(--primary))] px-4 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {createMutation.isPending ? "Creating..." : "Create"}
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
      {!isLoading && aliases.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] py-24">
          <AtSign className="mb-4 h-12 w-12 text-[hsl(var(--muted-foreground))]" />
          <h2 className="text-lg font-semibold">No aliases yet</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Create an alias to forward emails to one or more mailboxes.
          </p>
        </div>
      )}

      {/* Alias list */}
      {!isLoading && aliases.length > 0 && (
        <div className="space-y-3">
          {aliases.map((alias) => (
            <div
              key={alias.id}
              className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition-colors hover:bg-[hsl(var(--accent))]"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--accent))]">
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-red-500/10 hover:text-red-500"
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
