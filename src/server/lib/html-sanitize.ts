/**
 * Minimal HTML sanitizer for email bodies, implemented with Cloudflare's
 * HTMLRewriter. Strips dangerous tags and every event handler, and rewrites
 * unsafe URLs on `href` / `src` to "about:blank".
 *
 * This is intentionally narrow: it protects the inbox UI from XSS when the
 * user opens a message. It is NOT a full HTML output policy — do not reuse
 * it for user-submitted rich text elsewhere without reviewing the ruleset.
 *
 * Workers-only: relies on the global `HTMLRewriter` class shipped by the
 * workerd runtime. For unit tests that run outside workerd, use the pool
 * `@cloudflare/vitest-pool-workers` so HTMLRewriter is available.
 */

// Tags whose entire subtree must be dropped (content inside is also gone).
const FORBIDDEN_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "link",
  "base",
  "noscript",
  "svg",
  "math",
];

// URL schemes that are safe to keep on href/src/action attributes.
const SAFE_URL_RE = /^(https?:|mailto:|tel:|cid:|#|\/)/i;

/**
 * Returns sanitized HTML. Empty/nullish input passes through unchanged.
 */
export async function sanitizeHtml(html: string | null | undefined): Promise<string | null> {
  if (!html) return (html ?? null) as string | null;

  // HTMLRewriter requires an HTTP-shaped input/output. Wrap the string in a
  // Response, transform, and read back. This is the Workers-native idiom.
  const input = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  const rewriter = new HTMLRewriter();

  for (const tag of FORBIDDEN_TAGS) {
    rewriter.on(tag, {
      element(el) {
        el.remove();
      },
    });
  }

  // TS's DOM lib doesn't know about HTMLRewriter's element.attributes
  // iterator (Workers types have it typed as IterableIterator<[string,string]>).
  // The union with DOM's `Attr` breaks direct iteration, so we enumerate a
  // static list of dangerous attributes instead — covers every standard
  // on* handler plus style/srcdoc and is easier to audit.
  const DANGEROUS_ATTRS = [
    "style",
    "srcdoc",
    "onclick", "onload", "onerror", "onmouseover", "onmouseout",
    "onmousedown", "onmouseup", "onmousemove", "onmouseenter", "onmouseleave",
    "onfocus", "onblur", "onchange", "onsubmit", "onreset",
    "onkeydown", "onkeyup", "onkeypress", "onkeydown",
    "oninput", "onscroll", "onresize", "oncontextmenu", "onabort",
    "ondrag", "ondrop", "ondragstart", "ondragend", "ondragover",
    "onplay", "onpause", "oncanplay", "onended", "onstalled",
    "oncopy", "oncut", "onpaste",
    "onwheel", "onunload", "onanimationstart", "onanimationend", "ontransitionend",
    "onbeforeunload", "onbeforeprint", "onafterprint",
    "onhashchange", "onmessage", "onoffline", "ononline",
    "onpagehide", "onpageshow", "onpopstate", "onstorage",
    "onauxclick", "onpointerdown", "onpointerup", "onpointermove",
    "onpointerenter", "onpointerleave", "onpointercancel", "ongotpointercapture",
    "ontoggle", "onsearch",
  ];

  rewriter.on("*", {
    element(el) {
      for (const name of DANGEROUS_ATTRS) {
        if (el.hasAttribute(name)) el.removeAttribute(name);
      }

      // Sanitize link-like attributes.
      for (const attr of ["href", "src", "action", "formaction", "background", "poster"]) {
        const value = el.getAttribute(attr);
        if (value != null && !SAFE_URL_RE.test(value.trim())) {
          el.setAttribute(attr, "about:blank");
        }
      }

      // Force external links to open in a new tab without referrer leakage.
      if (el.tagName === "a") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    },
  });

  const output = rewriter.transform(input);
  return await output.text();
}
