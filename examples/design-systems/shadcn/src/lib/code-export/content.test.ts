import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { AlertDialogAction } from "@/components/ui/alert-dialog";
import { PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { contentHandlers } from "./content";
import { ExportContext, type Props } from "./context";

const node = (typeName: string, props: Props = {}) => ({
  type: "element",
  typeName,
  props,
  partial: false,
});

function generate(children: unknown[], context = new ExportContext(contentHandlers)) {
  return context.build(context.render(node("Card", { children })));
}

function compile(code: string) {
  const result = ts.transpileModule(code, {
    fileName: "GeneratedContent.tsx",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.deepEqual(
    (result.diagnostics ?? []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
    "Generated content must be valid TSX",
  );
  return result.outputText;
}

async function render(code: string) {
  const generatedModule = await load(code);
  return renderToStaticMarkup(createElement(generatedModule.default));
}

async function load(code: string) {
  return import(
    `data:text/javascript;base64,${Buffer.from(compile(code)).toString("base64")}`
  );
}

function elements(value: unknown): ReactElement<Props>[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!isValidElement<Props>(value)) return [];
  return [value, ...elements(value.props.children)];
}

function helperElement(value: unknown, name: string): ReactElement<Props> {
  const element = elements(value).find(
    (item) => typeof item.type === "function" && item.type.name === name,
  );
  assert.ok(element, `Generated ${name} must be rendered`);
  return element;
}

function strictDiagnostics(code: string): string[] {
  const configPath = fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  options.incremental = false;
  options.noEmit = true;
  options.strict = true;
  const filename = fileURLToPath(new URL("../../../src/GeneratedContent.tsx", import.meta.url));
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === filename
      ? ts.createSourceFile(path, code, languageVersion, true, ts.ScriptKind.TSX)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const location = diagnostic.file && diagnostic.start != null
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
    return `${diagnostic.file?.fileName ?? ""}:${location ? location.line + 1 : ""} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}

test("every content, layout, and overlay component has an export handler", () => {
  for (const name of [
    "Card", "CardHeader", "TextContent", "MarkDownRenderer", "Heading", "Blockquote",
    "InlineCode", "Alert", "Badge", "Avatar", "CodeBlock", "Image", "ImageBlock",
    "Progress", "Separator", "Table", "Tabs", "Accordion", "Carousel", "Tag",
    "TagBlock", "DialogBlock", "AlertDialogBlock", "DrawerBlock", "PaginationBlock",
    "CalendarBlock",
  ]) {
    assert.equal(typeof contentHandlers[name], "function", `${name} must be exportable`);
  }
});

test("escapes JSX text and attributes, including code, markdown, tables, and nested panels", async () => {
  const hostile = '"} /><script>globalThis.contentExportPwned = true</script>{` ${danger}';
  const result = generate([
    node("CardHeader", { title: hostile, description: hostile }),
    node("Heading", { text: hostile }),
    node("TextContent", { text: hostile }),
    node("InlineCode", { code: hostile }),
    node("CodeBlock", { code: hostile, title: hostile, language: hostile }),
    node("MarkDownRenderer", { text: hostile }),
    node("ImageBlock", { src: "/image.png", alt: hostile, caption: hostile }),
    node("Table", {
      columns: [node("Col", { header: hostile })],
      rows: [[hostile]],
    }),
    node("Tabs", {
      items: [node("TabItem", { value: hostile, trigger: hostile, content: [node("TextContent", { text: hostile })] })],
    }),
  ]);
  const html = await render(result.code);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.equal((globalThis as Record<string, unknown>).contentExportPwned, undefined);
  assert.ok(!result.code.includes("@openuidev/"));
  assert.deepEqual(result.warnings, []);
});

test("preserves numeric and boolean cells, tag defaults, and the initially active tab", async () => {
  const result = generate([
    node("Table", {
      columns: [
        node("Col", { header: "Revenue", type: "number" }),
        node("Col", { header: "Active", type: "boolean" }),
      ],
      rows: [[1250, false], [0, true]],
    }),
    node("TagBlock", { tags: ["Plain", node("Tag", { text: "Secondary" })] }),
    node("Badge", { text: "Primary" }),
    node("Tabs", {
      items: [
        node("TabItem", { value: "first", trigger: "First", content: [node("TextContent", { text: "First panel" })] }),
        node("TabItem", { value: "second", trigger: "Second", content: [node("TextContent", { text: "Second panel" })] }),
      ],
    }),
  ]);
  const html = await render(result.code);
  assert.match(html, /text-right tabular-nums[^>]*>1250<\/td>/);
  assert.match(html, />false<\/td>/);
  assert.match(html, />true<\/td>/);
  assert.match(html, /text-right tabular-nums[^>]*>0<\/td>/);
  assert.match(html, /bg-secondary[^>]*>Secondary<\/span>/);
  assert.match(html, /bg-primary[^>]*>Primary<\/span>/);
  assert.ok(html.includes("First panel"));
  assert.ok(!html.includes("Second panel"));
  assert.deepEqual(result.warnings, []);
});

test("keeps extra table data and warns for unexpected parent-consumed nodes", async () => {
  const result = generate([
    node("Table", {
      columns: [node("Col", { header: "Name" })],
      rows: [["A", "Extra cell"]],
    }),
    node("Tabs", {
      items: [
        node("TabItem", { value: "main", trigger: "Main", content: [] }),
        node("Heading", { text: "Misplaced heading" }),
      ],
    }),
    node("Accordion", { items: [node("TextContent", { text: "Misplaced content" })] }),
    node("TagBlock", { tags: [node("TextContent", { text: "Misplaced tag" })] }),
  ]);
  const html = await render(result.code);
  assert.ok(html.includes("Extra cell"));
  assert.ok(html.includes("Misplaced heading"));
  assert.ok(html.includes("Misplaced content"));
  assert.ok(html.includes("Misplaced tag"));
  assert.equal(result.warnings.length, 4);
  assert.throws(
    () => generate([node("Tabs", { items: [node("UnknownPanel", { text: "Never drop me" })] })]),
    /UnknownPanel/,
  );
});

test("empty layouts and fallback siblings remain valid when exported at the top level", async () => {
  for (const root of [
    node("Tabs", { items: [] }),
    node("Tabs", { items: [node("Heading", { text: "One" }), node("Heading", { text: "Two" })] }),
    node("Table", { columns: [node("Heading", { text: "Unexpected column" })], rows: [["Cell"]] }),
    node("Accordion", { items: [node("Heading", { text: "Unexpected item" })] }),
  ]) {
    const context = new ExportContext(contentHandlers);
    const result = context.build(context.render(root));
    await render(result.code);
  }
});

test("confirmation dialogs emit the confirm label through onAction and work without a callback", async () => {
  const label = 'Delete "} /><script>ignored</script>';
  const result = generate([
    node("AlertDialogBlock", {
      triggerLabel: "Delete item",
      title: "Confirm deletion",
      description: "Cannot undo",
      confirmLabel: label,
    }),
  ]);
  const generatedModule = await load(result.code);
  const events: unknown[] = [];
  for (const onAction of [(event: unknown) => events.push(event), undefined]) {
    const tree = generatedModule.default({ onAction });
    const confirm = elements(tree).find((element) => element.type === AlertDialogAction);
    assert.ok(confirm);
    confirm.props.onClick({ currentTarget: { closest: () => null } });
  }
  assert.deepEqual(events, [{ type: "continue_conversation", label, params: {} }]);
});

test("pagination updates local selection, emits page callbacks, and respects both boundaries", async () => {
  for (const fixture of [
    { current: 1, total: 10, control: "previous", expected: 1 },
    { current: 10, total: 10, control: "next", expected: 10 },
    { current: 4, total: 10, control: "previous", expected: 3 },
    { current: 4, total: 10, control: "next", expected: 5 },
    { current: 4, total: 10, control: "page", page: 10, expected: 10 },
    { current: 2, total: 3, control: "next", expected: 3, withoutCallback: true },
  ]) {
    const result = generate([
      node("PaginationBlock", { currentPage: fixture.current, totalPages: fixture.total }),
    ]);
    const generatedModule = await load(result.code);
    const events: unknown[] = [];
    const pagination = helperElement(
      generatedModule.default({ onAction: fixture.withoutCallback ? undefined : (event: unknown) => events.push(event) }),
      "ExportedPagination",
    );
    const PaginationComponent = pagination.type as (props: Props) => ReactElement<Props>;
    let clicked = false;
    let prevented = false;
    // React owns the real hook state. Calling the generated component inside
    // this probe exposes its event props before the shadcn primitives render.
    // React rerenders the probe after the click updates that state.
    function Probe() {
      const view = PaginationComponent(pagination.props);
      if (!clicked) {
        clicked = true;
        const target = elements(view).find((element) =>
          fixture.control === "page"
            ? element.type === PaginationLink && element.props.children === fixture.page
            : element.type === (fixture.control === "next" ? PaginationNext : PaginationPrevious),
        );
        assert.ok(target);
        target.props.onClick({ preventDefault: () => { prevented = true; } });
      }
      return view;
    }
    const html = renderToStaticMarkup(createElement(Probe));
    assert.equal(prevented, true);
    assert.match(html, new RegExp(`aria-current="page"[^>]*>${fixture.expected}</a>`));
    assert.deepEqual(
      events,
      fixture.expected === fixture.current || fixture.withoutCallback
        ? []
        : [{ type: "continue_conversation", label: `Go to page ${fixture.expected}` }],
    );
  }
});

test("all calendar modes retain user selections using local React state", async () => {
  const from = new Date("2025-06-10T12:00:00");
  const to = new Date("2025-06-12T12:00:00");
  for (const [mode, selection] of [
    ["single", from],
    ["multiple", [from, to]],
    ["range", { from, to }],
  ] as const) {
    const result = generate([
      node("CalendarBlock", { mode, defaultMonth: "2025-06-01", numberOfMonths: 1 }),
    ]);
    const generatedModule = await load(result.code);
    const calendar = helperElement(generatedModule.default(), "ExportedCalendar");
    const CalendarComponent = calendar.type as (props: Props) => ReactElement<Props>;
    let picked = false;
    let selected: unknown;
    function Probe() {
      const view = CalendarComponent(calendar.props);
      selected = view.props.selected;
      if (!picked) {
        picked = true;
        view.props.onSelect(selection);
      }
      return view;
    }
    renderToStaticMarkup(createElement(Probe));
    assert.deepEqual(selected, selection);
  }
});

test("generated content and stateful helpers typecheck strictly with actual shadcn imports", async () => {
  const children = [
    node("CardHeader", { title: "Title", description: "Description" }),
    ...["small", "default", "large", "small-heavy", "large-heavy"].map((size) =>
      node("TextContent", { text: size, size }),
    ),
    node("MarkDownRenderer", { text: "~~GFM~~ **markdown**" }),
    ...["h1", "h2", "h3", "h4"].map((level) => node("Heading", { text: level, level })),
    node("Blockquote", { text: "Quote", cite: "Author" }),
    node("InlineCode", { code: "const n = 1;" }),
    ...["default", "destructive", "info", "success", "warning"].map((variant) =>
      node("Alert", { title: variant, description: "Details", variant }),
    ),
    ...["default", "secondary", "destructive", "outline", "ghost", "link"].map((variant) =>
      node("Badge", { text: variant, variant }),
    ),
    node("Avatar", { src: "/profile.png", alt: "User", fallback: "US" }),
    node("Avatar", { fallback: "FB" }),
    node("CodeBlock", { title: "Example", language: "ts", code: "const n = 1;" }),
    node("Image", { src: "/image.png" }),
    node("ImageBlock", { src: "/caption.png", alt: "Captioned", caption: "Caption" }),
    node("Progress", { value: 42, label: "Complete" }),
    node("Separator"),
    node("Separator", { orientation: "vertical" }),
    node("Table", { columns: [node("Col", { header: "Amount", type: "number" })], rows: [[100]] }),
    node("Tabs", { items: [node("TabItem", { value: "a", trigger: "A", content: [node("TextContent", { text: "Panel" })] })] }),
    ...["single", "multiple"].map((type) =>
      node("Accordion", { type, items: [node("AccordionItem", { value: "a", trigger: "A", content: [node("TextContent", { text: "Inside" })] })] }),
    ),
    ...["default", "card"].map((variant) =>
      node("Carousel", { variant, slides: [[node("TextContent", { text: "Slide" })]] }),
    ),
    node("Tag", { text: "Tag" }),
    node("TagBlock", { tags: ["Plain", node("Tag", { text: "Tag" })] }),
    node("DialogBlock", { triggerLabel: "View", title: "Details", description: "Description", content: [node("TextContent", { text: "Dialog body" })] }),
    node("AlertDialogBlock", { triggerLabel: "Delete", title: "Confirm", description: "Cannot undo", confirmLabel: "Delete", triggerVariant: "destructive" }),
    node("DrawerBlock", { triggerLabel: "Open", title: "Report", content: [node("TextContent", { text: "Drawer body" })] }),
    node("PaginationBlock", { currentPage: 4, totalPages: 10 }),
    node("PaginationBlock", { currentPage: 1, totalPages: 3 }),
    ...["single", "multiple", "range"].map((mode) =>
      node("CalendarBlock", { mode, defaultMonth: "2025-06-01", numberOfMonths: mode === "range" ? 2 : 1 }),
    ),
    node("CalendarBlock"),
  ];
  // Occupy the usual identifiers with real, differently named exports. The
  // generator must consistently use each identifier returned by useImport.
  const context = new ExportContext(contentHandlers);
  for (const name of ["Calendar", "Info", "Table", "Badge"]) {
    context.useImport(name, "lucide-react");
  }
  for (const name of ["Card", "Avatar", "useState"]) {
    context.addHelper(name, `const ${name} = () => null;`);
  }
  context.useDefaultImport("ReactMarkdown", "remark-gfm");
  const result = generate(children, context);
  assert.deepEqual(strictDiagnostics(result.code), []);
  assert.ok(!result.dependencies.some((dependency) => dependency.includes("openui")));
  assert.equal((result.code.match(/function ExportedPagination\(/g) ?? []).length, 1);
  assert.equal((result.code.match(/function ExportedCalendar\(/g) ?? []).length, 1);
  const html = await render(result.code);
  assert.ok(html.includes('data-slot="calendar"'));
  assert.ok(html.includes("<del>GFM</del>"));
  assert.match(html, /aria-current="page"[^>]*>4<\/a>/);
  assert.ok(html.includes('data-slot="carousel"'));
});
