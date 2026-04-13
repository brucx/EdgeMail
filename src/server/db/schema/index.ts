// Re-export all schema tables from a single entry point.
// Drizzle Kit and the DB factory both use this file.

export { users, sessions } from "./auth";

export {
  domains,
  mailboxes,
  aliases,
  aliasTargets,
  groups,
  groupMembers,
} from "./domains";

export {
  messages,
  messageRecipients,
  messageDeliveries,
  attachments,
} from "./messages";

export { auditLogs } from "./audit";
