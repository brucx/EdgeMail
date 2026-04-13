import { createFileRoute, redirect } from "@tanstack/react-router";
import { api, ApiError } from "@/lib/api";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // Check system initialization first, then auth status.
    // Redirect to /setup if not initialized, /login if not authed,
    // /inbox if everything is good.
    try {
      const status = await api.get<{ initialized: boolean }>("/setup/status");
      if (!status.initialized) {
        throw redirect({ to: "/setup" });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        // If setup endpoint returns error, assume not initialized
        throw redirect({ to: "/setup" });
      }
      throw error; // re-throw redirect
    }

    // System is initialized — redirect to inbox (auth will be checked by _authenticated)
    throw redirect({ to: "/inbox" });
  },
});
