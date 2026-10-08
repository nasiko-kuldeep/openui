import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { exportOpenUI } from "../src/lib/code-export/index";

const schema = {
  $defs: {
    Card: { properties: { children: { type: "array" } }, required: ["children"] },
    Heading: {
      properties: { text: { type: "string" }, level: { type: "string" } },
      required: ["text"],
    },
    Button: {
      properties: {
        label: { type: "string" },
        action: {},
        variant: { type: "string" },
        size: { type: "string" },
      },
      required: ["label"],
    },
    Mystery: { properties: {} },
  },
};

function compile(code: string) {
  const result = ts.transpileModule(code, {
    fileName: "GeneratedUI.tsx",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.deepEqual(
    result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error),
    [],
    "The exported TSX must be valid TypeScript.",
  );
  return result.outputText;
}

test("returns the original DSL and executable TSX with real shadcn imports", async () => {
  const dsl = 'root = Card([Heading("Quarterly revenue", "h2"), Button("Save", null, "secondary")])';
  const result = exportOpenUI(dsl, schema);
  assert.equal(result.dsl, dsl);
  assert.equal(result.language, "tsx");
  assert.equal(result.filename, "GeneratedUI.tsx");
  assert.ok(result.shadcnComponents.includes("card"));
  assert.ok(result.shadcnComponents.includes("button"));
  assert.ok(!result.code.includes("@openuidev/"));
  assert.ok(!result.code.includes("<Renderer"));
  const source = compile(result.code);
  // The test loader resolves the real local shadcn imports in this generated module.
  const { default: GeneratedUI } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const html = renderToStaticMarkup(createElement(GeneratedUI));
  assert.match(html, /Quarterly revenue/);
  assert.match(html, /<button[^>]*>Save<\/button>/);
  assert.match(html, /bg-secondary/);
});

test("treats hostile content as text rather than executable source", async () => {
  const hostile = '"} /><script>alert(1)</script>{` ${globalThis.pwned = true}';
  const result = exportOpenUI(`root = Card([Heading(${JSON.stringify(hostile)})])`, schema);
  const source = compile(result.code);
  const { default: GeneratedUI } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const html = renderToStaticMarkup(createElement(GeneratedUI));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.equal((globalThis as Record<string, unknown>).pwned, undefined);
});

test("fails explicitly when a registered component has no code export mapping", () => {
  assert.throws(() => exportOpenUI("root = Card([Mystery()])", schema), /Mystery/);
});

test("rejects partial DSL and missing references instead of exporting a truncated UI", () => {
  assert.throws(() => exportOpenUI('root = Card([Heading("Missing', schema), /complete|incomplete/i);
  assert.throws(() => exportOpenUI("root = Card([missing])", schema), /missing|unresolved/i);
});

test("rejects invalid component arguments rather than dropping broken children", () => {
  assert.throws(() => exportOpenUI("root = Card([Heading()])", schema), /invalid|required|Heading/i);
});

test("rejects runtime bindings that cannot run without the OpenUI runtime", () => {
  assert.throws(
    () => exportOpenUI('root = Card([Heading($title)])\n$title = "Hello"', schema),
    /runtime|dynamic|binding|state/i,
  );
});

test("rejects unsafe navigation targets in exported actions", () => {
  assert.throws(
    () => exportOpenUI('root = Card([Button("Go", {type: "open_url", url: "javascript:alert(1)"})])', schema),
    /url|navigation|protocol/i,
  );
});
