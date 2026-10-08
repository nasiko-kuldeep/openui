// This module writes source text. Only expr() values created by our component
// mappings may become executable expressions; all DSL values are serialized.
const expressionToken = Symbol("source-expression");
type Expression = { [expressionToken]: true; source: string };
export type Props = Record<string, any>;
export type Handler = (props: Props, context: ExportContext) => string;

export class ExportError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ExportError";
  }
}

export function expr(source: string): Expression {
  return { [expressionToken]: true, source };
}

export function literal(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value, (_key, v: unknown) => {
    if (
      typeof v === "function" ||
      typeof v === "symbol" ||
      typeof v === "bigint" ||
      (typeof v === "number" && !Number.isFinite(v))
    ) {
      throw new ExportError("Only finite JSON values can be exported.");
    }
    return v;
  }).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function text(value: unknown): string {
  return `{${literal(value == null ? "" : String(value))}}`;
}

export function jsx(
  tag: string,
  attrs: Record<string, unknown | Expression> = {},
  children?: string | string[],
): string {
  const attributes = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => {
      if (value === true) return ` ${name}`;
      const source =
        typeof value === "object" && value !== null && expressionToken in value
          ? (value as Expression).source
          : literal(value);
      return ` ${name}={${source}}`;
    })
    .join("");
  const body = Array.isArray(children) ? children.filter(Boolean).join("\n") : children;
  if (!body) return `<${tag}${attributes} />`;
  return `<${tag}${attributes}>\n${body.split("\n").map((line) => `  ${line}`).join("\n")}\n</${tag}>`;
}

export class ExportContext {
  private readonly imports = new Map<string, Map<string, string>>();
  private readonly identifiers = new Set(["GeneratedUI", "GeneratedAction", "GeneratedActionHandler"]);
  private readonly helpers = new Map<string, string>();
  private readonly warnings = new Set<string>();
  private visited = 0;
  private depth = 0;

  constructor(private readonly handlers: Record<string, Handler>) {}

  useImport(name: string, from: string): string {
    return this.registerImport(name, from, name);
  }

  useDefaultImport(name: string, from: string): string {
    return this.registerImport("default", from, name);
  }

  private registerImport(exported: string, from: string, preferred: string): string {
    const entries = this.imports.get(from) ?? new Map<string, string>();
    const previous = entries.get(exported);
    if (previous) return previous;
    let identifier = preferred;
    for (let suffix = 2; this.identifiers.has(identifier); suffix++) {
      identifier = `${preferred}${suffix}`;
    }
    this.identifiers.add(identifier);
    entries.set(exported, identifier);
    this.imports.set(from, entries);
    return identifier;
  }

  addHelper(name: string, source: string): string {
    const previous = this.helpers.get(name);
    if (previous && previous !== source) throw new ExportError(`Conflicting export helper: ${name}.`);
    this.helpers.set(name, source);
    this.identifiers.add(name);
    return name;
  }

  warn(message: string): void {
    this.warnings.add(message);
  }

  render(value: unknown): string {
    if (++this.visited > 10_000 || this.depth > 100) {
      throw new ExportError("This UI exceeds the code export size or nesting limit.");
    }
    if (value == null) return "";
    if (Array.isArray(value)) {
      this.depth++;
      try {
        return value.map((child) => this.render(child)).filter(Boolean).join("\n");
      } finally {
        this.depth--;
      }
    }
    if (typeof value !== "object") return text(value);
    const node = value as Record<string, unknown>;
    if (node.type !== "element" || typeof node.typeName !== "string" || !node.props) {
      throw new ExportError("An unresolved value cannot be exported as a React component.");
    }
    if (node.partial) throw new ExportError("Wait for the complete response before exporting.");
    if (node.hasDynamicProps) {
      throw new ExportError("Dynamic expressions require the OpenUI runtime. Export resolved data instead.");
    }
    const handler = Object.hasOwn(this.handlers, node.typeName) && this.handlers[node.typeName];
    if (!handler) throw new ExportError(`No standalone TSX mapping is registered for ${node.typeName}.`);
    this.depth++;
    try {
      return handler(node.props as Props, this);
    } finally {
      this.depth--;
    }
  }

