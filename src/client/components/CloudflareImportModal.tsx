import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Cloud,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Globe,
  ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  CloudflareZone,
  CloudflareSetupResult,
  ApiResponse,
} from "@shared/types";

interface CloudflareImportModalProps {
  open: boolean;
  onClose: () => void;
}

type SetupStep = {
  key: keyof CloudflareSetupResult["steps"];
  label: string;
};

const SETUP_STEPS: SetupStep[] = [
  { key: "dns_mx", label: "Create MX record" },
  { key: "dns_spf", label: "Create SPF record" },
  { key: "routing_enable", label: "Enable Email Routing" },
  { key: "routing_catchall", label: "Configure catch-all rule" },
];

export function CloudflareImportModal({
  open,
  onClose,
}: CloudflareImportModalProps) {
  const queryClient = useQueryClient();
  const [selectedZone, setSelectedZone] = useState<CloudflareZone | null>(null);
  const [setupError, setSetupError] = useState("");
  const [conflictWarning, setConflictWarning] = useState<string[] | null>(null);

  const { data: zonesData, isLoading: zonesLoading } = useQuery({
    queryKey: ["cloudflare", "zones"],
    queryFn: () =>
      api.get<{ data: CloudflareZone[] }>("/cloudflare/zones"),
    enabled: open,
  });

  const setupMutation = useMutation({
    mutationFn: (params: {
      zoneId: string;
      domainName: string;
      existingDomainId?: string;
      forceOverwrite?: boolean;
      resumeFrom?: string;
    }) =>
      api.post<
        ApiResponse<CloudflareSetupResult> & {
          warning?: string;
          conflictingRecords?: string[];
        }
      >(`/cloudflare/zones/${params.zoneId}/setup`, {
        domainName: params.domainName,
        existingDomainId: params.existingDomainId || undefined,
        forceOverwrite: params.forceOverwrite || undefined,
        resumeFrom: params.resumeFrom || undefined,
      }),
    onSuccess: (result) => {
      // Check for conflict warning (409 is thrown as ApiError, but let's handle data-level warning too)
      if (result.warning && result.conflictingRecords) {
        setConflictWarning(result.conflictingRecords);
        return;
      }
      setConflictWarning(null);
      setSetupError("");
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      queryClient.invalidateQueries({ queryKey: ["cloudflare", "zones"] });
    },
    onError: (err: Error & { status?: number }) => {
      // Handle 409 conflict response
      if (err.status === 409) {
        try {
          // The error message may contain conflict info
          setSetupError(
            "Existing MX records found that conflict with Cloudflare Email Routing.",
          );
        } catch {
          setSetupError(err.message);
        }
        return;
      }
      setSetupError(err.message);
    },
  });

  const handleSetup = (zone: CloudflareZone, forceOverwrite = false) => {
    setSelectedZone(zone);
    setSetupError("");
    setConflictWarning(null);
    setupMutation.mutate({
      zoneId: zone.id,
      domainName: zone.name,
      existingDomainId: zone.existingDomainId ?? undefined,
      forceOverwrite,
    });
  };

  const handleRetry = () => {
    if (!selectedZone) return;
    // Determine resumeFrom based on last successful step
    const steps = setupMutation.data?.data?.steps;
    let resumeFrom: string | undefined;
    if (steps?.routing_enable === "success" || steps?.routing_enable === "skipped") {
      resumeFrom = "routing_enabled";
    } else if (steps?.dns_mx === "success" || steps?.dns_spf === "success") {
      resumeFrom = "dns_created";
    }

    setSetupError("");
    setupMutation.mutate({
      zoneId: selectedZone.id,
      domainName: selectedZone.name,
      existingDomainId: selectedZone.existingDomainId ?? undefined,
      resumeFrom,
    });
  };

  const handleClose = () => {
    setSelectedZone(null);
    setSetupError("");
    setConflictWarning(null);
    setupMutation.reset();
    onClose();
  };

  const isSetupComplete =
    setupMutation.isSuccess &&
    !conflictWarning &&
    setupMutation.data?.data?.steps &&
    Object.values(setupMutation.data.data.steps).every(
      (s) => s === "success" || s === "skipped",
    );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-lg rounded-2xl p-6 shadow-ambient">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {selectedZone && (
              <button
                onClick={() => {
                  setSelectedZone(null);
                  setupMutation.reset();
                  setSetupError("");
                  setConflictWarning(null);
                }}
                className="rounded-lg p-1 transition-colors hover:bg-[hsl(var(--accent))]"
              >
                <ArrowLeft className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
              </button>
            )}
            <Cloud className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="font-[family-name:var(--font-headline)] text-lg font-bold">
              {selectedZone
                ? `Setup ${selectedZone.name}`
                : "Import from Cloudflare"}
            </h2>
          </div>
          <button onClick={handleClose}>
            <X className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          </button>
        </div>

        {/* Zone List View */}
        {!selectedZone && (
          <div>
            {zonesLoading && (
              <div className="flex justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
              </div>
            )}

            {!zonesLoading && (!zonesData?.data || zonesData.data.length === 0) && (
              <div className="flex flex-col items-center justify-center py-12">
                <Globe className="mb-3 h-10 w-10 text-[hsl(var(--outline))]" />
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  No active domains found in your Cloudflare account.
                </p>
              </div>
            )}

            {!zonesLoading && zonesData?.data && zonesData.data.length > 0 && (
              <div className="max-h-80 space-y-2 overflow-y-auto custom-scrollbar">
                {zonesData.data.map((zone) => (
                  <div
                    key={zone.id}
                    className="flex items-center justify-between rounded-xl bg-[hsl(var(--accent))] p-3 transition-colors hover:bg-[hsl(var(--input))]"
                  >
                    <div className="flex items-center gap-3">
                      <Globe className="h-4 w-4 text-[hsl(var(--primary))]" />
                      <span className="text-sm font-medium">{zone.name}</span>
                    </div>
                    {zone.linked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600">
                        <CheckCircle className="h-3 w-3" />
                        Configured
                      </span>
                    ) : zone.existingDomainId ? (
                      <button
                        onClick={() => handleSetup(zone)}
                        className="rounded-lg bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary))] shadow-sm transition-all hover:shadow-md"
                      >
                        Link & Configure
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetup(zone)}
                        className="rounded-lg gradient-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md"
                      >
                        Setup
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Setup Progress View */}
        {selectedZone && (
          <div>
            {/* Conflict Warning */}
            {conflictWarning && (
              <div className="mb-4 rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Existing MX records found
                    </p>
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      The following records will be replaced:
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {conflictWarning.map((r, i) => (
                        <li
                          key={i}
                          className="font-[family-name:var(--font-mono)] text-xs text-amber-700 dark:text-amber-400"
                        >
                          {r}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleSetup(selectedZone, true)}
                        className="rounded-lg gradient-primary px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Replace & Continue
                      </button>
                      <button
                        onClick={() => {
                          setConflictWarning(null);
                          setSelectedZone(null);
                          setupMutation.reset();
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step Progress */}
            {!conflictWarning && (
              <div className="space-y-3">
                {SETUP_STEPS.map((step, stepIndex) => {
                  const allSteps = setupMutation.data?.data?.steps;
                  const stepResult = allSteps?.[step.key];
                  const isRunning = setupMutation.isPending && !stepResult;
                  const firstPendingIdx = allSteps
                    ? SETUP_STEPS.findIndex((s) => !allSteps[s.key])
                    : 0;
                  const isWaiting =
                    isRunning && stepIndex > firstPendingIdx;

                  return (
                    <div
                      key={step.key}
                      className="flex items-center gap-3 rounded-lg px-3 py-2"
                    >
                      {stepResult === "success" ? (
                        <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
                      ) : stepResult === "skipped" ? (
                        <CheckCircle className="h-5 w-5 shrink-0 text-[hsl(var(--outline))]" />
                      ) : stepResult === "error" ? (
                        <XCircle className="h-5 w-5 shrink-0 text-[hsl(var(--destructive))]" />
                      ) : isRunning && !isWaiting ? (
                        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--primary))]" />
                      ) : (
                        <div className="h-5 w-5 shrink-0 rounded-full border-2 border-[hsl(var(--outline-variant))]" />
                      )}
                      <span
                        className={`text-sm ${
                          stepResult === "success"
                            ? "text-[hsl(var(--foreground))]"
                            : stepResult === "error"
                              ? "text-[hsl(var(--destructive))]"
                              : stepResult === "skipped"
                                ? "text-[hsl(var(--outline))]"
                                : "text-[hsl(var(--muted-foreground))]"
                        }`}
                      >
                        {step.label}
                        {stepResult === "skipped" && (
                          <span className="ml-1 text-xs">(already exists)</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Error */}
            {setupError && !conflictWarning && (
              <div className="mt-4 rounded-xl bg-[hsl(var(--destructive))]/10 px-4 py-3">
                <p className="text-sm text-[hsl(var(--destructive))]">
                  {setupError}
                </p>
              </div>
            )}

            {/* Action buttons */}
            {!conflictWarning && (
              <div className="mt-6 flex justify-end gap-2">
                {setupMutation.isError && (
                  <button
                    onClick={handleRetry}
                    className="h-9 rounded-lg gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
                  >
                    Retry
                  </button>
                )}
                {isSetupComplete && (
                  <button
                    onClick={handleClose}
                    className="h-9 rounded-lg gradient-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
                  >
                    Done
                  </button>
                )}
                {setupMutation.isPending && (
                  <span className="inline-flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Configuring...
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
