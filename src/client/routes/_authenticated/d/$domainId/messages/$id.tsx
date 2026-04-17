import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, Clock, ExternalLink, User } from "lucide-react";
import { api } from "@/lib/api";
import type { MessageDetail } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/messages/$id")({
  // `folder` tells us which list the user came from. Used for the back link,
  // the sidebar highlight (consumed in _authenticated.tsx), and to pick
  // whether to emphasise the sender ("From", for inbox) or the recipients
  // ("To", for sent). When absent we infer from deliveryStatus — only
  // outbound messages have one.
  validateSearch: (search: Record<string, unknown>): { folder?: "inbox" | "sent" } => {
    const f = search.folder;
    return f === "sent" || f === "inbox" ? { folder: f } : {};
  },
  component: MessageDetailPage,
});

function MessageDetailPage() {
  const { domainId, id } = Route.useParams();
  const { folder } = Route.useSearch();

  const { data, isLoading, error } = useQuery({
    queryKey: ["message", id],
    queryFn: () => api.get<{ data: MessageDetail }>(`/messages/${id}`),
  });

  const message = data?.data;
  // Resolve effective folder: URL param wins; otherwise infer from the
  // message itself (sent messages carry deliveryStatus; inbound don't).
  const effectiveFolder: "inbox" | "sent" =
    folder ?? (message?.deliveryStatus ? "sent" : "inbox");
  const backTo =
    effectiveFolder === "sent" ? "/d/$domainId/sent" : "/d/$domainId/inbox";
  const backLabel =
    effectiveFolder === "sent" ? "Back to Sent" : "Back to Inbox";

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-[hsl(var(--primary))]" />
      </div>
    );
  }

  if (error || !message) {
    return (
      <div className="animate-fade-in p-8 bg-[hsl(var(--accent))]">
        <Link
          to={backTo}
          params={{ domainId }}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
        <div className="rounded-2xl bg-[hsl(var(--card))] p-6">
          <p className="text-sm text-[hsl(var(--destructive))]">
            {error?.message || "Message not found"}
          </p>
        </div>
      </div>
    );
  }

  const isSent = effectiveFolder === "sent";
  const toRecipients = (message.recipients ?? []).filter((r) => r.type === "to");
  const primaryAddresses = isSent
    ? toRecipients.map((r) => r.address).join(", ") || "(no recipient)"
    : message.fromName || message.fromAddress;
  const secondaryAddresses = isSent
    ? `From: ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}`
    : message.fromName
      ? message.fromAddress
      : null;

  return (
    <div className="animate-fade-in bg-[hsl(var(--accent))] min-h-full">
      <div className="px-8 py-6">
        <Link
          to={backTo}
          params={{ domainId }}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>

        <div className="rounded-2xl bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          <div className="p-6 pb-5">
            <h1 className="font-[family-name:var(--font-headline)] mb-4 text-xl font-bold tracking-tight">
              {message.subject || "(No subject)"}
            </h1>
            {/* Sender / recipient header.
                Per DESIGN.md "Depth through tonal layering, not borders":
                no sub-card, no border — hierarchy is carried by the uppercase
                micro-label + font-weight delta against the surrounding white
                card. The section divider below (h-px outline-variant/15)
                already separates this block from the body. */}
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] mt-0.5">
                <User className="h-5 w-5 text-[hsl(var(--primary))]" />
              </div>
              <div className="min-w-0 flex-1">
                {isSent && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">
                    To
                  </p>
                )}
                <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
                  {primaryAddresses}
                </p>
                {secondaryAddresses && (
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))] truncate">
                    {secondaryAddresses}
                  </p>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-[hsl(var(--outline))] mt-1">
                <Clock className="h-3.5 w-3.5" />
                {new Date(message.createdAt).toLocaleString()}
              </span>
            </div>
            {message.recipients && message.recipients.length > 0 && (
              <div className="mt-3 space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
                {(isSent ? ["cc", "bcc"] : ["to", "cc", "bcc"]).map((type) => {
                  const addrs = message.recipients.filter((r) => r.type === type);
                  if (addrs.length === 0) return null;
                  return (
                    <div key={type} className="flex gap-2">
                      <span className="font-semibold uppercase">{type}:</span>
                      <span>{addrs.map((r) => r.address).join(", ")}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="h-px bg-[hsl(var(--outline-variant))]/15 mx-6" />
          <div className="p-6">
            {message.htmlBody ? (
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: message.htmlBody }}
              />
            ) : message.textBody ? (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {message.textBody}
              </pre>
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">(No content)</p>
            )}
          </div>
          {message.attachments && message.attachments.length > 0 && (
            <>
              <div className="h-px bg-[hsl(var(--outline-variant))]/15 mx-6" />
              <div className="p-6">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Paperclip className="h-4 w-4" />
                  {message.attachments.length} Attachment{message.attachments.length > 1 ? "s" : ""}
                </div>
                <div className="space-y-2">
                  {message.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={`/api/messages/${id}/attachments/${att.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl bg-[hsl(var(--accent))] p-3 transition-colors hover:bg-[hsl(var(--input))]"
                    >
                      <ExternalLink className="h-4 w-4 text-[hsl(var(--primary))]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{att.filename}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {att.mimeType} · {formatSize(att.size)}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
