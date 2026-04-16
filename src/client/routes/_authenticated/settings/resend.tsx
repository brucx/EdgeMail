import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Mail, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { ApiResponse, DomainInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/settings/resend")({
  component: ResendPage,
});

function ResendPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api.get<{ data: DomainInfo[] }>("/domains"),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; resendApiKey: string | null }) =>
      api.patch<ApiResponse<DomainInfo>>(`/domains/${input.id}`, {
        resendApiKey: input.resendApiKey,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      setEditingId(null);
      setNewKey("");
      setError("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const domains = data?.data ?? [];

  return (
    <div className="px-8 py-6">
      <h2 className="mb-2 font-[family-name:var(--font-headline)] text-lg font-bold">
        Resend Configuration
      </h2>
      <p className="mb-6 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
        EdgeMail sends email through Resend. Every domain uses the global{" "}
        <code className="rounded bg-[hsl(var(--accent))] px-1.5 py-0.5 text-xs">
          RESEND_API_KEY
        </code>{" "}
        Worker secret by default. Set a per-domain override below to isolate a
        specific domain onto its own Resend account (useful for tenant
        separation, billing, or credential rotation). Keys are AES-GCM
        encrypted before being written to D1.
      </p>

      {isLoading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-[hsl(var(--primary))]" />
        </div>
      )}

      {!isLoading && domains.length === 0 && (
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

      {!isLoading && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((domain) => (
            <div
              key={domain.id}
              className="flex items-center justify-between rounded-2xl bg-[hsl(var(--card))] p-4"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
                  <Globe className="h-5 w-5 text-[hsl(var(--primary))]" />
                </div>
                <div>
                  <p className="font-semibold">{domain.domain}</p>
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    {domain.resendApiKeyConfigured ? (
                      <>
                        <span className="font-medium text-[hsl(var(--primary))]">
                          Per-domain key
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
                      <span>Using global RESEND_API_KEY</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingId(domain.id);
                    setNewKey("");
                    setError("");
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium transition-colors hover:bg-[hsl(var(--input))]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {domain.resendApiKeyConfigured ? "Replace" : "Set override"}
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
