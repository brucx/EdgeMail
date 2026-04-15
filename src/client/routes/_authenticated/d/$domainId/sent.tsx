import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Send as SendIcon, Mail, Paperclip } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MessageSummary, MailboxInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/sent")({
  component: SentPage,
});

function SentPage() {
  const { domainId } = Route.useParams();
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>("");

  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes", { domainId }],
    queryFn: () => api.get<{ data: MailboxInfo[] }>(`/mailboxes?domainId=${domainId}`),
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
    <div className="animate-fade-in flex h-full flex-col bg-[hsl(var(--accent))]">
      {/* Page header */}
      <div className="px-8 py-6 flex items-center justify-end">
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
      </div>

      <section className="mx-8 mb-8 flex-1 bg-[hsl(var(--card))] rounded-2xl overflow-hidden flex flex-col shadow-sm">
        {isLoading && (
          <div className="flex flex-1 justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
          </div>
        )}

        {!isLoading && messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center py-24">
            <SendIcon className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
            <h2 className="font-[family-name:var(--font-headline)] text-lg font-semibold">No sent messages</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Messages you send will appear here.
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
                className="group flex items-center gap-6 px-6 py-4 cursor-pointer transition-colors hover:bg-[hsl(var(--accent))]"
              >
                <div className="shrink-0">
                  <Mail className="h-5 w-5 text-[hsl(var(--outline))]" />
                </div>
                <div className="w-40 shrink-0">
                  <span className="block truncate text-sm font-semibold text-[hsl(var(--primary))]">
                    To: {msg.fromAddress}
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
  );
}
