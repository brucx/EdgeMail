import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { domains, auditLogs } from "../db/schema";
import { generateId } from "../lib/id";
import { requireAuth } from "../middleware/auth";
import { cfSetupSchema } from "@shared/types";
import type { CloudflareSetupResult, SetupStepStatus } from "@shared/types";

const cloudflareRouter = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

cloudflareRouter.use("/*", requireAuth);

// ─── Cloudflare API Helper ────────────────────────────────────────────────

interface CfApiResponse {
  success: boolean;
  result: unknown;
  errors?: Array<{ code: number; message: string }>;
}

async function cfFetch(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<CfApiResponse> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = (await res.json()) as CfApiResponse;
  if (!body.success) {
    console.error(
      `[EdgeMail] CF API ${options.method || "GET"} ${path} → ${res.status}`,
      JSON.stringify(body.errors),
    );
    const msg = body.errors?.map((e) => `${e.code}: ${e.message}`).join("; ")
      || `Cloudflare API error (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return body;
}

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
  const token = c.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return c.json({ error: "Cloudflare integration not configured" }, 503);
  }

  try {
    let path = "/zones?per_page=50&status=active";
    if (c.env.CLOUDFLARE_ACCOUNT_ID) {
      path += `&account.id=${c.env.CLOUDFLARE_ACCOUNT_ID}`;
    }

    const cfResult = await cfFetch(token, path);
    const zones = cfResult.result as Array<{
      id: string;
      name: string;
      status: string;
    }>;

    // Cross-reference with existing EdgeMail domains
    const db = c.get("db");
    const existingDomains = await db.select().from(domains);
    const domainMap = new Map(
      existingDomains.map((d) => [d.domain, d]),
    );

    // Query MX records for each zone in parallel to detect existing MX configs
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

        // Skip MX check for already-linked domains
        if (base.linked) return base;

        try {
          const mxResult = await cfFetch(
            token,
            `/zones/${zone.id}/dns_records?type=MX`,
          );
          const mxRecords = mxResult.result as Array<{
            name: string;
            content: string;
            priority: number;
          }>;
          // Flag non-Cloudflare MX records AT THE APEX ONLY. Subdomain MX
          // (e.g. `send.<zone>` for Resend/SES bounce feedback) is not
          // touched by EdgeMail setup and must not be reported as a conflict.
          base.existingMxRecords = mxRecords
            .filter((r) => r.name === zone.name)
            .filter((r) => !r.content.includes("mx.cloudflare.net"))
            .map((r) => `${r.priority} ${r.content}`);
        } catch {
          // Non-critical — just skip MX check
        }

        return base;
      }),
    );

    return c.json({ data: zoneDataWithMx });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[EdgeMail] Cloudflare zones error:", message);
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

    return c.json({
      data: {
        mx: mxResult.result,
        txt: txtResult.result,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 502);
  }
});

// ─── POST /api/cloudflare/zones/:zoneId/setup ─────────────────────────────

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
    const token = c.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      return c.json({ error: "Cloudflare integration not configured" }, 503);
    }

    const db = c.get("db");
    const { zoneId } = c.req.param();
    const { domainName, existingDomainId, forceOverwrite, resumeFrom } =
      c.req.valid("json");

    const workerName = c.env.CF_WORKER_NAME || "edgemail";

    const steps: CloudflareSetupResult["steps"] = {
      dns_mx: "skipped",
      dns_spf: "skipped",
      dns_dkim: "skipped",
      routing_enable: "skipped",
      routing_catchall: "skipped",
    };

    const skipDns = resumeFrom === "dns_created" || resumeFrom === "routing_enabled";
    const skipToCatchAll = resumeFrom === "routing_enabled";

    // ── Phase 1: All Cloudflare API operations (no D1 writes) ───────

    try {
      // ── Step 1: DNS — check/create MX and SPF records ──────────

      if (!skipDns) {
        const existingDns = await cfFetch(
          token,
          `/zones/${zoneId}/dns_records?type=MX`,
        );
        const allMxRecords = existingDns.result as Array<{
          id: string;
          name: string;
          content: string;
        }>;

        // Scope to apex MX only — subdomain MX (e.g. `send.<zone>` used by
        // Resend/SES for bounce feedback) is unrelated to EdgeMail routing
        // and must not be detected as a conflict or deleted.
        const mxRecords = allMxRecords.filter((r) => r.name === domainName);

        const hasConflicting = mxRecords.some(
          (r) => !r.content.includes("mx.cloudflare.net"),
        );

        // Return conflict info as 200 so the client can show the
        // "Replace & Continue" UI (409 was unreachable from onSuccess)
        if (hasConflicting && !forceOverwrite) {
          return c.json({
            data: { domainId: "", steps },
            warning: "Existing non-Cloudflare MX records found",
            conflictingRecords: mxRecords
              .filter((r) => !r.content.includes("mx.cloudflare.net"))
              .map((r) => r.content),
          });
        }

        // Delete conflicting MX records if forceOverwrite
        if (hasConflicting && forceOverwrite) {
          await Promise.all(
            mxRecords
              .filter((r) => !r.content.includes("mx.cloudflare.net"))
              .map((r) =>
                cfFetch(token, `/zones/${zoneId}/dns_records/${r.id}`, {
                  method: "DELETE",
                }),
              ),
          );
        }

        // Create missing Cloudflare MX records (Email Routing needs all 3)
        const CF_MX = [
          { content: "route1.mx.cloudflare.net", priority: 36 },
          { content: "route2.mx.cloudflare.net", priority: 84 },
          { content: "route3.mx.cloudflare.net", priority: 12 },
        ];
        const existingCfMx = new Set(
          mxRecords
            .filter((r) => r.content.includes("mx.cloudflare.net"))
            .map((r) => r.content.replace(/\.$/, "")),
        );
        const missingMx = CF_MX.filter((m) => !existingCfMx.has(m.content));

        if (missingMx.length > 0) {
          await Promise.all(
            missingMx.map((mx) =>
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
          steps.dns_mx = "success";
        }

        // Create SPF TXT record if not present
        const existingTxt = await cfFetch(
          token,
          `/zones/${zoneId}/dns_records?type=TXT`,
        );
        const txtRecords = existingTxt.result as Array<{
          id: string;
          content: string;
        }>;
        const hasSpf = txtRecords.some((r) =>
          r.content.includes("_spf.mx.cloudflare.net"),
        );
        if (!hasSpf) {
          await cfFetch(token, `/zones/${zoneId}/dns_records`, {
            method: "POST",
            body: JSON.stringify({
              type: "TXT",
              name: domainName,
              content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
              ttl: 3600,
            }),
          });
          steps.dns_spf = "success";
        }

      }

      // ── Step 2: Try to enable Email Routing via API ────────────

      if (!skipToCatchAll) {
        try {
          const routingStatus = await cfFetch(
            token,
            `/zones/${zoneId}/email/routing`,
          );
          const settings = routingStatus.result as { enabled?: boolean };

          if (settings.enabled) {
            steps.routing_enable = "success";
          } else {
            await cfFetch(
              token,
              `/zones/${zoneId}/email/routing/enable`,
              { method: "POST", body: JSON.stringify({ enabled: true }) },
            );
            steps.routing_enable = "success";
          }
        } catch {
          // Scoped tokens may lack permission — user must enable in
          // Cloudflare Dashboard once per zone. Non-fatal: catch-all
          // may still succeed if routing was enabled previously.
          steps.routing_enable = "skipped";
        }
      }

      // ── Step 3: DKIM record ────────────────────────────────────
      // Runs AFTER Enable so the DKIM key is available for fresh zones.
      // Enable auto-creates DKIM in DNS; we check and create only if missing.

      if (!skipDns) {
        try {
          // Check if DKIM already exists in DNS
          const allTxt = await cfFetch(
            token,
            `/zones/${zoneId}/dns_records?type=TXT`,
          );
          const allTxtRecords = allTxt.result as Array<{
            name: string;
            content: string;
          }>;
          const hasDkim = allTxtRecords.some((r) =>
            r.content.includes("v=DKIM1"),
          );

          if (hasDkim) {
            steps.dns_dkim = "success";
          } else {
            // Get the required DKIM value from Email Routing DNS API
            // (needs Zone Settings Read permission)
            const routingDns = await cfFetch(
              token,
              `/zones/${zoneId}/email/routing/dns`,
            );
            const requiredRecords = (
              routingDns.result as Array<{
                type: string;
                name: string;
                content: string;
                ttl: number;
              }>
            ) ?? [];

            const dkimRecord = requiredRecords.find(
              (r) => r.type === "TXT" && r.name.includes("._domainkey"),
            );

            if (dkimRecord) {
              await cfFetch(token, `/zones/${zoneId}/dns_records`, {
                method: "POST",
                body: JSON.stringify({
                  type: "TXT",
                  name: dkimRecord.name,
                  content: dkimRecord.content,
                  ttl: dkimRecord.ttl || 3600,
                }),
              });
              steps.dns_dkim = "success";
            }
          }
        } catch {
          // Zone Settings Read permission missing — skip gracefully
          steps.dns_dkim = "skipped";
        }
      }

      // ── Step 4: Set catch-all rule to Worker ───────────────────

      await cfFetch(
        token,
        `/zones/${zoneId}/email/routing/rules/catch_all`,
        {
          method: "PUT",
          body: JSON.stringify({
            matchers: [{ type: "all" }],
            actions: [{ type: "worker", value: [workerName] }],
            enabled: true,
          }),
        },
      );
      steps.routing_catchall = "success";

    } catch (err) {
      // CF API failed — no D1 writes happened, return clean error
      let message = err instanceof Error ? err.message : "Setup failed";
      console.error("[EdgeMail] Cloudflare setup error:", message, err);

      if (steps.routing_catchall !== "success") {
        steps.routing_catchall = "error";
        message +=
          "\n\nHint: If Email Routing is not yet enabled for this domain, " +
          "go to Cloudflare Dashboard → Email → Email Routing → Enable, then retry.";
      }

      return c.json(
        { data: { domainId: "", steps } satisfies CloudflareSetupResult, error: message },
        500,
      );
    }

    // ── Phase 2: All CF API succeeded — now write to D1 ─────────────

    let domainId: string;

    if (existingDomainId) {
      domainId = existingDomainId;
      await db
        .update(domains)
        .set({
          cfZoneId: zoneId,
          status: "active",
          mxVerified: true,
          cfSetupStatus: "complete",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(domains.id, existingDomainId));
    } else {
      const existing = await db
        .select()
        .from(domains)
        .where(eq(domains.domain, domainName))
        .limit(1)
        .then((rows) => rows[0]);

      if (existing) {
        domainId = existing.id;
        await db
          .update(domains)
          .set({
            cfZoneId: zoneId,
            status: "active",
            mxVerified: true,
            cfSetupStatus: "complete",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(domains.id, existing.id));
      } else {
        domainId = generateId();
        await db.insert(domains).values({
          id: domainId,
          domain: domainName,
          status: "active",
          mxVerified: true,
          cfZoneId: zoneId,
          cfSetupStatus: "complete",
        });
      }
    }

    // Audit log
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

export default cloudflareRouter;
