import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { api, ApiError } from "@/lib/api";
import type { DomainInfo } from "@shared/types";

export const Route = createFileRoute("/_authenticated/d/$domainId")({
  beforeLoad: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData({
        queryKey: ["domain", params.domainId],
        queryFn: () => api.get<{ data: DomainInfo }>(`/domains/${params.domainId}`),
      });
    } catch {
      throw redirect({ to: "/" });
    }
  },
  component: DomainLayout,
});

function DomainLayout() {
  return <Outlet />;
}