  action(action: unknown, label: unknown): Expression {
    const payload = action == null ? { type: "continue_conversation" } : action;
    if (typeof payload !== "object" || Array.isArray(payload)) {
      throw new ExportError("An action must be a resolved action object.");
    }
    const entry = payload as Record<string, unknown>;
    if (entry.steps || entry.k) {
      throw new ExportError("Runtime action expressions must be resolved before exporting.");
    }
    if (entry.type === "open_url") {
      if (typeof entry.url !== "string" || !isSafeUrl(entry.url)) {
        throw new ExportError("Navigation URL must use http, https, mailto, tel, or a relative path.");
      }
    } else {
      this.warn("Connect the generated component's onAction callback to your application for chat and custom actions.");
    }
    const eventType = this.useImport("MouseEvent", "react");
    this.addHelper("dispatchGeneratedAction", `
function dispatchGeneratedAction(
  event: ${eventType}<HTMLElement>,
  action: { type?: string; url?: string; context?: string; params?: Record<string, unknown> },
  label: string,
  onAction?: GeneratedActionHandler,
) {
  const form = event.currentTarget.closest("form");
  const formData: Record<string, unknown> = Object.create(null);
  if (form) {
    for (const [key, value] of new FormData(form)) {
      const field = Array.from(form.elements).find((element) => element.getAttribute("name") === key);
      const valueType = field?.getAttribute("data-export-type");
      let parsedValue: unknown = value;
      if (typeof value === "string" && valueType === "json") {
        try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
      } else if (typeof value === "string" && valueType === "number" && value !== "") {
        const number = Number(value);
        if (Number.isFinite(number)) parsedValue = number;
      }
      const previous = formData[key];
      formData[key] = previous === undefined ? parsedValue : Array.isArray(previous) ? [...previous, parsedValue] : [previous, parsedValue];
    }
  }
  if (action.type === "open_url" && action.url) {
    window.open(action.url, "_blank", "noopener,noreferrer");
    return;
  }
  onAction?.({
    type: action.type ?? "continue_conversation",
    label,
    params: action.params ?? (action.context ? { context: action.context } : {}),
    ...(form ? { formData } : {}),
  });
}`);
    return expr(
      `(event) => dispatchGeneratedAction(event, ${literal(payload)}, ${literal(String(label ?? ""))}, onAction)`,
    );
  }

  build(body: string) {
    const imports = [...this.imports.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([from, entries]) => {
        const defaultName = entries.get("default");
        const named = [...entries.entries()]
          .filter(([name]) => name !== "default")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, alias]) => name === alias ? name : `${name} as ${alias}`);
        const bindings = [defaultName, named.length ? `{ ${named.join(", ")} }` : undefined]
          .filter(Boolean).join(", ");
        return `import ${bindings} from ${literal(from)};`;
      }).join("\n");
    const code = `"use client";

${imports}

export type GeneratedAction = {
  type: string;
  label?: string;
  params?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};
export type GeneratedActionHandler = (event: GeneratedAction) => void;

${[...this.helpers.values()].join("\n\n")}

export default function GeneratedUI({ onAction }: { onAction?: GeneratedActionHandler } = {}) {
  return (
${body.split("\n").map((line) => `    ${line}`).join("\n")}
  );
}
`;
    const modules = [...this.imports.keys()];
    return {
      code,
      dependencies: [...new Set(modules
        .filter((module) => !module.startsWith("@/"))
        .map((module) => module.startsWith("@") ? module.split("/").slice(0, 2).join("/") : module.split("/")[0]))].sort(),
      shadcnComponents: modules
        .filter((module) => module.startsWith("@/components/ui/"))
        .map((module) => module.slice("@/components/ui/".length)).sort(),
      warnings: [...this.warnings],
    };
  }
}

function isSafeUrl(url: string): boolean {
  // Reject protocol obfuscation before checking relative links.
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return false;
  if (/^(?:https?:|mailto:|tel:)/i.test(url)) return true;
  return !url.startsWith("//") && !/^[^/?#]*:/.test(url);
}
