import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Mail, Lock, Check, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiResponse, UserInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<{ data: UserInfo }>("/auth/me"),
  });
  const user = data?.data;

  return (
    <div className="px-8 py-6">
      <h2 className="mb-6 font-[family-name:var(--font-headline)] text-lg font-bold">
        Admin Profile
      </h2>

      {isLoading && (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-[hsl(var(--primary))]" />
        </div>
      )}

      {user && (
        <div className="space-y-6">
          <AccountCard user={user} queryClient={queryClient} />
          <PasswordCard />
        </div>
      )}
    </div>
  );
}

// ─── Account Card ─────────────────────────────────────────────────────────

function AccountCard({
  user,
  queryClient,
}: {
  user: UserInfo;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  // Keep input in sync if the upstream user changes.
  useEffect(() => {
    setDisplayName(user.displayName);
  }, [user.displayName]);

  const mutation = useMutation({
    mutationFn: (input: { displayName: string }) =>
      api.patch<ApiResponse<UserInfo>>("/auth/me", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      setStatus("saved");
      setError("");
      setTimeout(() => setStatus("idle"), 2000);
    },
    onError: (err: Error) => {
      setStatus("error");
      setError(err.message);
    },
  });

  const dirty = displayName.trim() !== user.displayName;
  const canSave = dirty && displayName.trim().length > 0 && !mutation.isPending;

  return (
    <section className="rounded-2xl bg-[hsl(var(--card))] p-6">
      <h3 className="mb-1 font-[family-name:var(--font-headline)] text-base font-bold">
        Account
      </h3>
      <p className="mb-5 text-xs text-[hsl(var(--muted-foreground))]">
        Basic identity shown across EdgeMail.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReadOnlyField label="Email" icon={Mail} value={user.email} />
        <ReadOnlyField
          label="Role"
          icon={Shield}
          value={user.role}
          valueClassName="capitalize"
        />
        {user.createdAt && (
          <ReadOnlyField
            label="Admin since"
            icon={Shield}
            value={new Date(user.createdAt).toLocaleDateString()}
          />
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) mutation.mutate({ displayName: displayName.trim() });
        }}
        className="mt-5"
      >
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          Display Name
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={displayName}
            maxLength={100}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setStatus("idle");
            }}
            className="flex-1 rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-4 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canSave}
            className="h-11 rounded-lg gradient-primary px-5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>

        {status === "saved" && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">
            <Check className="h-3.5 w-3.5" />
            Saved
          </p>
        )}
        {status === "error" && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-[hsl(var(--destructive))]">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

// ─── Password Card ────────────────────────────────────────────────────────

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<ApiResponse<never>>("/auth/password", input),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("saved");
      setError("");
      setTimeout(() => setStatus("idle"), 4000);
    },
    onError: (err: Error) => {
      setStatus("error");
      setError(err.message);
    },
  });

  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    currentPassword !== newPassword &&
    !mutation.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({ currentPassword, newPassword });
  };

  return (
    <section className="rounded-2xl bg-[hsl(var(--card))] p-6">
      <h3 className="mb-1 font-[family-name:var(--font-headline)] text-base font-bold">
        Change Password
      </h3>
      <p className="mb-5 text-xs text-[hsl(var(--muted-foreground))]">
        Updating your password signs out all other active sessions. Minimum 8
        characters.
      </p>

      <form onSubmit={onSubmit} className="max-w-md space-y-4">
        <PasswordInput
          label="Current password"
          value={currentPassword}
          onChange={(v) => {
            setCurrentPassword(v);
            setStatus("idle");
          }}
          autoComplete="current-password"
        />
        <PasswordInput
          label="New password"
          value={newPassword}
          onChange={(v) => {
            setNewPassword(v);
            setStatus("idle");
          }}
          autoComplete="new-password"
          hint={
            newPassword.length > 0 && newPassword.length < 8
              ? `${newPassword.length}/8 characters`
              : undefined
          }
        />
        <PasswordInput
          label="Confirm new password"
          value={confirmPassword}
          onChange={(v) => {
            setConfirmPassword(v);
            setStatus("idle");
          }}
          autoComplete="new-password"
          hint={mismatch ? "Passwords don't match" : undefined}
          hintTone={mismatch ? "error" : "muted"}
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="h-10 rounded-lg gradient-primary px-5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
          >
            {mutation.isPending ? "Updating..." : "Update password"}
          </button>

          {status === "saved" && (
            <p className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="h-3.5 w-3.5" />
              Password updated. Other sessions signed out.
            </p>
          )}
          {status === "error" && (
            <p className="inline-flex items-center gap-1 text-xs text-[hsl(var(--destructive))]">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function ReadOnlyField({
  label,
  icon: Icon,
  value,
  valueClassName,
}: {
  label: string;
  icon: typeof Mail;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--accent))] px-3 py-2.5 text-sm">
        <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--outline))]" />
        <span className={`truncate ${valueClassName ?? ""}`}>{value}</span>
      </div>
    </div>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  hintTone = "muted",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
  hintTone?: "muted" | "error";
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--outline))]" />
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="w-full rounded-t-lg border-b-2 border-[hsl(var(--outline-variant))] bg-[hsl(var(--input))] px-10 py-3 text-sm placeholder:text-[hsl(var(--outline))] transition-all focus:border-[hsl(var(--primary))] focus:bg-white focus:outline-none"
        />
      </div>
      {hint && (
        <p
          className={`mt-1 text-xs ${
            hintTone === "error"
              ? "text-[hsl(var(--destructive))]"
              : "text-[hsl(var(--muted-foreground))]"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
