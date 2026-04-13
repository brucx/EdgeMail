import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon, Shield, Key, Database, Globe } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="animate-fade-in p-6">
      <div className="mb-6 flex items-center gap-3">
        <SettingsIcon className="h-6 w-6 text-[hsl(var(--primary))]" />
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Admin Profile */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
          <div className="mb-4 flex items-center gap-3">
            <Shield className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-semibold">Admin Profile</h2>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Manage your admin account details and password.
          </p>
        </div>

        {/* Resend Configuration */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
          <div className="mb-4 flex items-center gap-3">
            <Key className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-semibold">Resend Configuration</h2>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Verify your Resend API key and sending configuration.
          </p>
        </div>

        {/* Storage */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
          <div className="mb-4 flex items-center gap-3">
            <Database className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-semibold">Storage Usage</h2>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            View D1 and R2 storage consumption.
          </p>
        </div>

        {/* Domain Guide */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
          <div className="mb-4 flex items-center gap-3">
            <Globe className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-semibold">Domain Setup Guide</h2>
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Instructions for configuring MX records and email routing.
          </p>
        </div>
      </div>
    </div>
  );
}
