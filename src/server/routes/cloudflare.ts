import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { domains, auditLogs } from "../db/schema";
import { generateId } from "../lib/id";
import { requireAuth } from "../middleware/auth";
import { cfSetupSchema } from "@shared/types";
import type { CloudflareSetupResult } from "@shared/types";
import { cfFetch, CloudflareApiError } from "../services/cloudflare/api";
import {
  ensureMx,
  ensureSpf,
  ensureDkim,
  ensureRoutingEnabled,
  ensureCatchAll,
  type StepResult,
} from "../services/cloudflare/steps";

const cloudflareRouter = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

cloudflareRouter.use("/*", requireAuth);

// ─── GET /api/cloudflare/status ───────────────────────────────────────────

cloudflareRouter.get("/status", async (c) => {
  const token = c.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return c.json({ connected: false, error: "CLOUDFLARE_API_TOKEN not configured" });
  }

  try {
    await cfFetch(token, "/zones?per_page=1");
    return c.json({ connected: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ connected: false, error: message });
  }
});

// ─── GET /api/cloudflare/zones ────────────────────────────────────────────

cloudflareRouter.get("/zones", async (c) => {
  const log = c.get("logger");
  const token = c.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return c.json({ error: "Cloudflare integration not configured" }, 503);
  }

  try {
    let path = "/zones?per_page=50&status=active";
    if (c.env.CLOUDFLARE_ACCOUNT_ID) {
      path += `&account.id=${c.env.CLOUDFLARE_ACCOUNT_ID}`;
    }

    const cfResult = await cfFetch<
      Array<{ id: string; name: string; status: string }>
    >(token, path);
    const zones = cfResult.result;

    const db = c.get("db");
    const existingDomains = await db.select().from(domains);
    const domainMap = new Map(existingDomains.map((d) => [d.domain, d]));

    const zoneDataWithMx = await Promise.all(
      zones.map(async (zone) => {
        const existing = domainMap.get(zone.name);
        const base = {
          id: zone.id,
          name: zone.name,
          status: zone.status,
          existingDomainId: existing?.id ?? null,
          linked: existing?.cfZoneId === zone.id,
          existingMxRecords: [] as string[],
        };

        if (base.linked) return base;

        try {
          const mxResult = await cfFetch<
            Array<{ name: string; content: string; priority: number }>
          >(token, `/zones/${zone.id}/dns_records?type=MX`);
          base.existingMxRecords = mxResult.result
            .filter((r) => r.name === zone.name)
            .filter((r) => !r.content.includes("mx.cloudflare.net"))
            .map((r) => `${r.priority} ${r.content}`);
        } catch {
          // non-critical
        }

        return base;
      }),
    );

    return c.json({ data: zoneDataWithMx });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("cloudflare zones lookup failed", { err });
    return c.json({ error: message }, 502);
  }
});

// ─── GET /api/cloudflare/zones/:zoneId/dns ────────────────────────────────

