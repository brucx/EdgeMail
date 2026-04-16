import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { requireAuth } from "../middleware/auth";
import type { StorageStats } from "@shared/types";

const storageRouter = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

storageRouter.use("/*", requireAuth);

// ─── GraphQL Analytics Helper ─────────────────────────────────────────────

interface GraphQLResponse {
  data?: unknown;
  errors?: Array<{ message: string }>;
}

async function cfGraphQL(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLResponse> {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<GraphQLResponse>;
}

// ─── GET /api/storage/stats ───────────────────────────────────────────────

storageRouter.get("/stats", async (c) => {
  const token = c.env.CLOUDFLARE_API_TOKEN;
  const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return c.json({
      configured: false,
      error: !token
        ? "CLOUDFLARE_API_TOKEN not configured"
        : "CLOUDFLARE_ACCOUNT_ID not configured",
      d1: null,
      r2: null,
    } satisfies StorageStats);
  }

  const d1DatabaseId = c.env.D1_DATABASE_ID;
  const r2BucketName = c.env.R2_BUCKET_NAME;

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // D1 uses Date type (YYYY-MM-DD), R2 uses Time type (ISO 8601)
  const dateStart = yesterday.toISOString().split("T")[0];
  const dateEnd = now.toISOString().split("T")[0];
  const timeStart = yesterday.toISOString();
  const timeEnd = now.toISOString();

  // Query D1 and R2 in parallel, scoped to this project's resources
  const [d1Result, r2Result] = await Promise.all([
    cfGraphQL(token, D1_QUERY, {
      accountTag: accountId,
      dateStart,
      dateEnd,
      ...(d1DatabaseId && { databaseId: d1DatabaseId }),
    }).catch(
      (err) => ({ errors: [{ message: String(err) }] }) as GraphQLResponse,
    ),
    cfGraphQL(token, R2_QUERY, {
      accountTag: accountId,
      dateStart: timeStart,
      dateEnd: timeEnd,
      ...(r2BucketName && { bucketName: r2BucketName }),
    }).catch(
      (err) => ({ errors: [{ message: String(err) }] }) as GraphQLResponse,
    ),
  ]);

  // Parse D1
  let d1: StorageStats["d1"] = null;
  if (d1Result.data && !d1Result.errors?.length) {
    try {
      const accounts = (d1Result.data as any).viewer?.accounts;
      const account = Array.isArray(accounts) ? accounts[0] : accounts;
      const storageGroups = account?.d1StorageAdaptiveGroups ?? [];
      const analyticsGroups = account?.d1AnalyticsAdaptiveGroups ?? [];

      const dbMap = new Map<string, { databaseSizeBytes: number }>();
      for (const g of storageGroups) {
        const dbId = g.dimensions?.databaseId ?? "unknown";
        const size = g.max?.databaseSizeBytes ?? 0;
        const existing = dbMap.get(dbId);
        if (!existing || size > existing.databaseSizeBytes) {
          dbMap.set(dbId, { databaseSizeBytes: size });
        }
      }

      let totalRowsRead = 0;
      let totalRowsWritten = 0;
      for (const g of analyticsGroups) {
        totalRowsRead += g.sum?.readQueries ?? 0;
        totalRowsWritten += g.sum?.writeQueries ?? 0;
      }

      const databases = Array.from(dbMap.entries()).map(([databaseId, v]) => ({
        databaseId,
        databaseSizeBytes: v.databaseSizeBytes,
      }));

      d1 = {
        databases,
        totalSizeBytes: databases.reduce((acc, db) => acc + db.databaseSizeBytes, 0),
        rowsRead: totalRowsRead,
        rowsWritten: totalRowsWritten,
      };
    } catch {
      // Parse error — leave as null
    }
  }

  // Parse R2
  let r2: StorageStats["r2"] = null;
  if (r2Result.data && !r2Result.errors?.length) {
    try {
      const accounts = (r2Result.data as any).viewer?.accounts;
      const account = Array.isArray(accounts) ? accounts[0] : accounts;
      const storageGroups = account?.r2StorageAdaptiveGroups ?? [];

      const bucketMap = new Map<
        string,
        { storageBytes: number; objectCount: number }
      >();
      for (const g of storageGroups) {
        const name = g.dimensions?.bucketName ?? "unknown";
        const bytes = g.max?.payloadSize ?? 0;
        const objects = g.max?.objectCount ?? 0;
        const existing = bucketMap.get(name);
        if (!existing || bytes > existing.storageBytes) {
          bucketMap.set(name, { storageBytes: bytes, objectCount: objects });
        }
      }

      const buckets = Array.from(bucketMap.entries()).map(
        ([bucketName, v]) => ({
          bucketName,
          storageBytes: v.storageBytes,
          objectCount: v.objectCount,
        }),
      );

      r2 = {
        buckets,
        totalSizeBytes: buckets.reduce((acc, b) => acc + b.storageBytes, 0),
        totalObjects: buckets.reduce((acc, b) => acc + b.objectCount, 0),
      };
    } catch {
      // Parse error — leave as null
    }
  }

  // Collect and classify errors
  const errors: string[] = [];
  let permissionError = false;

  for (const [label, result] of [["D1", d1Result], ["R2", r2Result]] as const) {
    if (result.errors?.length) {
      const msgs = result.errors.map((e) => e.message).join("; ");
      // "unknown field" means the token cannot see the dataset — permission issue
      if (msgs.includes("unknown field")) {
        permissionError = true;
      }
      errors.push(`${label}: ${msgs}`);
    }
  }

  if (permissionError) {
    errors.push(
      "Your API token is missing the \"Account Analytics: Read\" permission. " +
      "Edit the token in Cloudflare Dashboard → My Profile → API Tokens and add: Account / Account Analytics / Read.",
    );
  }

  return c.json({
    configured: true,
    error: errors.length ? errors.join(" | ") : undefined,
    d1,
    r2,
  } satisfies StorageStats);
});

export default storageRouter;

// ─── GraphQL Queries ──────────────────────────────────────────────────────

const D1_QUERY = `
query D1Storage($accountTag: string!, $dateStart: Date!, $dateEnd: Date!, $databaseId: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1StorageAdaptiveGroups(
        filter: { date_geq: $dateStart, date_leq: $dateEnd, databaseId: $databaseId }
        limit: 100
      ) {
        dimensions {
          databaseId
        }
        max {
          databaseSizeBytes
        }
      }
      d1AnalyticsAdaptiveGroups(
        filter: { date_geq: $dateStart, date_leq: $dateEnd, databaseId: $databaseId }
        limit: 100
      ) {
        dimensions {
          databaseId
        }
        sum {
          readQueries
          writeQueries
        }
      }
    }
  }
}
`;

const R2_QUERY = `
query R2Storage($accountTag: string!, $dateStart: Time!, $dateEnd: Time!, $bucketName: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2StorageAdaptiveGroups(
        filter: { datetime_geq: $dateStart, datetime_leq: $dateEnd, bucketName: $bucketName }
        limit: 100
        orderBy: [datetime_DESC]
      ) {
        dimensions {
          bucketName
          datetime
        }
        max {
          payloadSize
          objectCount
        }
      }
    }
  }
}
`;
