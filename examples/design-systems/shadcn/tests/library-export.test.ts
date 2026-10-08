import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import ts from "typescript";
import { shadcnChatLibrary, shadcnExamples } from "../src/lib/shadcn-genui";
import { exportOpenUI } from "../src/lib/code-export";
import { contentHandlers } from "../src/lib/code-export/content";
import { formsChartHandlers } from "../src/lib/code-export/forms-charts";

test("all registered shadcn components can be exported", () => {
  const handlers = { ...contentHandlers, ...formsChartHandlers };
  assert.deepEqual(
    Object.keys(shadcnChatLibrary.components).filter((name) => !Object.hasOwn(handlers, name)),
    [],
    "New DSL components must include an explicit standalone code mapping.",
  );
});

test("all library examples produce TSX that typechecks against the actual shadcn components", () => {
  const schema = shadcnChatLibrary.toJSONSchema();
  const files = new Map(shadcnExamples.map((dsl, index) => [
    resolve(`src/__ExportFixture${index}.tsx`),
    exportOpenUI(dsl, schema).code,
  ]));
  const config = ts.readConfigFile(resolve("tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  options.incremental = false;
  options.noEmit = true;
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) =>
    files.has(filename)
      ? ts.createSourceFile(filename, files.get(filename)!, languageVersion, true, ts.ScriptKind.TSX)
      : getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...files.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    `${diagnostic.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
  );
  assert.deepEqual(diagnostics, [], "Every generated example must compile without OpenUI.");
});
