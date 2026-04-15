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

    const data = zones.map((zone) => {
      const existing = domainMap.get(zone.name);
      return {
        id: zone.id,
        name: zone.name,
        status: zone.status,
        existingDomainId: existing?.id ?? null,
        linked: existing?.cfZoneId === zone.id,
      };
    });

    return c.json({ data });
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
    const { domainName, existingDomainId, resumeFrom, forceOverwrite } =
      c.req.valid("json");

    const workerName = c.env.CF_WORKER_NAME || "edgemail";

    const steps: CloudflareSetupResult["steps"] = {
      dns_mx: "skipped",
      dns_spf: "skipped",
      routing_enable: "skipped",
      routing_catchall: "skipped",
    };

    let domainId = existingDomainId ?? "";
    let lastError: string | undefined;

    try {
      // Step 1: Create or link domain in D1
      if (existingDomainId) {
        // Link existing domain
        await db
          .update(domains)
          .set({
            cfZoneId: zoneId,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(domains.id, existingDomainId));
        domainId = existingDomainId;
      } else {
        // Check for duplicate
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
              updatedAt: new Date().toISOString(),
            })
            .where(eq(domains.id, existing.id));
        } else {
          domainId = generateId();
          await db.insert(domains).values({
            id: domainId,
            domain: domainName,
            status: "pending",
            mxVerified: false,
            cfZoneId: zoneId,
          });
        }
      }

      // Determine where to start based on resumeFrom
      const skipDns = resumeFrom === "dns_created" || resumeFrom === "routing_enabled";
      const skipRoutingEnable = resumeFrom === "routing_enabled";

      // Step 2 & 3: Create DNS records
      if (!skipDns) {
        // Check existing MX records for conflicts
        const existingDns = await cfFetch(
          token,
          `/zones/${zoneId}/dns_records?type=MX`,
        );
        const mxRecords = existingDns.result as Array<{
          id: string;
          content: string;
        }>;

        const hasConflicting = mxRecords.some(
          (r) => !r.content.includes("mx.cloudflare.net"),
        );

        if (hasConflicting && !forceOverwrite) {
          // Return warning — frontend can re-call with forceOverwrite: true
          return c.json(
            {
              data: { domainId, steps },
              warning: "Existing non-Cloudflare MX records found",
              conflictingRecords: mxRecords.map((r) => r.content),
            },
            409,
          );
        }

        // Delete conflicting MX records if forceOverwrite
        if (hasConflicting && forceOverwrite) {
          for (const record of mxRecords) {
            if (!record.content.includes("mx.cloudflare.net")) {
              await cfFetch(
                token,
                `/zones/${zoneId}/dns_records/${record.id}`,
                { method: "DELETE" },
              );
            }
          }
        }

        // Check if Cloudflare MX already exists
        const hasCfMx = mxRecords.some((r) =>
          r.content.includes("mx.cloudflare.net"),
        );

        // Create MX record
        if (!hasCfMx) {
          try {
            await cfFetch(token, `/zones/${zoneId}/dns_records`, {
              method: "POST",
              body: JSON.stringify({
                type: "MX",
                name: domainName,
                content: "route1.mx.cloudflare.net",
                priority: 69,
                ttl: 3600,
              }),
            });
            steps.dns_mx = "success";
          } catch (err) {
            steps.dns_mx = "error";
            lastError =
              err instanceof Error ? err.message : "MX record creation failed";
            throw err;
          }
        } else {
          steps.dns_mx = "skipped";
        }

        // Create SPF TXT record (check existing first)
        const existingTxt = await cfFetch(
          token,
          `/zones/${zoneId}/dns_records?type=TXT`,
        );
        const txtRecords = existingTxt.result as Array<{
          content: string;
        }>;
        const hasSpf = txtRecords.some((r) =>
          r.content.includes("_spf.mx.cloudflare.net"),
        );

        if (!hasSpf) {
          try {
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
          } catch (err) {
            steps.dns_spf = "error";
            lastError =
              err instanceof Error
                ? err.message
                : "SPF record creation failed";
            throw err;
          }
        } else {
          steps.dns_spf = "skipped";
        }

        // Update setup status
        await db
          .update(domains)
          .set({
            cfSetupStatus: "dns_created",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(domains.id, domainId));
      }

      // Step 4: Enable Email Routing
      // Try the documented endpoint; if it fails (403/404), check if already
      // enabled via GET and treat as skipped — the catch-all step will surface
      // a real error if routing is genuinely not active.
      if (!skipRoutingEnable) {
        try {
          await cfFetch(token, `/zones/${zoneId}/email/routing/dns`, {
            method: "POST",
          });
          steps.routing_enable = "success";
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          // Check if email routing is already enabled
          try {
            const settings = await cfFetch(
              token,
              `/zones/${zoneId}/email/routing`,
            );
            const result = settings.result as { enabled?: boolean } | null;
            if (result?.enabled) {
              steps.routing_enable = "skipped";
            } else {
              // Routing not enabled and we can't enable it via API
              steps.routing_enable = "error";
              lastError =
                "Could not enable Email Routing. Please enable it manually in Cloudflare Dashboard → Email → Email Routing.";
              await db
                .update(domains)
                .set({
                  cfSetupStatus: "dns_created",
                  updatedAt: new Date().toISOString(),
                })
                .where(eq(domains.id, domainId));
              throw new Error(lastError);
            }
          } catch (checkErr) {
            if (lastError) throw checkErr;
            // If even the GET fails, skip optimistically and let catch-all step determine
            console.warn(
              "[EdgeMail] Could not verify Email Routing status, proceeding:",
              msg,
            );
            steps.routing_enable = "skipped";
          }
        }

        await db
          .update(domains)
          .set({
            cfSetupStatus: "routing_enabled",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(domains.id, domainId));
      }

      // Step 5: Set catch-all rule to Worker
      try {
        await cfFetch(
          token,
          `/zones/${zoneId}/email/routing/rules/catch_all`,
          {
            method: "PUT",
            body: JSON.stringify({
              matchers: [{ type: "all" }],
              actions: [
                { type: "worker", value: [workerName] },
              ],
              enabled: true,
            }),
          },
        );
        steps.routing_catchall = "success";
      } catch (err) {
        steps.routing_catchall = "error";
        lastError =
          err instanceof Error
            ? err.message
            : "Catch-all rule configuration failed";
        throw err;
      }

      // All steps succeeded — mark domain as active and verified
      await db
        .update(domains)
        .set({
          status: "active",
          mxVerified: true,
          cfSetupStatus: "complete",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(domains.id, domainId));

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
    } catch (err) {
      // Partial failure — log and return what we have
      const message =
        lastError ||
        (err instanceof Error ? err.message : "Setup failed");
      console.error("[EdgeMail] Cloudflare setup error:", message, err);
      return c.json(
        {
          data: { domainId, steps } satisfies CloudflareSetupResult,
          error: message,
        },
        500,
      );
    }
  },
);

export default cloudflareRouter;
