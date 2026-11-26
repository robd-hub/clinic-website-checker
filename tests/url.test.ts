import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CheckError, checkLinkPath, normaliseUrl, readUrlParam, runnableQueryUrl } from "../lib/url";

describe("shared check links", () => {
  it("accepts a bare domain, a www domain, and a full http(s) URL", () => {
    assert.equal(runnableQueryUrl("halifaxchiropractic.co.uk"), "halifaxchiropractic.co.uk");
    assert.equal(normaliseUrl("halifaxchiropractic.co.uk"), "https://halifaxchiropractic.co.uk/");

    assert.equal(runnableQueryUrl("www.halifaxchiropractic.co.uk"), "www.halifaxchiropractic.co.uk");
    assert.equal(normaliseUrl("www.halifaxchiropractic.co.uk"), "https://www.halifaxchiropractic.co.uk/");

    assert.equal(
      runnableQueryUrl("https://www.halifaxchiropractic.co.uk"),
      "https://www.halifaxchiropractic.co.uk",
    );
    assert.equal(
      normaliseUrl("http://www.halifaxchiropractic.co.uk/contact"),
      "http://www.halifaxchiropractic.co.uk/contact",
    );
  });

  it("trims a usable address and keeps the visitor's spelling", () => {
    assert.equal(runnableQueryUrl("  HalifaxChiropractic.co.uk  "), "HalifaxChiropractic.co.uk");
    assert.equal(readUrlParam(["https://example.co.uk", "other.co.uk"]), "https://example.co.uk");
    assert.equal(readUrlParam(undefined), "");
  });

  it("ignores empty and unsafe query values", () => {
    for (const value of ["", "   ", "not a url", "hello", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "https://user:pass@example.co.uk", "a".repeat(301)]) {
      assert.equal(runnableQueryUrl(value), null, value);
    }
    assert.throws(() => normaliseUrl("javascript:alert(1)"), CheckError);
    assert.throws(() => normaliseUrl("https://user:pass@example.co.uk"), CheckError);
  });

  it("builds a link that round-trips through a query string", () => {
    const bare = checkLinkPath("halifaxchiropractic.co.uk");
    assert.equal(bare, "/?url=halifaxchiropractic.co.uk");
    assert.equal(
      new URL(bare, "https://check.designimp.com").searchParams.get("url"),
      "halifaxchiropractic.co.uk",
    );

    const full = checkLinkPath("https://www.halifaxchiropractic.co.uk");
    assert.equal(
      new URL(full, "https://check.designimp.com").searchParams.get("url"),
      "https://www.halifaxchiropractic.co.uk",
    );
  });
});
