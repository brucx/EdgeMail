import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Search, Mail, MailOpen, Paperclip } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MessageSummary, MailboxInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const queryClient = useQueryClient();
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => api.get<{ data: MailboxInfo[] }>("/mailboxes"),
  });

  const mailboxes = mailboxesData?.data ?? [];

  // Auto-select first mailbox
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
    <div className="animate-fade-in flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-4">
        <div className="flex items-center gap-3">
          <InboxIcon className="h-6 w-6 text-[hsl(var(--primary))]" />
          <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
          {total > 0 && (
            <span className="rounded-full bg-[hsl(var(--primary))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--primary-foreground))]">
              {total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Mailbox selector */}
          {mailboxes.length > 1 && (
            <select
              value={activeMailboxId}
              onChange={(e) => setSelectedMailboxId(e.target.value)}
              className="h-9 rounded-lg border border-[hsl(var(--input))] bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            >
              {mailboxes.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.address}
                </option>
              ))}
            </select>
          )}
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="h-9 w-64 rounded-lg border border-[hsl(var(--input))] bg-transparent pl-9 pr-3 text-sm placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* No mailbox selected */}
        {!activeMailboxId && (
          <div className="flex flex-col items-center justify-center py-24">
            <InboxIcon className="mb-4 h-12 w-12 text-[hsl(var(--muted-foreground))]" />
            <h2 className="text-lg font-semibold">No mailbox available</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Create a mailbox first to start receiving emails.
            </p>
          </div>
        )}

        {/* Loading */}
        {activeMailboxId && isLoading && (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
          </div>
        )}

        {/* Empty state */}
        {activeMailboxId && !isLoading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24">
            <InboxIcon className="mb-4 h-12 w-12 text-[hsl(var(--muted-foreground))]" />
            <h2 className="text-lg font-semibold">No messages yet</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {search ? "No messages match your search." : "Configure your domain to start receiving emails."}
            </p>
          </div>
        )}

        {/* Message list */}
        {messages.length > 0 && (
          <div className="divide-y divide-[hsl(var(--border))]">
            {messages.map((msg) => (
              <Link
                key={msg.id}
                to="/messages/$id"
                params={{ id: msg.id }}
                onClick={() => {
                  if (!msg.isRead) {
                    markReadMutation.mutate({
                      id: msg.id,
                      mailboxId: activeMailboxId,
                    });
                  }
                }}
                className={`flex items-start gap-4 px-6 py-4 transition-colors hover:bg-[hsl(var(--accent))] ${
                  !msg.isRead ? "bg-[hsl(var(--accent))]/50" : ""
                }`}
              >
                <div className="mt-1 shrink-0">
                  {msg.isRead ? (
                    <MailOpen className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                  ) : (
                    <Mail className="h-5 w-5 text-[hsl(var(--primary))]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p
                      className={`truncate text-sm ${
                        !msg.isRead ? "font-semibold" : "font-medium text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      {msg.fromName || msg.fromAddress}
                    </p>
                    <span className="ml-4 shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
                      {new Date(msg.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 truncate text-sm ${
                      !msg.isRead ? "font-medium" : "text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    {msg.subject || "(No subject)"}
                  </p>
                  {msg.hasAttachments && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                      <Paperclip className="h-3 w-3" />
                      Attachment
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
