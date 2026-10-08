import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";

// Run the export tests against the same TypeScript and shadcn source used by Next.
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Next's bundler resolves this extensionless entry; Node ESM needs .js.
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (context.parentURL?.startsWith("data:")) {
      context = { ...context, parentURL: pathToFileURL(resolve("package.json")).href };
    }
    const candidate = specifier.startsWith("@/")
      ? pathToFileURL(resolve("src", specifier.slice(2))).href
      : specifier.startsWith(".") && context.parentURL
        ? new URL(specifier, context.parentURL).href
        : null;
    if (candidate?.startsWith("file:") && !candidate.includes("/node_modules/")) {
      for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const url = candidate + suffix;
        if (/\.[cm]?[jt]sx?$/.test(url) && existsSync(fileURLToPath(url))) {
          return nextResolve(url, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          fileName: fileURLToPath(url),
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
