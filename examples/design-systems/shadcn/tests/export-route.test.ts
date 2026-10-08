import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../src/app/api/export/route";

function request(body: unknown) {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("export endpoint returns the DSL and standalone React code together", async () => {
  const dsl = 'root = Card([Heading("Hello from shadcn")])';
  const response = await POST(request({ dsl }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.dsl, dsl);
  assert.equal(result.filename, "GeneratedUI.tsx");
  assert.ok(result.code.includes("Hello from shadcn"));
  assert.ok(!result.code.includes("@openuidev"));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("export endpoint rejects malformed requests and invalid DSL", async () => {
  assert.equal((await POST(request({}))).status, 400);
  assert.equal((await POST(request({ dsl: "" }))).status, 400);
  assert.equal((await POST(request({ dsl: "x".repeat(300_000) }))).status, 400);
  assert.equal((await POST(request({ dsl: "root = Card([Unregistered()])" }))).status, 422);
  const malformed = new Request("http://localhost/api/export", { method: "POST", body: "{" });
  assert.equal((await POST(malformed)).status, 400);
});
