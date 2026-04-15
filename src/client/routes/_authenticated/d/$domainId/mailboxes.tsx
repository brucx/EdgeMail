import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mailbox, Plus, Trash2, MailCheck, MailX, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MailboxInfo, DomainInfo, ApiResponse } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/mailboxes")({
  component: MailboxesPage,
});

function MailboxesPage() {
  const { domainId } = Route.useParams();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    localPart: "",
    displayName: "",
    canSend: true,
  });
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["mailboxes", { domainId }],
    queryFn: () => api.get<{ data: MailboxInfo[] }>(`/mailboxes?domainId=${domainId}`),
  });

  const { data: domainData } = useQuery({
    queryKey: ["domain", domainId],
    queryFn: () => api.get<{ data: DomainInfo }>(`/domains/${domainId}`),
  });

  const domain = domainData?.data;

  const createMutation = useMutation({
    mutationFn: (input: {
      address: string;
      domainId: string;
      displayName: string;
      canSend: boolean;
    }) => api.post<ApiResponse<MailboxInfo>>("/mailboxes", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailboxes"] });
      setShowCreate(false);
      setForm({ localPart: "", displayName: "", canSend: true });
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/mailboxes/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
  });

  const mailboxes = data?.data ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain) return;
    const address = `${form.localPart}@${domain.domain}`;
    createMutation.mutate({
      address,
      domainId,
      displayName: form.displayName,
      canSend: form.canSend,
    });
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
            Create Mailbox
          </button>
        </div>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-ambient">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">Create Mailbox</h2>
                <button onClick={() => { setShowCreate(false); setError(""); }}>
                  <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
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
                      value={form.localPart}
                      onChange={(e) => setForm({ ...form, localPart: e.target.value })}
                      placeholder="john"
                      className="flex-1 rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                    />
                    <span className="text-sm text-[hsl(var(--outline))]">@{domain?.domain}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    id="canSend"
                    checked={form.canSend}
                    onChange={(e) => setForm({ ...form, canSend: e.target.checked })}
                    className="h-4 w-4 rounded text-[hsl(var(--primary))] focus:ring-[hsl(var(--ring))]/20"
                  />
                  <label htmlFor="canSend" className="text-sm text-[hsl(var(--muted-foreground))]">Allow sending emails</label>
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
                    disabled={createMutation.isPending || !form.localPart || !form.displayName}
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
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
          </div>
        )}

        {!isLoading && mailboxes.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
            <Mailbox className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
            <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No mailboxes yet</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Create your first mailbox to start receiving emails.
            </p>
          </div>
        )}

        {!isLoading && mailboxes.length > 0 && (
          <div className="space-y-3">
            {mailboxes.map((mb) => (
              <div
                key={mb.id}
                className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4 transition-colors hover:bg-[hsl(var(--card))]/80"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
                    <Mailbox className="h-5 w-5 text-[hsl(var(--primary))]" />
                  </div>
                  <div>
                    <p className="font-semibold">{mb.displayName}</p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                      <span>{mb.address}</span>
                      <span className={`inline-flex items-center gap-1 ${mb.canSend ? "text-emerald-600" : "text-[hsl(var(--outline))]"}`}>
                        {mb.canSend ? <MailCheck className="h-3 w-3" /> : <MailX className="h-3 w-3" />}
                        {mb.canSend ? "Can Send" : "Receive Only"}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete mailbox ${mb.address}?`)) {
                      deleteMutation.mutate(mb.id);
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