cloudflareRouter.get("/zones/:zoneId/dns", async (c) => {
  const token = c.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return c.json({ error: "Cloudflare integration not configured" }, 503);
  }

  const { zoneId } = c.req.param();

  try {
    const [mxResult, txtResult] = await Promise.all([
      cfFetch(token, `/zones/${zoneId}/dns_records?type=MX`),
      cfFetch(token, `/zones/${zoneId}/dns_records?type=TXT`),
    ]);

    return c.json({ data: { mx: mxResult.result, txt: txtResult.result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 502);
  }
});

// ─── POST /api/cloudflare/zones/:zoneId/setup ─────────────────────────────
// Orchestrator only: every substantive operation lives in services/cloudflare/steps.

cloudflareRouter.post(
  "/zones/:zoneId/setup",
  zValidator("json", cfSetupSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const log = c.get("logger");
    const token = c.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      return c.json({ error: "Cloudflare integration not configured" }, 503);
    }

    const db = c.get("db");
    const { zoneId } = c.req.param();
    const { domainName, existingDomainId, forceOverwrite, resumeFrom } =
      c.req.valid("json");
    const workerName = c.env.CF_WORKER_NAME || "edgemail";

    const skipDns = resumeFrom === "dns_created" || resumeFrom === "routing_enabled";
    const skipToCatchAll = resumeFrom === "routing_enabled";

    const steps: CloudflareSetupResult["steps"] = {
      dns_mx: "skipped",
      dns_spf: "skipped",
      dns_dkim: "skipped",
      routing_enable: "skipped",
      routing_catchall: "skipped",
    };

    let conflictingRecords: string[] | undefined;

    try {
      // ── MX ────────────────────────────────────────────────────────────
      if (!skipDns) {
        const mxResult = await ensureMx(
          token,
          zoneId,
          domainName,
          !!forceOverwrite,
          log,
        );
        steps.dns_mx = mxResult.status;
        if (mxResult.status === "error" && mxResult.conflictingRecords) {
          // Surface the conflict to the UI; do not 500 or continue further.
          return c.json({
            data: { domainId: "", steps },
            warning: "Existing non-Cloudflare MX records found",
            conflictingRecords: mxResult.conflictingRecords,
          });
        }

        // ── SPF ─────────────────────────────────────────────────────────
        const spfResult = await ensureSpf(token, zoneId, domainName);
        steps.dns_spf = spfResult.status;
      }

      // ── Routing Enable ─────────────────────────────────────────────────
      if (!skipToCatchAll) {
        const enableResult = await ensureRoutingEnabled(token, zoneId);
        steps.routing_enable = enableResult.status;
      }

      // ── DKIM (runs after enable so the key is published) ──────────────
      if (!skipDns) {
        const dkimResult = await ensureDkim(token, zoneId);
        steps.dns_dkim = dkimResult.status;
      }

      // ── Catch-all ─────────────────────────────────────────────────────
      const catchResult = await ensureCatchAll(token, zoneId, workerName);
      steps.routing_catchall = catchResult.status;
    } catch (err) {
      const base = err instanceof Error ? err.message : "Setup failed";
      log.error("cloudflare setup failed", { err, zoneId, domainName, steps });

      const hint = steps.routing_catchall !== "success"
        ? "\n\nHint: If Email Routing is not yet enabled for this domain, " +
          "go to Cloudflare Dashboard → Email → Email Routing → Enable, then retry."
        : "";

      if (steps.routing_catchall !== "success") {
        steps.routing_catchall = "error";
      }

      return c.json(
        {
          data: { domainId: "", steps } satisfies CloudflareSetupResult,
          error: base + hint,
          conflictingRecords,
          cfStatus: err instanceof CloudflareApiError ? err.status : undefined,
        },
        500,
      );
    }

    // ── D1 write: mark domain active + linked to zone ──────────────────
    const domainId = await upsertDomain(db, existingDomainId, domainName, zoneId);

    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "cloudflare.setup",
      resourceType: "domain",
      resourceId: domainId,
      details: JSON.stringify({ zoneId, domainName, steps }),
    });

    return c.json({
      data: { domainId, steps } satisfies CloudflareSetupResult,
      message: "Domain configured successfully",
    });
  },
);

async function upsertDomain(
  db: AppVariables["db"],
  existingDomainId: string | undefined,
  domainName: string,
  zoneId: string,
): Promise<string> {
  const now = new Date().toISOString();

  if (existingDomainId) {
    await db
      .update(domains)
      .set({
        cfZoneId: zoneId,
        status: "active",
        mxVerified: true,
        cfSetupStatus: "complete",
        updatedAt: now,
      })
      .where(eq(domains.id, existingDomainId));
    return existingDomainId;
  }

  const existing = await db
    .select()
    .from(domains)
    .where(eq(domains.domain, domainName))
    .limit(1)
    .then((rows) => rows[0]);

  if (existing) {
    await db
      .update(domains)
      .set({
        cfZoneId: zoneId,
        status: "active",
        mxVerified: true,
        cfSetupStatus: "complete",
        updatedAt: now,
      })
      .where(eq(domains.id, existing.id));
    return existing.id;
  }

  const newId = generateId();
  await db.insert(domains).values({
    id: newId,
    domain: domainName,
    status: "active",
    mxVerified: true,
    cfZoneId: zoneId,
    cfSetupStatus: "complete",
  });
  return newId;
}

export default cloudflareRouter;

// Type-only used to silence the `StepResult` import when tree-shaken.
export type { StepResult };
