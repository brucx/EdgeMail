import { cfFetch } from "./api";
import type { Logger } from "../../lib/logger";

/**
 * Per-step Cloudflare domain setup helpers.
 *
 * Each step is independently idempotent and returns a discriminated result
 * the router can render directly to the client. Failures are isolated: an
 * error in DKIM doesn't prevent the catch-all routing step from running.
 */

export type StepStatus = "success" | "skipped" | "error";

export interface StepResult {
  status: StepStatus;
  detail?: string;
  /** Used by `ensureMx` to surface a conflict for the "replace & continue" UI. */
  conflictingRecords?: string[];
}

const CF_APEX_MX = [
  { content: "route1.mx.cloudflare.net", priority: 36 },
  { content: "route2.mx.cloudflare.net", priority: 84 },
  { content: "route3.mx.cloudflare.net", priority: 12 },
];

// ─── MX ────────────────────────────────────────────────────────────────────

/**
 * Ensure the apex of `domainName` has Cloudflare's three MX records and no
 * conflicting non-Cloudflare MX at the apex.
 *
 * When `forceOverwrite` is false and a conflict exists, returns
 * `{ status: "error", conflictingRecords }` so the caller can prompt.
 */
export async function ensureMx(
  token: string,
  zoneId: string,
  domainName: string,
  forceOverwrite: boolean,
  log?: Logger,
): Promise<StepResult> {
  const existing = await cfFetch<
    Array<{ id: string; name: string; content: string }>
  >(token, `/zones/${zoneId}/dns_records?type=MX`);

  const apex = existing.result.filter((r) => r.name === domainName);
  const conflicting = apex.filter((r) => !r.content.includes("mx.cloudflare.net"));

  if (conflicting.length > 0 && !forceOverwrite) {
    return {
      status: "error",
      detail: "Existing non-Cloudflare MX records present at apex",
      conflictingRecords: conflicting.map((r) => r.content),
    };
  }

  if (conflicting.length > 0) {
    await Promise.all(
      conflicting.map((r) =>
        cfFetch(token, `/zones/${zoneId}/dns_records/${r.id}`, {
          method: "DELETE",
        }),
      ),
    );
    log?.info("cloudflare: deleted conflicting MX", { count: conflicting.length });
  }

  const present = new Set(
    apex
      .filter((r) => r.content.includes("mx.cloudflare.net"))
      .map((r) => r.content.replace(/\.$/, "")),
  );
  const missing = CF_APEX_MX.filter((m) => !present.has(m.content));

  if (missing.length === 0) {
    return { status: "skipped", detail: "all Cloudflare MX records already present" };
  }

  await Promise.all(
    missing.map((mx) =>
      cfFetch(token, `/zones/${zoneId}/dns_records`, {
        method: "POST",
        body: JSON.stringify({
          type: "MX",
          name: domainName,
          content: mx.content,
          priority: mx.priority,
          ttl: 3600,
        }),
      }),
    ),
  );

  return { status: "success", detail: `created ${missing.length} MX record(s)` };
}

// ─── SPF ───────────────────────────────────────────────────────────────────

export async function ensureSpf(
  token: string,
  zoneId: string,
  domainName: string,
): Promise<StepResult> {
  const existing = await cfFetch<Array<{ content: string }>>(
    token,
    `/zones/${zoneId}/dns_records?type=TXT`,
  );
  const hasSpf = existing.result.some((r) =>
    r.content.includes("_spf.mx.cloudflare.net"),
  );
  if (hasSpf) return { status: "skipped", detail: "SPF already present" };

  await cfFetch(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "TXT",
      name: domainName,
      content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
      ttl: 3600,
    }),
  });
  return { status: "success", detail: "created SPF record" };
}

// ─── DKIM ──────────────────────────────────────────────────────────────────

/**
 * DKIM is auto-published by Cloudflare Email Routing once enabled, but some
 * zones (especially pre-existing ones) need the TXT record copied manually.
 * Needs Zone Settings Read + DNS Write. Skipped gracefully if either is missing.
 */
export async function ensureDkim(
  token: string,
  zoneId: string,
): Promise<StepResult> {
  try {
    const existingTxt = await cfFetch<Array<{ name: string; content: string }>>(
      token,
      `/zones/${zoneId}/dns_records?type=TXT`,
    );
    const hasDkim = existingTxt.result.some((r) => r.content.includes("v=DKIM1"));
    if (hasDkim) return { status: "skipped", detail: "DKIM already present" };

    const routingDns = await cfFetch<
      Array<{ type: string; name: string; content: string; ttl: number }>
    >(token, `/zones/${zoneId}/email/routing/dns`);
    const required = routingDns.result ?? [];
    const dkimRecord = required.find(
      (r) => r.type === "TXT" && r.name.includes("._domainkey"),
    );

    if (!dkimRecord) {
      return { status: "skipped", detail: "no DKIM record published by CF yet" };
    }

    await cfFetch(token, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "TXT",
        name: dkimRecord.name,
        content: dkimRecord.content,
        ttl: dkimRecord.ttl || 3600,
      }),
    });
    return { status: "success", detail: "created DKIM record" };
  } catch {
    // Permission-scoped failures here are routine; the user can enable
    // DKIM manually via the dashboard with no impact on routing.
    return { status: "skipped", detail: "insufficient permission; add DKIM manually" };
  }
}

// ─── Email Routing Enable ─────────────────────────────────────────────────

export async function ensureRoutingEnabled(
  token: string,
  zoneId: string,
): Promise<StepResult> {
  try {
    const status = await cfFetch<{ enabled?: boolean }>(
      token,
      `/zones/${zoneId}/email/routing`,
    );
    if (status.result.enabled) {
      return { status: "skipped", detail: "routing already enabled" };
    }

    await cfFetch(token, `/zones/${zoneId}/email/routing/enable`, {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
    return { status: "success", detail: "enabled Email Routing" };
  } catch {
    // Scoped tokens often lack the Email Routing: Edit permission. We
    // skip quietly; the user can enable in the dashboard once per zone.
    return {
      status: "skipped",
      detail: "token lacks permission; enable in CF Dashboard → Email Routing",
    };
  }
}

// ─── Catch-all Routing Rule ───────────────────────────────────────────────

export async function ensureCatchAll(
  token: string,
  zoneId: string,
  workerName: string,
): Promise<StepResult> {
  await cfFetch(token, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: JSON.stringify({
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [workerName] }],
      enabled: true,
    }),
  });
  return { status: "success", detail: `routed catch-all to worker "${workerName}"` };
}
