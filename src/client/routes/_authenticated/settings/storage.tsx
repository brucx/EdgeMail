import { createFileRoute } from "@tanstack/react-router";
import { Database } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/storage")({
  component: StoragePage,
});

function StoragePage() {
  return (
    <div className="px-8 py-6">
      <h2 className="mb-6 font-[family-name:var(--font-headline)] text-lg font-bold">
        Storage Usage
      </h2>
      <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
        <Database className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
        <h3 className="font-[family-name:var(--font-headline)] text-lg font-semibold">Coming Soon</h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          View D1 and R2 storage consumption.
        </p>
      </div>
    </div>
  );
}
