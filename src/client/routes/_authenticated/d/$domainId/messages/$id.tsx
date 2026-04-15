import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, Clock, ExternalLink, User } from "lucide-react";
import { api } from "@/lib/api";
import type { MessageDetail } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId/messages/$id")({
  component: MessageDetailPage,
});

function MessageDetailPage() {
  const { domainId, id } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["message", id],
    queryFn: () => api.get<{ data: MessageDetail }>(`/messages/${id}`),
  });

  const message = data?.data;

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  if (error || !message) {
    return (
      <div className="animate-fade-in p-8 bg-[hsl(var(--accent))]">
        <Link
          to="/d/$domainId/inbox"
          params={{ domainId }}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Inbox
        </Link>
        <div className="rounded-2xl bg-[hsl(var(--card))] p-6">
          <p className="text-sm text-[hsl(var(--destructive))]">
            {error?.message || "Message not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in bg-[hsl(var(--accent))] min-h-full">
      <div className="px-8 py-6">
        <Link
          to="/d/$domainId/inbox"
          params={{ domainId }}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Inbox
        </Link>

        <div className="rounded-2xl bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          <div className="p-6 pb-5">
            <h1 className="font-[family-name:var(--font-headline)] mb-4 text-xl font-bold tracking-tight">
              {message.subject || "(No subject)"}
            </h1>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--secondary))]">
                <User className="h-5 w-5 text-[hsl(var(--primary))]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {message.fromName || message.fromAddress}
                </p>
                {message.fromName && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {message.fromAddress}
                  </p>
                )}
              </div>
              <span className="flex items-center gap-1 text-xs text-[hsl(var(--outline))]">
                <Clock className="h-3.5 w-3.5" />
                {new Date(message.createdAt).toLocaleString()}
              </span>
            </div>
            {message.recipients && message.recipients.length > 0 && (
              <div className="mt-3 space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
                {["to", "cc", "bcc"].map((type) => {
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
