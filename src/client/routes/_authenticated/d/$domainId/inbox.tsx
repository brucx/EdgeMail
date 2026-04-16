import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Search, Mail, MailOpen, Paperclip } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MessageSummary, MailboxInfo, MailboxUnreadCount } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/inbox")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    return {
      q: (search.q as string) || undefined,
    };
  },
  component: InboxPage,
});

function InboxPage() {
  const { domainId } = Route.useParams();
  const { q: search } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>("");

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes", { domainId }],
    queryFn: () => api.get<{ data: MailboxInfo[] }>(`/mailboxes?domainId=${domainId}`),
  });

  const { data: unreadData } = useQuery({
    queryKey: ["mailboxes", "unread-counts", domainId],
    queryFn: () => api.get<{ data: MailboxUnreadCount[] }>(`/mailboxes/unread-counts?domainId=${domainId}`),
    refetchInterval: 15_000,
  });

  const mailboxes = mailboxesData?.data ?? [];
  const unreadCounts = unreadData?.data ?? [];
  const activeMailboxId = selectedMailboxId || mailboxes[0]?.id || "";

  const { data: messagesData, isLoading } = useQuery({
    queryKey: ["messages", "inbox", activeMailboxId, search],
    queryFn: () => {
      const params = new URLSearchParams({
        mailboxId: activeMailboxId,
        folder: "inbox",
      });
      if (search) params.set("search", search);
      return api.get<{ data: MessageSummary[]; total: number }>(
        `/messages?${params}`,
      );
    },
    enabled: !!activeMailboxId,
    refetchInterval: 15_000,
  });

  const markReadMutation = useMutation({
    mutationFn: ({ id, mailboxId }: { id: string; mailboxId: string }) =>
      api.patch(`/messages/${id}`, { isRead: true, mailboxId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["mailboxes", "unread-counts"] });
    },
  });

  const messages = messagesData?.data ?? [];
  const total = messagesData?.total ?? 0;
  const hasMultipleMailboxes = mailboxes.length > 1;

  function getUnreadCount(mailboxId: string): number {
    return unreadCounts.find((u) => u.mailboxId === mailboxId)?.unreadCount ?? 0;
  }

  return (
    <div className="animate-fade-in flex h-full flex-col bg-[hsl(var(--accent))]">
      {/* Page header */}
      <div className="px-8 py-6 flex items-center justify-end">
        <div className="flex items-center gap-2">
          {/* Mobile: mailbox selector as pill tabs */}
          {hasMultipleMailboxes && (
            <div className="flex items-center gap-1 lg:hidden overflow-x-auto">
              {mailboxes.map((mb) => {
                const unread = getUnreadCount(mb.id);
                return (
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
                    {unread > 0 && (
                      <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                        activeMailboxId === mb.id
                          ? "bg-[hsl(var(--primary-foreground))] text-[hsl(var(--primary))]"
                          : "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      }`}>
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
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
        {hasMultipleMailboxes && (
          <aside className="hidden lg:flex w-56 shrink-0 flex-col overflow-y-auto custom-scrollbar py-2 border-r border-[hsl(var(--border))]/60">
            {mailboxes.map((mb) => {
              const unread = getUnreadCount(mb.id);
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
                  {unread > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1.5 text-[11px] font-bold text-[hsl(var(--primary-foreground))]">
                      {unread}
                    </span>
                  )}
                  </button>
                </div>
              );
            })}
          </aside>
        )}

        {/* Right: Email list */}
        <section className="flex-1 flex flex-col overflow-hidden bg-[hsl(var(--card))]">
          {!activeMailboxId && (
            <div className="flex flex-1 flex-col items-center justify-center py-24">
              <InboxIcon className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
              <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No mailbox available</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                Create a mailbox first to start receiving emails.
              </p>
            </div>
          )}

          {activeMailboxId && isLoading && (
            <div className="flex flex-1 justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-[hsl(var(--primary))]" />
            </div>
          )}

          {activeMailboxId && !isLoading && messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center py-24">
              <InboxIcon className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
              <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No messages yet</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {search ? "No messages match your search." : "Your inbox is currently empty."}
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
                  onClick={() => {
                    if (!msg.isRead) {
                      markReadMutation.mutate({
                        id: msg.id,
                        mailboxId: activeMailboxId,
                      });
                    }
                  }}
                  className={`group flex items-center gap-6 px-6 py-4 cursor-pointer transition-colors hover:bg-[hsl(var(--accent))] ${
                    !msg.isRead ? "bg-[hsl(var(--primary))]/[0.03]" : ""
                  }`}
                >
                  <div className="shrink-0">
                    {msg.isRead ? (
                      <MailOpen className="h-5 w-5 text-[hsl(var(--outline))]" />
                    ) : (
                      <Mail className="h-5 w-5 text-[hsl(var(--primary))]" />
                    )}
                  </div>
                  <div className="w-40 shrink-0">
                    <span className={`block truncate text-sm ${
                      !msg.isRead
                        ? "font-extrabold text-[hsl(var(--foreground))]"
                        : "font-semibold text-[hsl(var(--primary))]"
                    }`}>
                      {msg.fromName || msg.fromAddress}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    <span className={`truncate text-sm ${
                      !msg.isRead
                        ? "font-semibold text-[hsl(var(--foreground))]"
                        : "font-medium text-[hsl(var(--foreground))]"
                    }`}>
                      {msg.subject || "(No subject)"}
                    </span>
                    {msg.hasAttachments && (
                      <Paperclip className="h-3 w-3 shrink-0 text-[hsl(var(--outline))]" />
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-medium text-[hsl(var(--outline))] whitespace-nowrap">
                    {formatDate(msg.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {messages.length > 0 && (
            <div className="px-6 py-3 flex items-center justify-end text-xs font-medium text-[hsl(var(--outline))]">
              <span>{total} message{total !== 1 ? "s" : ""}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const oneDay = 86400000;

  if (diff < oneDay && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < oneDay * 2) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
