import type { Env } from "../../env";
import { cfFetch, CloudflareApiError } from "../cloudflare/api";

/**
 * Cloudflare error codes we special-case. 10001 is "Unable to authenticate
 * request" — CF returns it (often with HTTP 404) when the bearer token is
 * valid but lacks the scope needed for a given endpoint, so the endpoint is
 * hidden from enumeration. Treat it as a scope problem, not a paid-plan or
 * missing-endpoint problem.
 */
const CF_ERROR_UNABLE_TO_AUTH = 10001;

/**
 * Best-effort diagnostic summary of outbound-sending readiness. Consumed by
 * `GET /api/send/capabilities` and rendered as a status card in the Sending
 * settings page. None of these signals should be treated as load-bearing —
 * they drive UX hints, not authorisation decisions. The real source of
 * truth is the `/api/send` response at send time.
 */
export interface SendCapabilities {
  cloudflare: {
    /** `send_email` binding was bound on this Worker. */
    bindingConfigured: boolean;
    /**
     * "ready"    — account probe succeeded, sending looks like it will work
     * "gated"    — probe returned an error that implies paid-plan or setup
     * "unknown"  — no CF API token configured, or probe not attempted
     */
    accountStatus: "ready" | "gated" | "unknown";
    /** Human-readable detail for the UI to surface. */
    message: string;
    /** If `accountStatus === "ready"`, the list of sender domains added to
     *  Cloudflare Email Service (empty array = none added yet). NULL when we
     *  couldn't determine this. */
    configuredDomains: string[] | null;
    /** Per-domain onboarding heuristic: does `cf-bounce._domainkey.<domain>`
     *  TXT record resolve? Populated when bindingConfigured is true and we
     *  were given a domain list. NULL = not probed. */
    domainStatus: Array<{ domain: string; onboarded: boolean }> | null;
  };
  resend: {
    /** Global RESEND_API_KEY secret is set to a plausible value. */
    globalConfigured: boolean;
    /** Number of domains that have a per-domain Resend API key override. */
    perDomainKeys: number;
  };
  /** Best guess of which provider will be used when a domain leaves
   *  `senderProvider` at auto. Mirrors resolveMailer() for UI display. */
  defaultProvider: "cloudflare" | "resend" | "none";
}

interface TokenVerifyResult {
  id: string;
  status: string; // "active" | "disabled" | "expired"
}

/**
 * Per-domain onboarding heuristic using Cloudflare's public DNS-over-HTTPS.
 *
 * When a domain is onboarded to Email Service, Cloudflare adds a DKIM record
 * at `cf-bounce._domainkey.<domain>`. If that TXT record resolves, the
 * domain is almost certainly onboarded. If it doesn't, outbound mail from
 * that domain will be signed with the shared `cloudflare-email.com` DKIM
 * key — which will always fail DMARC alignment against the sender's From
 * header, causing warnings / rejection at recipients (we observed this
 * firsthand on QQ Mail).
 *
 * Using DoH keeps this independent of CF API token scopes.
 */
