/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");

test("production builds use one Next.js worker on the deployment host", async () => {
  const configUrl = pathToFileURL(
    path.join(__dirname, "..", "next.config.mjs")
  );
  configUrl.searchParams.set("test", String(Date.now()));

  const { default: config } = await import(configUrl.href);

  assert.equal(config.experimental?.cpus, 1);
});
