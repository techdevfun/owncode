/**
 * Live smoke tests (blueprint section 6).
 * Soft-skip on network failure: these assert the pre-creation state
 * (npm + GitHub names still free, source article live), never hard-fail CI.
 */
import test from "node:test";
import assert from "node:assert/strict";

async function headStatus(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      redirect: "follow",
    });
    return res.status;
  } finally {
    clearTimeout(t);
  }
}

test("live: npm package name `owncode` is still unclaimed (404)", async (t) => {
  let status;
  try {
    status = await headStatus("https://registry.npmjs.org/owncode");
  } catch {
    t.skip("network unavailable - cannot verify npm name");
    return;
  }
  assert.equal(status, 404, `expected npm 404 for owncode, got ${status}`);
});

test("live: GitHub repo techdevfun/owncode does not exist yet (404)", async (t) => {
  let status;
  try {
    status = await headStatus(
      "https://api.github.com/repos/techdevfun/owncode",
    );
  } catch {
    t.skip("network unavailable - cannot verify GitHub name");
    return;
  }
  assert.equal(
    status,
    404,
    `expected GitHub 404 for techdevfun/owncode, got ${status}`,
  );
});

test("live: Jankiewicz article URL returns 200", async (t) => {
  let status;
  try {
    status = await headStatus(
      "https://jakub.jankiewicz.org/blog/ai-code-open-source/",
    );
  } catch {
    t.skip("network unavailable - cannot verify article URL");
    return;
  }
  assert.equal(status, 200, `expected article 200, got ${status}`);
});
