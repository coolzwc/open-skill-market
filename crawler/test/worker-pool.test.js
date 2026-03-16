/**
 * Self-test: WorkerPool drain-then-switch client selection.
 * Tests that we use the same token until it is limited, then switch to the next.
 */
import { test } from "node:test";
import assert from "node:assert";
import { WorkerPool, collectGitHubTokens } from "../worker-pool.js";

function withEnv(env, fn) {
  const orig = {};
  for (const key of Object.keys(env)) {
    orig[key] = process.env[key];
    if (env[key] != null) process.env[key] = env[key];
    else delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(orig)) {
      if (orig[key] !== undefined) process.env[key] = orig[key];
      else delete process.env[key];
    }
  }
}

test("collectGitHubTokens: no token returns empty", () => {
  withEnv({ GITHUB_TOKEN: undefined, EXTRA_TOKEN_1: undefined }, () => {
    const tokens = collectGitHubTokens();
    assert.strictEqual(tokens.length, 0);
  });
});

test("collectGitHubTokens: GITHUB_TOKEN only", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: undefined }, () => {
    const tokens = collectGitHubTokens();
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0], "tk0");
  });
});

test("collectGitHubTokens: GITHUB_TOKEN + EXTRA_TOKEN_1", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const tokens = collectGitHubTokens();
    assert.strictEqual(tokens.length, 2);
    assert.strictEqual(tokens[0], "tk0");
    assert.strictEqual(tokens[1], "tk1");
  });
});

test("drain-then-switch Core: single client always same", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: undefined }, () => {
    const pool = new WorkerPool();
    assert.strictEqual(pool.clients.length, 1);
    const a = pool.getClient();
    const b = pool.getClient();
    assert.strictEqual(a.label, "GITHUB_TOKEN");
    assert.strictEqual(b.label, "GITHUB_TOKEN");
    assert.strictEqual(a, b);
  });
});

test("drain-then-switch Core: two clients, same until current limited", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const pool = new WorkerPool();
    assert.strictEqual(pool.clients.length, 2);

    const c1 = pool.getClient();
    const c2 = pool.getClient();
    assert.strictEqual(c1.label, "GITHUB_TOKEN");
    assert.strictEqual(c2.label, "GITHUB_TOKEN");
    assert.strictEqual(c1, c2);

    c1.core.isLimited = true;
    const c3 = pool.getClient();
    assert.strictEqual(c3.label, "EXTRA_TOKEN_1");
    const c4 = pool.getClient();
    assert.strictEqual(c4.label, "EXTRA_TOKEN_1");
    assert.strictEqual(c3, c4);
  });
});

test("drain-then-switch Core: all limited returns earliest reset", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const pool = new WorkerPool();
    const now = Date.now();
    pool.clients[0].core.isLimited = true;
    pool.clients[0].core.resetTime = now + 20000;
    pool.clients[1].core.isLimited = true;
    pool.clients[1].core.resetTime = now + 10000;

    const c = pool.getClient();
    assert.strictEqual(c.core.resetTime, now + 10000);
    assert.strictEqual(c.label, "EXTRA_TOKEN_1");
  });
});

test("drain-then-switch Core: refreshBucket clears limited when resetTime passed", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const pool = new WorkerPool();
    pool.clients[0].core.isLimited = true;
    pool.clients[0].core.resetTime = Date.now() - 1000;
    pool.clients[0].core.limit = 5000;
    pool.clients[1].core.isLimited = true;

    const c = pool.getClient();
    assert.strictEqual(c.label, "GITHUB_TOKEN");
    assert.strictEqual(c.core.isLimited, false);
  });
});

test("drain-then-switch Search: same token until limited", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const pool = new WorkerPool();
    const s1 = pool.getSearchClient();
    const s2 = pool.getSearchClient();
    assert.strictEqual(s1.label, "GITHUB_TOKEN");
    assert.strictEqual(s2.label, "GITHUB_TOKEN");

    s1.search.isLimited = true;
    const s3 = pool.getSearchClient();
    assert.strictEqual(s3.label, "EXTRA_TOKEN_1");
    assert.strictEqual(pool.getSearchClient().label, "EXTRA_TOKEN_1");
  });
});

test("drain-then-switch CodeSearch: same token until limited", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const pool = new WorkerPool();
    const c1 = pool.getCodeSearchClient();
    const c2 = pool.getCodeSearchClient();
    assert.strictEqual(c1.label, "GITHUB_TOKEN");
    assert.strictEqual(c2.label, "GITHUB_TOKEN");

    c1.codeSearch.isLimited = true;
    const c3 = pool.getCodeSearchClient();
    assert.strictEqual(c3.label, "EXTRA_TOKEN_1");
  });
});

test("Core and Search indices independent", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const pool = new WorkerPool();
    pool.getClient();
    pool.getClient();
    pool.clients[0].core.isLimited = true;
    pool.getClient();
    assert.strictEqual(pool.getClient().label, "EXTRA_TOKEN_1");

    assert.strictEqual(pool.getSearchClient().label, "GITHUB_TOKEN");
    assert.strictEqual(pool.getSearchClient().label, "GITHUB_TOKEN");
  });
});

test("allClientsLimited and getNextResetTime", () => {
  withEnv({ GITHUB_TOKEN: "tk0", EXTRA_TOKEN_1: "tk1" }, () => {
    const pool = new WorkerPool();
    assert.strictEqual(pool.allClientsLimited(), false);

    pool.clients[0].core.isLimited = true;
    pool.clients[1].core.isLimited = true;
    assert.strictEqual(pool.allClientsLimited(), true);

    const t = Date.now() + 15000;
    pool.clients[0].core.resetTime = t;
    assert.strictEqual(pool.getNextResetTime(), t);
  });
});
