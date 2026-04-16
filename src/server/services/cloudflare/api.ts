/**
 * Shared Cloudflare API helpers used by the per-step setup services.
 * Deliberately kept tiny: a single `cfFetch` with JSON error normalization.
 */

export interface CfApiResponse<T = unknown> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

export class CloudflareApiError extends Error {
  readonly status: number;
  readonly errors: Array<{ code: number; message: string }>;

  constructor(
    status: number,
    errors: Array<{ code: number; message: string }>,
    message?: string,
  ) {
    super(
      message ??
        errors.map((e) => `${e.code}: ${e.message}`).join("; ") ??
        `Cloudflare API error (HTTP ${status})`,
    );
    this.name = "CloudflareApiError";
    this.status = status;
    this.errors = errors;
  }
}

export async function cfFetch<T = unknown>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<CfApiResponse<T>> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = (await res.json()) as CfApiResponse<T>;
  if (!body.success) {
    throw new CloudflareApiError(res.status, body.errors ?? []);
  }
  return body;
}
