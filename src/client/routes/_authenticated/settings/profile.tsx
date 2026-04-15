import { createFileRoute } from "@tanstack/react-router";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div className="px-8 py-6">
      <h2 className="mb-6 font-[family-name:var(--font-headline)] text-lg font-bold">
        Admin Profile
      </h2>
      <div className="flex flex-col items-center justify-center rounded-2xl bg-[hsl(var(--card))] py-24">
        <Shield className="mb-4 h-12 w-12 text-[hsl(var(--outline))]" />
        <h3 className="font-[family-name:var(--font-headline)] text-lg font-semibold">Coming Soon</h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Manage your admin account details and password.
        </p>
      </div>
    </div>
  );
}
