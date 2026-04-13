import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Send as SendIcon, Mail, Paperclip } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MessageSummary, MailboxInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/sent")({
  component: SentPage,
});

function SentPage() {
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>("");

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => api.get<{ data: MailboxInfo[] }>("/mailboxes"),
  });

  const mailboxes = (mailboxesData?.data ?? []).filter((mb) => mb.canSend);
  const activeMailboxId = selectedMailboxId || mailboxes[0]?.id || "";

  const { data: messagesData, isLoading } = useQuery({
    queryKey: ["messages", "sent", activeMailboxId],
    queryFn: () => {
      const params = new URLSearchParams({
        mailboxId: activeMailboxId,
        folder: "sent",
      });
      return api.get<{ data: MessageSummary[]; total: number }>(
        `/messages?${params}`,
      );
    },
    enabled: !!activeMailboxId,
  });

  const messages = messagesData?.data ?? [];

  return (
    <div className="animate-fade-in flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-4">
        <div className="flex items-center gap-3">
          <SendIcon className="h-6 w-6 text-[hsl(var(--primary))]" />
          <h1 className="text-2xl font-bold tracking-tight">Sent</h1>
        </div>
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24">
            <SendIcon className="mb-4 h-12 w-12 text-[hsl(var(--muted-foreground))]" />
            <h2 className="text-lg font-semibold">No sent messages</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Messages you send will appear here.
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
                className="flex items-start gap-4 px-6 py-4 transition-colors hover:bg-[hsl(var(--accent))]"
              >
                <div className="mt-1 shrink-0">
                  <Mail className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium">
                      To: {msg.fromAddress}
                    </p>
                    <span className="ml-4 shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
                      {new Date(msg.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-[hsl(var(--muted-foreground))]">
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
