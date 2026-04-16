import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../lib/html-sanitize";

describe("sanitizeHtml", () => {
  it("passes through null/empty", async () => {
    expect(await sanitizeHtml(null)).toBeNull();
    expect(await sanitizeHtml("")).toBe("");
  });

  it("removes <script> tags and their contents", async () => {
    const out = await sanitizeHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("removes inline event handlers", async () => {
    const out = (await sanitizeHtml(
      `<img src="x" onerror="alert(1)" onclick="do()">`,
    ))!;
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/onclick/i);
  });

  it("strips javascript: URLs", async () => {
    const out = (await sanitizeHtml(
      `<a href="javascript:alert(1)">click</a>`,
    ))!;
    expect(out).not.toContain("javascript:");
    expect(out).toContain("about:blank");
  });

  it("forces anchors to _blank + noopener", async () => {
    const out = (await sanitizeHtml(`<a href="https://ok.test">go</a>`))!;
    expect(out).toMatch(/target="_blank"/);
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });

  it("drops <iframe> and <object> entirely", async () => {
    const out = (await sanitizeHtml(
      `<div>x<iframe src="a"></iframe><object></object></div>`,
    ))!;
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/<object/i);
  });

  it("strips style attributes", async () => {
    const out = (await sanitizeHtml(
      `<div style="background:url(javascript:1)">hi</div>`,
    ))!;
    expect(out).not.toMatch(/style=/i);
  });

  it("keeps safe scheme URLs intact", async () => {
    const out = (await sanitizeHtml(
      `<a href="https://ok.test/x">x</a><a href="mailto:a@b.test">m</a>`,
    ))!;
    expect(out).toContain("https://ok.test/x");
    expect(out).toContain("mailto:a@b.test");
  });
});
