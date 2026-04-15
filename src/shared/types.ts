import { z } from "zod";

// ─── API Response Envelope ──────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

export type SetupInput = z.infer<typeof setupSchema>;

export interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

// ─── Domains ────────────────────────────────────────────────────────────────

export const createDomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}$/, "Invalid domain format"),
});

export type CreateDomainInput = z.infer<typeof createDomainSchema>;

export const updateDomainSchema = z.object({
  status: z.enum(["pending", "active", "disabled"]).optional(),
});

export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;

export interface DomainInfo {
  id: string;
  domain: string;
  status: "pending" | "active" | "disabled";
  mxVerified: boolean;
  cfZoneId: string | null;
  cfSetupStatus: "dns_created" | "routing_enabled" | "complete" | null;
  createdAt: string;
}

// ─── Mailboxes ──────────────────────────────────────────────────────────────

export const createMailboxSchema = z.object({
  address: z.string().email(),
  domainId: z.string().min(1),
  displayName: z.string().min(1).max(100),
  canSend: z.boolean().optional().default(true),
});

export type CreateMailboxInput = z.infer<typeof createMailboxSchema>;

export const updateMailboxSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  canSend: z.boolean().optional(),
});

export type UpdateMailboxInput = z.infer<typeof updateMailboxSchema>;

export interface MailboxInfo {
  id: string;
  address: string;
  displayName: string;
  domainId: string;
  canSend: boolean;
  createdAt: string;
}

// ─── Aliases ────────────────────────────────────────────────────────────────

export const createAliasSchema = z.object({
  address: z.string().email(),
  domainId: z.string().min(1),
  allowSendAs: z.boolean().optional().default(false),
  targetMailboxIds: z.array(z.string().min(1)).min(1),
});

export type CreateAliasInput = z.infer<typeof createAliasSchema>;

export const updateAliasSchema = z.object({
  allowSendAs: z.boolean().optional(),
  targetMailboxIds: z.array(z.string().min(1)).min(1).optional(),
});

export type UpdateAliasInput = z.infer<typeof updateAliasSchema>;

export interface AliasInfo {
  id: string;
  address: string;
  domainId: string;
  allowSendAs: boolean;
  targets: MailboxInfo[];
  createdAt: string;
}

// ─── Groups ─────────────────────────────────────────────────────────────────

export const createGroupSchema = z.object({
  address: z.string().email(),
  domainId: z.string().min(1),
  displayName: z.string().min(1).max(100),
  allowSendAs: z.boolean().optional().default(false),
  memberMailboxIds: z.array(z.string().min(1)).min(1),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  allowSendAs: z.boolean().optional(),
  memberMailboxIds: z.array(z.string().min(1)).min(1).optional(),
});

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export interface GroupInfo {
  id: string;
  address: string;
  displayName: string;
  domainId: string;
  allowSendAs: boolean;
  members: MailboxInfo[];
  createdAt: string;
}

// ─── Mailbox Unread Counts ──────────────────────────────────────────────────

export interface MailboxUnreadCount {
  mailboxId: string;
  address: string;
  unreadCount: number;
}

// ─── Messages ───────────────────────────────────────────────────────────────

export interface MessageSummary {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  isRead: boolean;
  hasAttachments: boolean;
  createdAt: string;
}

export interface MessageDetail extends MessageSummary {
  textBody: string | null;
  htmlBody: string | null;
  recipients: { address: string; type: "to" | "cc" | "bcc" }[];
  attachments: AttachmentInfo[];
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

// ─── API Tokens ────────────────────────────────────────────────────────────

export const createApiTokenSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.enum(["read:messages"])).min(1),
  domainId: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

export interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  domainId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiTokenCreateResponse {
  token: string;
  data: ApiTokenInfo;
  message: string;
}

// ─── Send ───────────────────────────────────────────────────────────────────

export const sendEmailSchema = z.object({
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

// ─── Cloudflare Integration ────────────────────────────────────────────────

export interface CloudflareStatusResponse {
  connected: boolean;
  error?: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  existingDomainId: string | null;
  linked: boolean;
  /** Non-Cloudflare MX records already present (e.g. "10 mail.google.com") */
  existingMxRecords: string[];
}

export type SetupStepStatus = "success" | "skipped" | "error";

export interface CloudflareSetupResult {
  domainId: string;
  steps: {
    dns_mx: SetupStepStatus;
    dns_spf: SetupStepStatus;
    routing_enable: SetupStepStatus;
    routing_catchall: SetupStepStatus;
  };
  error?: string;
}

export const cfSetupSchema = z.object({
  domainName: z.string().min(1),
  existingDomainId: z.string().optional(),
  resumeFrom: z
    .enum(["dns_created", "routing_enabled"])
    .optional(),
  forceOverwrite: z.boolean().optional(),
});

// ─── Storage Analytics ────────────────────────────────────────────────────

export interface StorageStats {
  configured: boolean;
  error?: string;
  d1: {
    databases: Array<{
      databaseId: string;
      databaseSizeBytes: number;
    }>;
    totalSizeBytes: number;
    rowsRead: number;
    rowsWritten: number;
  } | null;
  r2: {
    buckets: Array<{
      bucketName: string;
      storageBytes: number;
      objectCount: number;
    }>;
    totalSizeBytes: number;
    totalObjects: number;
  } | null;
}
