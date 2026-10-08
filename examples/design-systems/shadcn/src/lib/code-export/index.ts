import { createParser, type LibraryJSONSchema } from "@openuidev/lang-core";
import { contentHandlers } from "./content";
import { ExportContext, ExportError } from "./context";
import { formsChartHandlers } from "./forms-charts";

export { ExportError } from "./context";

export interface ExportResult {
  dsl: string;
  code: string;
  language: "tsx";
  filename: "GeneratedUI.tsx";
  dependencies: string[];
  shadcnComponents: string[];
  warnings: string[];
}

/** Export completed DSL using the same schema that produced its live preview. */
export function exportOpenUI(dsl: string, schema: LibraryJSONSchema): ExportResult {
  if (typeof dsl !== "string" || !dsl.trim()) throw new ExportError("DSL must be a non-empty string.");
  if (dsl.length > 200_000) throw new ExportError("DSL exceeds the 200,000 character export limit.");
  let parsed;
  try {
    parsed = createParser(schema).parse(dsl);
  } catch {
    throw new ExportError("The DSL could not be parsed. Check that the response is complete and valid.");
  }
  if (parsed.meta.incomplete) throw new ExportError("Wait for the complete DSL response before exporting.");
  if (parsed.meta.unresolved.length) {
    throw new ExportError(`Unresolved references: ${parsed.meta.unresolved.join(", ")}.`);
  }
  if (parsed.meta.errors.length) {
    throw new ExportError("The DSL contains invalid component arguments.", parsed.meta.errors);
  }
  if (
    Object.keys(parsed.stateDeclarations ?? {}).length ||
    parsed.queryStatements?.length ||
    parsed.mutationStatements?.length
  ) {
    throw new ExportError("Live queries, mutations, and state bindings require the OpenUI runtime. Export a UI with resolved data.");
  }
  if (!parsed.root) throw new ExportError("The DSL must contain a complete root component.");
  const context = new ExportContext({ ...contentHandlers, ...formsChartHandlers });
  if (parsed.meta.orphaned?.length) {
    context.warn(`Unused statements were not exported: ${parsed.meta.orphaned.join(", ")}.`);
  }
  const output = context.build(context.render(parsed.root));
  return { dsl, ...output, language: "tsx", filename: "GeneratedUI.tsx" };
}
