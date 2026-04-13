import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, Clock, Download, User } from "lucide-react";
import { api } from "@/lib/api";
import type { MessageDetail } from "@shared/types";

export const Route = createFileRoute("/_authenticated/messages/$id")({
  component: MessageDetailPage,
});

function MessageDetailPage() {
  const { id } = Route.useParams();

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
      <div className="animate-fade-in p-6">
        <Link
          to="/inbox"
          className="mb-4 inline-flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Inbox
        </Link>
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
          <p className="text-sm text-red-500">
            {error?.message || "Message not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in p-6">
      {/* Back button */}
      <Link
        to="/inbox"
        className="mb-4 inline-flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Inbox
      </Link>

      {/* Message Card */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {/* Header */}
        <div className="border-b border-[hsl(var(--border))] p-6">
          <h1 className="mb-3 text-xl font-bold tracking-tight">
            {message.subject || "(No subject)"}
          </h1>

          {/* From */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--accent))]">
              <User className="h-5 w-5 text-[hsl(var(--primary))]" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                {message.fromName || message.fromAddress}
              </p>
              {message.fromName && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {message.fromAddress}
                </p>
              )}
            </div>
            <span className="ml-auto flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
              <Clock className="h-3.5 w-3.5" />
              {new Date(message.createdAt).toLocaleString()}
            </span>
          </div>

          {/* Recipients */}
          {message.recipients && message.recipients.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
              {["to", "cc", "bcc"].map((type) => {
                const addrs = message.recipients.filter(
                  (r) => r.type === type,
                );
                if (addrs.length === 0) return null;
                return (
                  <div key={type} className="flex gap-2">
                    <span className="font-medium uppercase">{type}:</span>
                    <span>{addrs.map((r) => r.address).join(", ")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Body */}
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
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              (No content)
            </p>
          )}
        </div>

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="border-t border-[hsl(var(--border))] p-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Paperclip className="h-4 w-4" />
              {message.attachments.length} Attachment
              {message.attachments.length > 1 ? "s" : ""}
            </div>
            <div className="space-y-2">
              {message.attachments.map((att) => (
                <a
                  key={att.id}
                  href={`/api/messages/${id}/attachments/${att.id}`}
                  download={att.filename}
                  className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] p-3 transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  <Download className="h-4 w-4 text-[hsl(var(--primary))]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {att.filename}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {att.mimeType} · {formatSize(att.size)}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* No attachments */}
        {(!message.attachments || message.attachments.length === 0) && (
          <div className="border-t border-[hsl(var(--border))] p-6">
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
              <Paperclip className="h-4 w-4" />
              <span>No attachments</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
