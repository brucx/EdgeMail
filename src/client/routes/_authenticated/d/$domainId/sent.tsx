import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Send as SendIcon, Mail, Paperclip, Search } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MessageSummary, MailboxInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/sent")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    return {
      q: (search.q as string) || undefined,
    };
  },
  component: SentPage,
});

function SentPage() {
  const { domainId } = Route.useParams();
  const { q: search } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>("");

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes", { domainId }],
    queryFn: () => api.get<{ data: MailboxInfo[] }>(`/mailboxes?domainId=${domainId}`),
  });

  const mailboxes = (mailboxesData?.data ?? []).filter((mb) => mb.canSend);
  const activeMailboxId = selectedMailboxId || mailboxes[0]?.id || "";

  const { data: messagesData, isLoading } = useQuery({
    queryKey: ["messages", "sent", activeMailboxId, search],
    queryFn: () => {
      const params = new URLSearchParams({
        mailboxId: activeMailboxId,
        folder: "sent",
      });
      if (search) params.set("search", search);
      return api.get<{ data: MessageSummary[]; total: number }>(
        `/messages?${params}`,
      );
    },
    enabled: !!activeMailboxId,
  });

  const messages = messagesData?.data ?? [];

  return (
    <div className="animate-fade-in flex h-full flex-col bg-[hsl(var(--accent))]">
      {/* Page header */}
      <div className="px-8 py-6 flex items-center justify-end">
        <div className="flex items-center gap-2">
          {/* Mobile: mailbox selector as pill tabs */}
          {mailboxes.length > 1 && (
            <div className="flex items-center gap-1 lg:hidden overflow-x-auto">
              {mailboxes.map((mb) => (
                <button
                  key={mb.id}
                  onClick={() => setSelectedMailboxId(mb.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeMailboxId === mb.id
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--card))]/80"
                  }`}
                >
                  <span className="truncate max-w-[120px]">{mb.address.split("@")[0]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="relative lg:hidden">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--outline))]" />
            <input
              type="text"
              value={search}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    q: e.target.value || undefined,
                  }),
                  replace: true,
                })
              }
              placeholder="Search..."
              className="h-9 w-48 rounded-full border-none bg-[hsl(var(--card))] pl-9 pr-3 text-sm placeholder:text-[hsl(var(--outline))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20"
            />
          </div>
        </div>
      </div>

      {/* Main content: mailbox panel + message list */}
      <div className="mx-8 mb-8 flex flex-1 overflow-hidden bg-[hsl(var(--card))] rounded-2xl shadow-sm border border-[hsl(var(--border))]/60">
        {/* Left: Mailbox panel (desktop only, multiple mailboxes) */}
        {mailboxes.length > 1 && (
          <aside className="hidden lg:flex w-56 shrink-0 flex-col overflow-y-auto custom-scrollbar py-2 border-r border-[hsl(var(--border))]/60">
            {mailboxes.map((mb) => {
              const isActive = activeMailboxId === mb.id;
              return (
                <div key={mb.id} className="px-2 mb-1">
                  <button
                    onClick={() => setSelectedMailboxId(mb.id)}
                    className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                      isActive
                        ? "bg-[hsl(var(--primary))]/[0.08]"
                        : "hover:bg-[hsl(var(--accent))]"
                    }`}
                  >
                    <Mail className={`h-4 w-4 shrink-0 ${
                      isActive ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--outline))]"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <span className={`block truncate text-sm ${
                        isActive
                          ? "font-semibold text-[hsl(var(--primary))]"
                          : "font-medium text-[hsl(var(--muted-foreground))]"
                      }`}>
                        {mb.address.split("@")[0]}
                      </span>
                      <span className="block truncate text-[11px] text-[hsl(var(--outline))]">
                        @{mb.address.split("@")[1]}
                      </span>
                    </div>
                  </button>
                </div>
              );
            })}
          </aside>
        )}

        {/* Right: Email list */}
        <section className="flex-1 flex flex-col overflow-hidden bg-[hsl(var(--card))]">
          {isLoading && (
            <div className="flex flex-1 justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-[hsl(var(--primary))]" />
            </div>
          )}

          {!isLoading && messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center py-24">
              <SendIcon className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
              <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No sent messages</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {search ? "No messages match your search." : "Messages you send will appear here."}
              </p>
            </div>
          )}

          {messages.length > 0 && (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {messages.map((msg) => (
                <Link
                  key={msg.id}
                  to="/d/$domainId/messages/$id"
                  params={{ domainId, id: msg.id }}
                  search={{ folder: "sent" }}
                  className="group flex items-center gap-6 px-6 py-4 cursor-pointer transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  <div className="shrink-0">
                    <Mail className="h-5 w-5 text-[hsl(var(--outline))]" />
                  </div>
                  <div className="w-40 shrink-0">
                    <span className="block truncate text-sm font-semibold text-[hsl(var(--primary))]">
                      To: {msg.toAddresses.length > 0 ? msg.toAddresses.join(", ") : "(no recipient)"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-[hsl(var(--foreground))]">
                      {msg.subject || "(No subject)"}
                    </span>
                    {msg.hasAttachments && (
                      <Paperclip className="h-3 w-3 shrink-0 text-[hsl(var(--outline))]" />
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-medium text-[hsl(var(--outline))] whitespace-nowrap">
                    {new Date(msg.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
