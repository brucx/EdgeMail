import { createFileRoute, redirect } from "@tanstack/react-router";
import { api, ApiError } from "@/lib/api";
import type { DomainInfo } from "@shared/types";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    // 1. Check system initialization
    try {
      const status = await api.get<{ initialized: boolean }>("/setup/status");
      if (!status.initialized) {
        throw redirect({ to: "/setup" });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw redirect({ to: "/setup" });
      }
      throw error; // re-throw redirect
    }

    // 2. Check auth
    try {
      await context.queryClient.ensureQueryData({
        queryKey: ["auth", "me"],
        queryFn: () => api.get<{ data: any }>("/auth/me"),
      });
    } catch {
      throw redirect({ to: "/login" });
    }

    // 3. Check domains
    const domainsResult = await context.queryClient.ensureQueryData({
      queryKey: ["domains"],
      queryFn: () => api.get<{ data: DomainInfo[] }>("/domains"),
    });

    const domains = domainsResult.data ?? [];
    if (domains.length === 0) {
      throw redirect({ to: "/onboarding" });
    }

    // 4. Redirect to first domain's inbox
    throw redirect({
      to: "/d/$domainId/inbox",
      params: { domainId: domains[0].id },
    });
  },
});
