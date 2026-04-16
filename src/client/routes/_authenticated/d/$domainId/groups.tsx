import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { GroupInfo, MailboxInfo, DomainInfo, ApiResponse } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/groups")({
  component: GroupsPage,
});

function GroupsPage() {
  const { domainId } = Route.useParams();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    localPart: "",
    displayName: "",
    allowSendAs: false,
    memberMailboxIds: [] as string[],
  });
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["groups", { domainId }],
    queryFn: () => api.get<{ data: GroupInfo[] }>(`/groups?domainId=${domainId}`),
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
      displayName: string;
      allowSendAs: boolean;
      memberMailboxIds: string[];
    }) => api.post<ApiResponse<GroupInfo>>("/groups", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setShowCreate(false);
      setForm({ localPart: "", displayName: "", allowSendAs: false, memberMailboxIds: [] });
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/groups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });

  const allGroups = data?.data ?? [];
  const allMailboxes = mailboxesData?.data ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain || form.memberMailboxIds.length === 0) return;
    const address = `${form.localPart}@${domain.domain}`;
    createMutation.mutate({
      address,
      domainId,
      displayName: form.displayName,
      allowSendAs: form.allowSendAs,
      memberMailboxIds: form.memberMailboxIds,
    });
  };

  const toggleMember = (id: string) => {
    setForm((prev) => ({
      ...prev,
      memberMailboxIds: prev.memberMailboxIds.includes(id)
        ? prev.memberMailboxIds.filter((m) => m !== id)
        : [...prev.memberMailboxIds, id],
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
            Create Group
          </button>
        </div>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-ambient">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">Create Group</h2>
                <button onClick={() => { setShowCreate(false); setError(""); }}>
                  <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Group Name
                  </label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    placeholder="Engineering Team"
                    className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Group Address
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={form.localPart}
                      onChange={(e) => setForm({ ...form, localPart: e.target.value })}
                      placeholder="team"
                      className="flex-1 rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
                    />
                    <span className="text-sm text-[hsl(var(--outline))]">@{domain?.domain}</span>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Members
                  </label>
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl bg-[hsl(var(--accent))] p-3 custom-scrollbar">
                    {allMailboxes.length === 0 && (
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">No mailboxes available.</p>
                    )}
                    {allMailboxes.map((mb) => (
                      <label key={mb.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.memberMailboxIds.includes(mb.id)}
                          onChange={() => toggleMember(mb.id)}
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
                    id="groupAllowSendAs"
                    checked={form.allowSendAs}
                    onChange={(e) => setForm({ ...form, allowSendAs: e.target.checked })}
                    className="h-4 w-4 rounded text-[hsl(var(--primary))] focus:ring-[hsl(var(--ring))]/20"
                  />
                  <label htmlFor="groupAllowSendAs" className="text-sm text-[hsl(var(--muted-foreground))]">Allow sending as this group</label>
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
                    disabled={createMutation.isPending || !form.localPart || !form.displayName || form.memberMailboxIds.length === 0}
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

        {!isLoading && allGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
            <Users className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
            <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No groups yet</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Create a group to distribute emails to multiple mailboxes.
            </p>
          </div>
        )}

        {!isLoading && allGroups.length > 0 && (
          <div className="space-y-3">
            {allGroups.map((group) => (
              <div
                key={group.id}
                className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4 transition-colors hover:bg-[hsl(var(--card))]/80"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
                    <Users className="h-5 w-5 text-[hsl(var(--primary))]" />
                  </div>
                  <div>
                    <p className="font-semibold">{group.displayName}</p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                      <span>{group.address}</span>
                      <span>{group.members.length} member{group.members.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete group ${group.displayName}?`)) {
                      deleteMutation.mutate(group.id);
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
