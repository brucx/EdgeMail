import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import type { MailboxInfo, ApiResponse } from "@shared/types";

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  domainId: string | undefined;
}

export function ComposeModal({ open, onClose, domainId }: ComposeModalProps) {
  const queryClient = useQueryClient();

  const [from, setFrom] = useState("");
  const [toInput, setToInput] = useState("");
  const [toAddresses, setToAddresses] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [ccAddresses, setCcAddresses] = useState<string[]>([]);
  const [bccInput, setBccInput] = useState("");
  const [bccAddresses, setBccAddresses] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [error, setError] = useState("");

  const toInputRef = useRef<HTMLInputElement>(null);

  // Fetch sendable mailboxes for current domain
  const { data: mailboxesData } = useQuery({
    queryKey: ["mailboxes", { domainId }],
    queryFn: () =>
      api.get<{ data: MailboxInfo[] }>(`/mailboxes?domainId=${domainId}`),
    enabled: open && !!domainId,
  });

  const sendableMailboxes = (mailboxesData?.data ?? []).filter(
    (mb) => mb.canSend,
  );

  // Auto-select first sendable mailbox
  useEffect(() => {
    if (sendableMailboxes.length > 0 && !from) {
      setFrom(sendableMailboxes[0].address);
    }
  }, [sendableMailboxes, from]);

  // Focus "To" input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => toInputRef.current?.focus(), 100);
    }
  }, [open]);

  const sendMutation = useMutation({
    mutationFn: (payload: {
      from: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      text?: string;
    }) => api.post<ApiResponse<{ id: string }>>("/send", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", "sent"] });
      handleClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleClose = () => {
    setFrom("");
    setToInput("");
    setToAddresses([]);
    setCcInput("");
    setCcAddresses([]);
    setBccInput("");
    setBccAddresses([]);
    setSubject("");
    setBody("");
    setShowCcBcc(false);
    setError("");
    sendMutation.reset();
    onClose();
  };

  const addAddress = (
    input: string,
    setInput: (v: string) => void,
    addresses: string[],
    setAddresses: (v: string[]) => void,
  ) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    if (!addresses.includes(trimmed)) {
      setAddresses([...addresses, trimmed]);
    }
    setInput("");
  };

  const removeAddress = (
    addr: string,
    addresses: string[],
    setAddresses: (v: string[]) => void,
  ) => {
    setAddresses(addresses.filter((a) => a !== addr));
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    input: string,
    setInput: (v: string) => void,
    addresses: string[],
    setAddresses: (v: string[]) => void,
  ) => {
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      e.preventDefault();
      addAddress(input, setInput, addresses, setAddresses);
    }
    if (e.key === "Backspace" && !input && addresses.length > 0) {
      setAddresses(addresses.slice(0, -1));
    }
  };

  const handleSend = () => {
    // Commit any pending input in To field
    if (toInput.trim()) {
      const trimmed = toInput.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        const finalTo = [...toAddresses, trimmed];
        setToAddresses(finalTo);
        setToInput("");
        doSend(finalTo);
        return;
      }
    }
    doSend(toAddresses);
  };

  const doSend = (to: string[]) => {
    setError("");

    if (!from) {
      setError("Please select a sender address.");
      return;
    }
    if (to.length === 0) {
      setError("Please add at least one recipient.");
      return;
    }
    if (!subject.trim()) {
      setError("Please enter a subject.");
      return;
    }

    sendMutation.mutate({
      from,
      to,
      cc: ccAddresses.length > 0 ? ccAddresses : undefined,
      bcc: bccAddresses.length > 0 ? bccAddresses : undefined,
      subject: subject.trim(),
      text: body || undefined,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-sm">
      <div className="glass-panel flex w-full max-w-2xl flex-col rounded-t-2xl sm:rounded-2xl shadow-ambient max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--outline-variant))]/10">
          <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold text-[hsl(var(--foreground))]">
            New Message
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-[hsl(var(--accent))]"
          >
            <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-3">
          {/* From */}
          <div className="flex items-center gap-3">
            <label className="w-12 shrink-0 text-sm font-medium text-[hsl(var(--muted-foreground))]">
              From
            </label>
            <div className="relative flex-1">
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full appearance-none rounded-lg bg-[hsl(var(--accent))] px-3 py-2 pr-8 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20 border-none"
              >
                {sendableMailboxes.length === 0 && (
                  <option value="" disabled>
                    No sendable mailboxes
                  </option>
                )}
                {sendableMailboxes.map((mb) => (
                  <option key={mb.id} value={mb.address}>
                    {mb.displayName} &lt;{mb.address}&gt;
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--outline))]" />
            </div>
          </div>

          {/* To */}
          <AddressField
            label="To"
            addresses={toAddresses}
            input={toInput}
            setInput={setToInput}
            onAdd={() =>
              addAddress(toInput, setToInput, toAddresses, setToAddresses)
            }
            onRemove={(addr) =>
              removeAddress(addr, toAddresses, setToAddresses)
            }
            onKeyDown={(e) =>
              handleKeyDown(
                e,
                toInput,
                setToInput,
                toAddresses,
                setToAddresses,
              )
            }
            inputRef={toInputRef}
            rightAction={
              !showCcBcc ? (
                <button
                  onClick={() => setShowCcBcc(true)}
                  className="shrink-0 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                >
                  Cc/Bcc
                </button>
              ) : undefined
            }
          />

          {/* CC */}
          {showCcBcc && (
            <>
              <AddressField
                label="Cc"
                addresses={ccAddresses}
                input={ccInput}
                setInput={setCcInput}
                onAdd={() =>
                  addAddress(ccInput, setCcInput, ccAddresses, setCcAddresses)
                }
                onRemove={(addr) =>
                  removeAddress(addr, ccAddresses, setCcAddresses)
                }
                onKeyDown={(e) =>
                  handleKeyDown(
                    e,
                    ccInput,
                    setCcInput,
                    ccAddresses,
                    setCcAddresses,
                  )
                }
              />
              <AddressField
                label="Bcc"
                addresses={bccAddresses}
                input={bccInput}
                setInput={setBccInput}
                onAdd={() =>
                  addAddress(
                    bccInput,
                    setBccInput,
                    bccAddresses,
                    setBccAddresses,
                  )
                }
                onRemove={(addr) =>
                  removeAddress(addr, bccAddresses, setBccAddresses)
                }
                onKeyDown={(e) =>
                  handleKeyDown(
                    e,
                    bccInput,
                    setBccInput,
                    bccAddresses,
                    setBccAddresses,
                  )
                }
              />
            </>
          )}

          {/* Subject */}
          <div className="flex items-center gap-3">
            <label className="w-12 shrink-0 text-sm font-medium text-[hsl(var(--muted-foreground))]">
              Subj
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 rounded-lg bg-[hsl(var(--accent))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--outline))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20 border-none"
            />
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={10}
            className="w-full resize-none rounded-lg bg-[hsl(var(--accent))] px-4 py-3 text-sm leading-relaxed text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--outline))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20 border-none"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[hsl(var(--outline-variant))]/10 px-6 py-4">
          <div className="flex-1">
            {error && (
              <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))]"
            >
              Discard
            </button>
            <button
              onClick={handleSend}
              disabled={sendMutation.isPending || sendableMailboxes.length === 0}
              className="inline-flex items-center gap-2 rounded-xl gradient-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[hsl(var(--primary))]/10 transition-all active:scale-[0.98] hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Address Input Field ─────────────────────────────────────────────────────

function AddressField({
  label,
  addresses,
  input,
  setInput,
  onAdd,
  onRemove,
  onKeyDown,
  inputRef,
  rightAction,
}: {
  label: string;
  addresses: string[];
  input: string;
  setInput: (v: string) => void;
  onAdd: () => void;
  onRemove: (addr: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  rightAction?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <label className="mt-2 w-12 shrink-0 text-sm font-medium text-[hsl(var(--muted-foreground))]">
        {label}
      </label>
      <div className="flex flex-1 flex-wrap items-center gap-1.5 rounded-lg bg-[hsl(var(--accent))] px-2 py-1.5 min-h-[36px] focus-within:ring-2 focus-within:ring-[hsl(var(--ring))]/20">
        {addresses.map((addr) => (
          <span
            key={addr}
            className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--card))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--foreground))] shadow-sm"
          >
            {addr}
            <button
              onClick={() => onRemove(addr)}
              className="rounded-sm p-0.5 hover:bg-[hsl(var(--accent))]"
            >
              <X className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (input.trim()) onAdd();
          }}
          placeholder={addresses.length === 0 ? "email@example.com" : ""}
          className="min-w-[120px] flex-1 border-none bg-transparent px-1 py-0.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--outline))] focus:outline-none"
        />
        {rightAction}
      </div>
    </div>
  );
}