async function isDomainOnboarded(domain: string): Promise<boolean> {
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=cf-bounce._domainkey.${encodeURIComponent(domain)}&type=TXT`;
    const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      Status: number;
      Answer?: Array<{ data: string }>;
    };
    if (body.Status !== 0) return false;
    return !!body.Answer?.some((a) => /v=DKIM1/i.test(a.data));
  } catch {
    return false;
  }
}

/**
 * Probe Cloudflare for outbound-send readiness.
 *
 * Cloudflare does not expose a public REST endpoint for "is Email Service
 * enabled on this account". We previously tried GET `/email/sending/domains`,
 * but that path is undocumented and returns HTTP 404 with error code 10001
 * ("Unable to authenticate request") when the token lacks the Email Services
 * scope — indistinguishable from an endpoint that genuinely does not exist.
 *
 * So we settle for a weaker but honest signal: validate the API token.
 * Cloudflare has two flavours — user tokens (`cfut_…`) and account-owned
 * tokens (`cfat_…`) — and they use *different* verify endpoints:
 *   - user tokens  → GET /user/tokens/verify
 *   - account tokens → GET /accounts/{id}/tokens/verify
 * Calling the wrong one returns a confusing 401 "Invalid API Token" (error
 * code 1000) even when the token is perfectly valid. We pick the right path
 * by prefix, with a fallback to the other if the first path is rejected.
 *
 * The UI must not rely on `accountStatus === "ready"` to mean sending works;
 * it only means "no obvious blocker detected" — the user still needs to
 * onboard the domain and be on Workers Paid for external recipients.
 */
async function verifyToken(
  token: string,
  accountId: string,
): Promise<TokenVerifyResult | null> {
  const isAccountToken = token.startsWith("cfat_");
  const primary = isAccountToken
    ? `/accounts/${accountId}/tokens/verify`
    : "/user/tokens/verify";
  const fallback = isAccountToken
    ? "/user/tokens/verify"
    : `/accounts/${accountId}/tokens/verify`;

  try {
    const res = await cfFetch<TokenVerifyResult>(token, primary);
    return res.result ?? null;
  } catch (primaryErr) {
    // Retry with the other path — covers legacy tokens without the prefix
    // and misclassified tokens. If both paths reject us, rethrow the primary
    // error so the caller can classify it.
    try {
      const res = await cfFetch<TokenVerifyResult>(token, fallback);
      return res.result ?? null;
    } catch {
      throw primaryErr;
    }
  }
}

async function probeCloudflareAccount(
  env: Env,
): Promise<Pick<SendCapabilities["cloudflare"], "accountStatus" | "message" | "configuredDomains">> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    return {
      accountStatus: "unknown",
      message:
        "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to let EdgeMail validate your Cloudflare integration. Sending can still work without it — the binding is independent of the REST API token.",
      configuredDomains: null,
    };
  }

  try {
    const result = await verifyToken(
      env.CLOUDFLARE_API_TOKEN,
      env.CLOUDFLARE_ACCOUNT_ID,
    );
    if (result?.status !== "active") {
      return {
        accountStatus: "unknown",
        message: `Cloudflare API token is ${result?.status ?? "inactive"}. Issue a fresh token in Cloudflare → API Tokens.`,
        configuredDomains: null,
      };
    }
    return {
      accountStatus: "ready",
      message:
        "Cloudflare integration is active. Onboard your sender domain at Cloudflare → Email Service → Email Sending → Domains, then send a test email from the Compose window to confirm end-to-end delivery.",
      configuredDomains: null,
    };
  } catch (err) {
    if (err instanceof CloudflareApiError) {
      const combined = err.errors.map((e) => e.message.toLowerCase()).join(" ");
      const hasAuthHidden = err.errors.some((e) => e.code === CF_ERROR_UNABLE_TO_AUTH);

      const looksGated =
        err.status === 402 ||
        combined.includes("paid") ||
        combined.includes("upgrade") ||
        combined.includes("subscription") ||
        combined.includes("not available on") ||
        combined.includes("not entitled");
      if (looksGated) {
        return {
          accountStatus: "gated",
          message:
            "Cloudflare Email Service is not available on this account. You are likely on Workers Free — upgrade to Workers Paid, or set a Resend API key and use the Resend provider for each domain.",
          configuredDomains: null,
        };
      }

      if (hasAuthHidden || err.status === 401 || err.status === 403) {
        return {
          accountStatus: "unknown",
          message:
            "The configured Cloudflare API token is rejected or missing permissions. Create a token with at least `User → User Details → Read` (and `Email Services` scopes if you plan to manage Email Service via API), and update CLOUDFLARE_API_TOKEN.",
          configuredDomains: null,
        };
      }

      return {
        accountStatus: "unknown",
        message: `Cloudflare API returned an error while verifying the token: ${err.message}`,
        configuredDomains: null,
      };
    }
    return {
      accountStatus: "unknown",
      message:
        "Could not reach the Cloudflare API to verify the token. Check CLOUDFLARE_API_TOKEN and network egress.",
      configuredDomains: null,
    };
  }
}

export async function getSendCapabilities(
  env: Env,
  perDomainKeys: number,
  /** List of domain names in the DB, used for per-domain onboarding probe. */
  domainNames: string[] = [],
): Promise<SendCapabilities> {
  const bindingConfigured = Boolean(env.EMAIL);
  const [probe, domainStatus] = await Promise.all([
    bindingConfigured
      ? probeCloudflareAccount(env)
      : Promise.resolve({
          accountStatus: "unknown" as const,
          message:
            "The `send_email` binding is not configured on this Worker. Uncomment it in wrangler.jsonc to enable the Cloudflare provider.",
          configuredDomains: null,
        }),
    bindingConfigured && domainNames.length > 0
      ? Promise.all(
          domainNames.map(async (d) => ({
            domain: d,
            onboarded: await isDomainOnboarded(d),
          })),
        )
      : Promise.resolve(null),
  ]);

  const globalConfigured = Boolean(
    env.RESEND_API_KEY && !env.RESEND_API_KEY.includes("YOUR_"),
  );

  let defaultProvider: SendCapabilities["defaultProvider"];
  if (bindingConfigured) {
    // resolveMailer() will always pick cloudflare if the binding exists, even if the
    // account is Free / gated / unreachable. Sends will fail until the user upgrades
    // or configures Resend. UX-wise, the UI should flag this mismatch.
    defaultProvider = "cloudflare";
  } else if (globalConfigured) {
    defaultProvider = "resend";
  } else {
    defaultProvider = "none";
  }

  return {
    cloudflare: {
      bindingConfigured,
      ...probe,
      domainStatus,
    },
    resend: {
      globalConfigured,
      perDomainKeys,
    },
    defaultProvider,
  };
}
