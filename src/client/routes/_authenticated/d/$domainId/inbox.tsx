import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Search, Mail, MailOpen, Paperclip } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MessageSummary, MailboxInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const { domainId } = Route.useParams();
  const queryClient = useQueryClient();
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes", { domainId }],
    queryFn: () => api.get<{ data: MailboxInfo[] }>(`/mailboxes?domainId=${domainId}`),
  });

  const mailboxes = mailboxesData?.data ?? [];
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["messages"] }),
  });

  const messages = messagesData?.data ?? [];
  const total = messagesData?.total ?? 0;

  return (
    <div className="animate-fade-in flex h-full flex-col bg-[hsl(var(--accent))]">
      {/* Page header */}
      <div className="px-8 py-6 flex items-center justify-end">
        <div className="flex items-center gap-2">
          {mailboxes.length > 1 && (
            <select
              value={activeMailboxId}
              onChange={(e) => setSelectedMailboxId(e.target.value)}
              className="h-9 rounded-full bg-[hsl(var(--card))] px-4 text-xs font-semibold text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20 border-none"
            >
              {mailboxes.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.address}
                </option>
              ))}
            </select>
          )}
          <div className="relative lg:hidden">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--outline))]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-9 w-48 rounded-full border-none bg-[hsl(var(--card))] pl-9 pr-3 text-sm placeholder:text-[hsl(var(--outline))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20"
            />
          </div>
        </div>
      </div>

      {/* Email list container */}
      <section className="mx-8 mb-8 flex-1 bg-[hsl(var(--card))] rounded-2xl overflow-hidden flex flex-col shadow-sm">
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
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
          </div>
        )}

        {activeMailboxId && !isLoading && messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center py-24">
            <InboxIcon className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
            <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No messages yet</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {search ? "No messages match your search." : "Configure your domain to start receiving emails."}
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
