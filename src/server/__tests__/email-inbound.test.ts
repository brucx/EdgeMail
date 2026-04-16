import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { ensureTablesExist } from "../db/migrate";
import {
  domains,
  mailboxes,
  messages,
  messageDeliveries,
  messageRecipients,
  aliases,
  aliasTargets,
  groups,
  groupMembers,
  attachments,
} from "../db/schema";
import { handleInboundEmail } from "../services/email-inbound";
import { generateId } from "../lib/id";

/**
 * Minimal fake for Cloudflare's ForwardableEmailMessage — just enough surface
 * area for our handler. PostalMime parses the `raw` stream, and the handler
 * never calls reply()/forward()/setReject() in the inbound pipeline.
 */
function fakeMessage(opts: {
  from: string;
  to: string;
  raw: string;
}): ForwardableEmailMessage {
  return {
    from: opts.from,
    to: opts.to,
    headers: new Headers(),
    raw: new Response(opts.raw).body!,
    rawSize: opts.raw.length,
    setReject: () => {},
    forward: async () => {},
    reply: async () => {},
  } as unknown as ForwardableEmailMessage;
}

function buildRawEmail(opts: {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}): string {
  const html = opts.htmlBody
    ? `\r\nContent-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain\r\n\r\n${opts.textBody}\r\n--b1\r\nContent-Type: text/html\r\n\r\n${opts.htmlBody}\r\n--b1--\r\n`
    : `\r\n\r\n${opts.textBody}\r\n`;
  return (
    `From: ${opts.from}\r\n` +
    `To: ${opts.to}\r\n` +
    `Subject: ${opts.subject}\r\n` +
    `Message-ID: <${generateId()}@test>\r\n` +
    `Date: ${new Date().toUTCString()}\r\n` +
    (opts.htmlBody ? "MIME-Version: 1.0" : "Content-Type: text/plain") +
    html
  );
}

describe("handleInboundEmail", () => {
  beforeEach(async () => {
    await ensureTablesExist(env.DB);
    const db = createDb(env.DB);
    // Scrub: tests share the same workerd D1 instance across `it` blocks
    // within a file. Delete in FK-safe order.
    await db.delete(aliasTargets);
    await db.delete(groupMembers);
    await db.delete(messageDeliveries);
    await db.delete(messageRecipients);
    await db.delete(attachments);
    await db.delete(messages);
    await db.delete(aliases);
    await db.delete(groups);
    await db.delete(mailboxes);
    await db.delete(domains);
  });

  it("delivers to a direct mailbox", async () => {
    const db = createDb(env.DB);
    const domainId = generateId();
    const mailboxId = generateId();
    await db.insert(domains).values({ id: domainId, domain: "ok.test" });
    await db.insert(mailboxes).values({
      id: mailboxId,
      address: "user@ok.test",
      domainId,
      displayName: "U",
      canSend: true,
    });

    const raw = buildRawEmail({
      from: "sender@ext.test",
      to: "user@ok.test",
      subject: "hi",
      textBody: "body",
    });
    await handleInboundEmail(
      fakeMessage({ from: "sender@ext.test", to: "user@ok.test", raw }),
      env,
    );

    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(1);
    const deliv = await db.select().from(messageDeliveries);
    expect(deliv).toHaveLength(1);
    expect(deliv[0].mailboxId).toBe(mailboxId);
  });

  it("sanitizes HTML body before storage", async () => {
    const db = createDb(env.DB);
    const domainId = generateId();
    await db.insert(domains).values({ id: domainId, domain: "ok.test" });
    await db.insert(mailboxes).values({
      id: generateId(),
      address: "user@ok.test",
      domainId,
      displayName: "U",
      canSend: true,
    });

    const raw = buildRawEmail({
      from: "s@ext.test",
      to: "user@ok.test",
      subject: "xss",
      textBody: "plain",
      htmlBody: `<p>ok</p><script>alert(1)</script>`,
    });
    await handleInboundEmail(
      fakeMessage({ from: "s@ext.test", to: "user@ok.test", raw }),
      env,
    );

    const stored = await db.select().from(messages).limit(1);
    expect(stored[0].htmlBody).not.toMatch(/<script/i);
    expect(stored[0].htmlBody).not.toContain("alert(1)");
  });

  it("fans out to alias targets", async () => {
    const db = createDb(env.DB);
    const domainId = generateId();
    await db.insert(domains).values({ id: domainId, domain: "ok.test" });

    const m1 = generateId();
    const m2 = generateId();
    await db.insert(mailboxes).values([
      { id: m1, address: "a@ok.test", domainId, displayName: "A", canSend: true },
      { id: m2, address: "b@ok.test", domainId, displayName: "B", canSend: true },
    ]);

    const aliasId = generateId();
    await db.insert(aliases).values({ id: aliasId, address: "team@ok.test", domainId });
    await db.insert(aliasTargets).values([
      { id: generateId(), aliasId, targetMailboxId: m1 },
      { id: generateId(), aliasId, targetMailboxId: m2 },
    ]);

    const raw = buildRawEmail({
      from: "s@ext.test",
      to: "team@ok.test",
      subject: "fanout",
      textBody: "hey",
    });
    await handleInboundEmail(
      fakeMessage({ from: "s@ext.test", to: "team@ok.test", raw }),
      env,
    );

    const deliv = await db.select().from(messageDeliveries);
    expect(deliv.map((d) => d.mailboxId).sort()).toEqual([m1, m2].sort());
  });

  it("stores the raw .eml in R2 even when no mailbox matches", async () => {
    const db = createDb(env.DB);
    const raw = buildRawEmail({
      from: "s@ext.test",
      to: "nobody@unknown.test",
      subject: "orphan",
      textBody: "x",
    });
    await handleInboundEmail(
      fakeMessage({ from: "s@ext.test", to: "nobody@unknown.test", raw }),
      env,
    );

    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(1);
    const obj = await env.STORAGE.get(msgs[0].rawKey!);
    expect(obj).not.toBeNull();
    const deliv = await db.select().from(messageDeliveries);
    expect(deliv).toHaveLength(0);
  });
});
