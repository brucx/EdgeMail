import { createFileRoute } from "@tanstack/react-router";
import { Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/resend")({
  component: ResendPage,
});

function ResendPage() {
  return (
    <div className="px-8 py-6">
      <h2 className="mb-6 font-[family-name:var(--font-headline)] text-lg font-bold">
        Resend Configuration
      </h2>
      <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
        <Mail className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
        <h3 className="font-[family-name:var(--font-headline)] text-lg font-semibold">Coming Soon</h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Verify your Resend API key and sending configuration.
        </p>
      </div>
    </div>
  );
}
