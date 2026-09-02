import assert from "node:assert/strict";
import test from "node:test";
import { resolveTeardownConfiguration } from "./teardown-config";

const token = "a".repeat(64);

test("accepts a public Teardown API URL in production", () => {
  const status = resolveTeardownConfiguration({
    NODE_ENV: "production",
    TEARDOWN_API_BASE_URL: "https://teardown-api.example.com/api/v1/",
    TEARDOWN_INTERNAL_TOKEN: token,
  });

  assert.deepEqual(status, {
    configuration: {
      baseUrl: "https://teardown-api.example.com/api/v1",
      token,
    },
    issue: null,
  });
});

test("rejects a localhost Teardown API URL in production", () => {
  const status = resolveTeardownConfiguration({
    NODE_ENV: "production",
    TEARDOWN_API_BASE_URL: "http://127.0.0.1:8011/api/v1",
    TEARDOWN_INTERNAL_TOKEN: token,
  });

  assert.equal(status.configuration, null);
  assert.match(status.issue ?? "", /localhost.*unreachable/i);
});

test("allows localhost during local development", () => {
  const status = resolveTeardownConfiguration({
    NODE_ENV: "development",
    TEARDOWN_API_BASE_URL: "http://127.0.0.1:8011/api/v1",
    TEARDOWN_INTERNAL_TOKEN: token,
  });

  assert.equal(status.configuration?.baseUrl, "http://127.0.0.1:8011/api/v1");
  assert.equal(status.issue, null);
});

test("reports partial and invalid configuration", () => {
  assert.match(
    resolveTeardownConfiguration({ TEARDOWN_API_BASE_URL: "https://example.com" }).issue ?? "",
    /must both be set/i,
  );
  assert.match(
    resolveTeardownConfiguration({
      TEARDOWN_API_BASE_URL: "not-a-url",
      TEARDOWN_INTERNAL_TOKEN: token,
    }).issue ?? "",
    /valid URL/i,
  );
});
