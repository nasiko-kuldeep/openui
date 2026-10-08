import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Recharts from "recharts";
import ts from "typescript";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ExportContext, jsx, type Props } from "./context";
import { formsChartHandlers } from "./forms-charts";

const node = (typeName: string, props: Props = {}) => ({
  type: "element", typeName, props, partial: false,
});

function generate(children: unknown[], context = new ExportContext(formsChartHandlers)) {
  return context.build(jsx("div", undefined, context.render(children)));
}

async function load(code: string) {
  const result = ts.transpileModule(code, {
    fileName: "GeneratedFormsCharts.tsx",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  return import(`data:text/javascript;base64,${Buffer.from(result.outputText).toString("base64")}`);
}

async function render(code: string) {
  const generatedModule = await load(code);
  return renderToStaticMarkup(createElement(generatedModule.default));
}

function strictDiagnostics(code: string): string[] {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const config = ts.readConfigFile(root + "tsconfig.json", ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  Object.assign(options, { incremental: false, noEmit: true, strict: true });
  const filename = root + "src/GeneratedFormsCharts.tsx";
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === filename
      ? ts.createSourceFile(path, code, languageVersion, true, ts.ScriptKind.TSX)
      : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  );
}

function elements(value: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!isValidElement<Props>(value)) return [];
  return [value, ...elements(value.props.children)];
}

function formFields() {
  return [
    node("FormControl", { label: "Email address", field: node("Input", { name: "email", type: "email", rules: { required: true, email: true } }) }),
    node("Input", { name: "password", type: "password", placeholder: "Secret", rules: { minLength: 8, maxLength: 30 } }),
    node("Input", { name: "age", type: "number", rules: { min: 0, max: 130 } }),
    node("Input", { name: "site", type: "url" }),
    node("Input", { name: "plain" }),
    node("TextArea", { name: "notes", rules: { required: true, minLength: 2 } }),
    node("TextArea", { name: "description", rows: 6 }),
    node("Select", { name: "plan", items: [node("SelectItem", { label: "Pro plan", value: "pro" })], rules: { required: true } }),
    node("Select", { name: "country", placeholder: "Choose country", defaultValue: "in", items: [{ value: "in", label: "India" }] }),
    node("CheckBoxGroup", { name: "features", items: [node("CheckBoxItem", { label: "Reports", value: "reports" })] }),
    node("RadioGroup", { name: "billing", items: [node("RadioItem", { label: "Monthly", value: "monthly" })] }),
    node("SwitchGroup", { name: "alerts", items: [node("SwitchItem", { label: "Email alerts", value: "email" })] }),
    node("DatePicker", { name: "date" }),
    node("DatePicker", { name: "start", defaultValue: "2025-06-20T12:00:00Z", placeholder: "Choose date" }),
    node("Slider", { name: "volume", min: 10, max: 50, step: 5 }),
    node("Slider", { name: "zero", min: 0, defaultValue: 0 }),
    node("Label", { text: "Volume", htmlFor: "volume" }),
  ];
}

function chartCases() {
  const series = [
    node("Series", { category: "Revenue", values: [10, 25] }),
    node("Series", { category: "Cost", values: [5, 15] }),
  ];
  const slices = [node("Slice", { category: "Paid", value: 60 }), node("Slice", { category: "Free", value: 40 })];
  return [
    ...["BarChart", "LineChart", "AreaChart", "RadarChart"].map((name) =>
      node(name, { labels: ["Jan", "Feb"], series }),
    ),
    node("BarChart", { labels: ["Jan", "Feb"], series, variant: "stacked" }),
    node("LineChart", { labels: ["Month", "Sales", "Margin"], series: [["Jan", 100, 10], ["Feb", 150, 20]] }),
    node("AreaChart", { labels: ["Jan", "Feb"], series: [{ category: "Visitors", values: [500, 750] }] }),
    node("PieChart", { slices }),
    node("PieChart", { slices, donut: true }),
    node("RadialChart", { slices }),
    node("ScatterChart", { xLabel: "Spend", yLabel: "Return", series: [
      node("ScatterSeries", { category: "East", points: [
        node("Point", { x: 10, y: 20, label: "January" }), node("Point", { x: 30, y: 50 }),
      ] }),
      { category: "West", points: [{ x: 15, y: 25 }] },
    ] }),
  ];
}

test("every form, action, chart, and parent-consumed data node has an exporter", () => {
  for (const name of [
    "Form", "FormControl", "Label", "Input", "TextArea", "Select", "DatePicker",
    "Slider", "CheckBoxGroup", "RadioGroup", "SwitchGroup", "Button", "Buttons",
    "FollowUpBlock", "BarChart", "LineChart", "AreaChart", "RadarChart", "PieChart",
    "RadialChart", "ScatterChart", "SelectItem", "CheckBoxItem", "RadioItem",
    "SwitchItem", "FollowUpItem", "Series", "Slice", "ScatterSeries", "Point",
  ]) {
    assert.equal(typeof formsChartHandlers[name], "function", `${name} must be exportable`);
  }
});

test("all emitted controls and charts compile strictly with actual imports and identifier collisions", () => {
  const context = new ExportContext(formsChartHandlers);
  for (const name of ["Button", "Label", "Calendar", "Slider", "Select", "Input", "BarChart", "useState"]) {
    context.addHelper(name, `const ${name} = () => null;`);
  }
  const result = generate([
    node("Form", { name: "settings", fields: formFields(), buttons: node("Buttons", { buttons: [
      ...["default", "destructive", "outline", "secondary", "ghost", "link"].map((variant) =>
        node("Button", { label: variant, variant, action: { type: "save", params: { variant } } }),
      ),
      ...["default", "xs", "sm", "lg", "icon"].map((size) => node("Button", { label: size, size })),
    ] }) }),
    node("Buttons", { direction: "column", buttons: [node("Button", { label: "Help", action: { type: "open_url", url: "https://example.com" } })] }),
    node("FollowUpBlock", { items: [node("FollowUpItem", { text: "Tell me more" })] }),
    ...chartCases(),
  ], context);
  assert.deepEqual(strictDiagnostics(result.code), []);
  assert.ok(!result.dependencies.some((dependency) => dependency.includes("openui")));
  assert.ok(!result.code.includes("@openuidev/"));
});

test("rendered controls preserve labels, initial values, named form data, and native constraints", async () => {
  const result = generate([
    node("Form", { name: "settings", fields: formFields(), buttons: node("Buttons", { buttons: [node("Button", { label: "Save" })] }) }),
  ]);
  const html = await render(result.code);
  const fieldTag = (name: string) => (html.match(/<(?:input|textarea)\b[^>]*>/g) ?? [])
    .find((tag) => tag.includes(`name="${name}"`)) ?? "";
  assert.match(html, /<form name="settings" class="space-y-4"/);
  assert.match(html, /for="email"[^>]*>Email address<\/label>/);
  assert.match(fieldTag("email"), /required=""/);
  assert.match(fieldTag("password"), /minLength="8"[^>]*maxLength="30"/);
  assert.match(fieldTag("age"), /min="0"[^>]*max="130"[^>]*step="any"/);
  assert.match(fieldTag("notes"), /rows="3"/);
  assert.match(fieldTag("description"), /rows="6"/);
  assert.match(fieldTag("features"), /data-export-type="json"[^>]*value="\[\]"/);
  assert.match(fieldTag("alerts"), /data-export-type="json"[^>]*value="\[\]"/);
  assert.match(fieldTag("volume"), /data-export-type="number"[^>]*value="10"/);
  assert.match(fieldTag("zero"), /value="0"/);
  assert.match(fieldTag("start"), /value="2025-06-20T12:00:00.000Z"/);
  assert.ok(html.includes("Pick a date"));
  assert.ok(html.includes("Select..."));
  assert.ok(html.includes("Monthly"));
  assert.ok(html.includes("Email alerts"));
  assert.ok(html.includes('type="button"'));
});

test("buttons dispatch action payloads and follow-ups, validate primary actions, and prevent submit reloads", async () => {
  const result = generate([
    node("Form", { name: "test", fields: [], buttons: node("Buttons", { buttons: [
      node("Button", { label: "Continue" }),
      node("Button", { label: "Custom", variant: "secondary", action: { type: "save", params: { count: 2 } } }),
    ] }) }),
    node("FollowUpBlock", { items: [node("FollowUpItem", { text: "More detail" })] }),
  ]);
  const generatedModule = await load(result.code);
  const actions: Props[] = [];
  const tree = elements(generatedModule.default({ onAction: (event: Props) => actions.push(event) }));
  const form = tree.find((element) => element.type === "form")!;
  let prevented = 0;
  form.props.onSubmit({ preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  const primary = tree.find((element) => element.props.children === "Continue")!;
  const secondary = tree.find((element) => element.props.children === "Custom")!;
  const renderButton = (element: ReactElement<Props>) =>
    (element.type as (props: Props) => ReactElement<Props>)(element.props);
  const first = renderButton(primary);
  const next = renderButton(secondary);
  assert.equal(first.props.type, "button");
  assert.equal(primary.props.validate, true);
  assert.equal(secondary.props.validate ?? false, false);
  first.props.onClick({ currentTarget: { closest: () => null } });
  next.props.onClick({ currentTarget: { closest: () => null } });
  tree.find((element) => element.props.children === "More detail")!.props.onClick({ currentTarget: { closest: () => null } });
  assert.deepEqual(actions.map(({ type, label, params }) => ({ type, label, params })), [
    { type: "continue_conversation", label: "Continue", params: {} },
    { type: "save", label: "Custom", params: { count: 2 } },
    { type: "continue_conversation", label: "More detail", params: {} },
  ]);
  let reported = 0;
  first.props.onClick({ currentTarget: { closest: () => ({ elements: [], reportValidity: () => { reported++; return false; } }) } });
  assert.equal(reported, 1);
  assert.equal(actions.length, 3);
});

test("select, checkbox, switch, slider, and date helpers retain edits in real React state and form fields", async () => {
  const result = generate([
    node("Select", { name: "plan", items: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }),
    node("CheckBoxGroup", { name: "features", items: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }),
    node("SwitchGroup", { name: "alerts", items: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }),
    node("Slider", { name: "volume", min: 10, max: 50, step: 5 }),
    node("DatePicker", { name: "start" }),
  ]);
  const generatedModule = await load(result.code);
  const tree = elements(generatedModule.default());
  const date = new Date("2025-06-20T12:00:00Z");
  const fixtures = [
    { helper: "ExportedSelect", component: Select, name: "plan", prop: "onValueChange", changes: [[0, "b"]], expected: "b" },
    { helper: "ExportedCheckBoxGroup", component: Checkbox, name: "features", prop: "onCheckedChange", changes: [[0, true], [1, true], [0, false]], expected: '["b"]' },
    { helper: "ExportedSwitchGroup", component: Switch, name: "alerts", prop: "onCheckedChange", changes: [[0, true], [1, true], [0, false]], expected: '["b"]' },
    { helper: "ExportedSlider", component: Slider, name: "volume", prop: "onValueChange", changes: [[0, [45]]], expected: 45 },
    { helper: "ExportedDatePicker", component: Calendar, name: "start", prop: "onSelect", changes: [[0, date], [0, undefined]], expected: "2025-06-20T12:00:00.000Z" },
  ];
  for (const fixture of fixtures) {
    const helper = tree.find((element) => typeof element.type === "function" && element.type.name === fixture.helper)!;
    assert.ok(helper);
    const Component = helper.type as (props: Props) => ReactElement<Props>;
    let change = 0;
    let value: unknown;
    // React owns the hooks. The probe invokes a control event, and React
    // rerenders it with the new state before producing the server markup.
    function Probe() {
      const view = Component(helper.props);
      const controls = elements(view);
      value = controls.find((element) => element.type === "input" && element.props.name === fixture.name)!.props.value;
      const next = fixture.changes[change++];
      if (next) {
        const target = controls.filter((element) => element.type === fixture.component)[Number(next[0])];
        target.props[fixture.prop](next[1]);
      }
      return view;
    }
    renderToStaticMarkup(createElement(Probe));
    assert.equal(value, fixture.expected, fixture.helper);
  }
});

test("form actions normalize typed hidden values and non-primary actions bypass required-field validation", async () => {
  const result = generate([
    node("Button", { label: "Save draft", variant: "secondary", action: { type: "save_draft" } }),
  ]);
  const generatedModule = await load(result.code);
  const actions: Props[] = [];
  const button = elements(generatedModule.default({ onAction: (event: Props) => actions.push(event) }))
    .find((element) => element.props.children === "Save draft")!;
  const view = (button.type as (props: Props) => ReactElement<Props>)(button.props);
  const entries = [
    { name: "features", value: '["reports"]', type: "json" },
    { name: "volume", value: "25", type: "number" },
    { name: "email", value: "", type: null },
  ];
  const form = {
    elements: entries.map((entry) => ({
      getAttribute: (name: string) => name === "name" ? entry.name : name === "data-export-type" ? entry.type : null,
    })),
    reportValidity: () => { assert.fail("Draft actions must bypass form validation"); },
  };
  const NativeFormData = globalThis.FormData;
  // Node's FormData has no HTML form constructor. Adapt that one browser
  // boundary while retaining real FormData iteration and the generated collector.
  class BrowserFormData extends NativeFormData {
    constructor(input?: unknown) {
      super();
      assert.equal(input, form);
      for (const entry of entries) this.append(entry.name, entry.value);
    }
  }
  globalThis.FormData = BrowserFormData;
  try {
    view.props.onClick({ currentTarget: { closest: () => form } });
  } finally {
    globalThis.FormData = NativeFormData;
  }
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "save_draft");
  assert.deepEqual({ ...actions[0].formData }, { features: ["reports"], volume: 25, email: "" });
});

test("portable validation preserves regex search, numeric bounds, email checks, and explicit custom-rule warnings", async () => {
  const result = generate([
    node("Input", { name: "email", rules: { required: true, email: true } }),
    node("TextArea", { name: "custom", rules: { oddNumber: true, pattern: "[" } }),
    node("Select", { name: "select", items: [], rules: { numeric: true } }),
  ]);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes("oddNumber")));
  assert.ok(result.warnings.some((warning) => warning.includes("pattern")));
  const generatedModule = await load(result.code + "\nexport { ExportedValidateField };");
  const check = (value: string, rules: Props) => {
    const field = {
      value,
      dataset: { exportRules: JSON.stringify(rules) },
      validity: { valid: true },
      validationMessage: "",
      setCustomValidity(message: string) {
        this.validationMessage = message;
        this.validity.valid = message === "";
      },
      setAttribute() {},
    };
    return generatedModule.ExportedValidateField(field);
  };
  assert.equal(check("", { required: true }), "This field is required");
  assert.equal(check("person@example", { email: true }), "Please enter a valid email");
  assert.equal(check("person@example.com", { email: true }), "");
  assert.equal(check("letters", { numeric: true }), "Must be a number");
  assert.equal(check("5", { min: 10 }), "Must be at least 10");
  assert.equal(check("12", { max: 10 }), "Must be no more than 10");
  assert.equal(check("12px", { numeric: true }), "");
  assert.equal(check("ab", { minLength: 3 }), "Must be at least 3 characters");
  assert.equal(check("abcd", { maxLength: 3 }), "Must be no more than 3 characters");
  assert.equal(check("prefix-ABC-suffix", { pattern: "ABC" }), "");
  assert.equal(check("wrong", { pattern: "ABC" }), "Invalid format");
  assert.equal(check("no spaces allowed", { url: true }), "Please enter a valid URL");
  assert.equal(check("https://example.com", { url: true }), "");
});

test("charts retain series values in node, inline, and table formats and disable animation and line dots", async () => {
  const result = generate(chartCases());
  const generatedModule = await load(result.code);
  const tree = elements(generatedModule.default());
  const bars = tree.filter((element) => element.type === Recharts.Bar);
  assert.equal(bars.length, 4);
  assert.equal(bars[0].props.isAnimationActive, false);
  assert.equal(bars[0].props.radius, 4);
  assert.equal(bars[2].props.stackId, "stack");
  const line = tree.find((element) => element.type === Recharts.Line)!;
  assert.equal(line.props.dot, false);
  assert.equal(line.props.strokeWidth, 2);
  const area = tree.find((element) => element.type === Recharts.Area)!;
  assert.equal(area.props.fillOpacity, 0.2);
  const radar = tree.find((element) => element.type === Recharts.Radar)!;
  assert.equal(radar.props.fillOpacity, 0.3);
  const verticalGrid = tree.find((element) => element.type === Recharts.CartesianGrid)!;
  assert.equal(verticalGrid.props.vertical, false);
  const chart = tree.find((element) => element.type === Recharts.BarChart)!;
  assert.deepEqual(chart.props.data, [
    { category: "Jan", series_0: 10, series_1: 5 },
    { category: "Feb", series_0: 25, series_1: 15 },
  ]);
  const tableChart = tree.filter((element) => element.type === Recharts.LineChart)[1];
  assert.deepEqual(tableChart.props.data, [
    { category: "Jan", series_0: 100, series_1: 10 },
    { category: "Feb", series_0: 150, series_1: 20 },
  ]);
  const inlineChart = tree.filter((element) => element.type === Recharts.AreaChart)[1];
  assert.deepEqual(inlineChart.props.data, [
    { category: "Jan", series_0: 500 },
    { category: "Feb", series_0: 750 },
  ]);
});

test("pie, radial, and scatter charts preserve slices, point labels, colors, axis labels, and donut defaults", async () => {
  const generatedModule = await load(generate(chartCases()).code);
  const tree = elements(generatedModule.default());
  const pies = tree.filter((element) => element.type === Recharts.Pie);
  assert.equal(pies[0].props.innerRadius, 0);
  assert.equal(pies[1].props.innerRadius, "50%");
  assert.deepEqual(pies[0].props.data, [
    { category: "series_0", label: "Paid", value: 60 },
    { category: "series_1", label: "Free", value: 40 },
  ]);
  assert.equal(tree.find((element) => element.type === Recharts.Cell)!.props.fill, "var(--chart-1)");
  const radial = tree.find((element) => element.type === Recharts.RadialBarChart)!;
  assert.equal(radial.props.innerRadius, 30);
  assert.equal(radial.props.outerRadius, 110);
  assert.equal(radial.props.data[1].fill, "var(--chart-2)");
  const scatter = tree.filter((element) => element.type === Recharts.Scatter);
  assert.deepEqual(scatter[0].props.data, [{ x: 10, y: 20, label: "January" }, { x: 30, y: 50 }]);
  assert.deepEqual(scatter[1].props.data, [{ x: 15, y: 25 }]);
  assert.ok(tree.some((element) => element.type === Recharts.XAxis && element.props.name === "Spend"));
  assert.ok(tree.some((element) => element.type === Recharts.YAxis && element.props.name === "Return"));
});

test("hostile form text and chart series names remain data without entering JSX or CSS", async () => {
  const hostile = 'x};}</style><script>globalThis.formsExportPwned = true</script>{`';
  const result = generate([
    node("Input", { name: hostile, placeholder: hostile, defaultValue: hostile }),
    node("Label", { text: hostile, htmlFor: hostile }),
    node("Button", { label: hostile, action: { type: "save", params: { text: hostile } } }),
    node("BarChart", { labels: [hostile], series: [node("Series", { category: hostile, values: [42] })] }),
  ]);
  const html = await render(result.code);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>globalThis.formsExportPwned"));
  assert.equal((globalThis as Record<string, unknown>).formsExportPwned, undefined);
  const styles = html.match(/<style>[\s\S]*?<\/style>/g) ?? [];
  assert.equal(styles.length, 1);
  assert.ok(styles[0].includes("--color-series_0"));
  assert.ok(!styles[0].includes(hostile));
});

test("unsupported child data and custom rules are reported explicitly", async () => {
  const result = generate([
    node("Series", { category: "Orphaned", values: [1] }),
    node("Select", { name: "plan", items: [node("UnknownOption", { value: "x", label: "Bad" })] }),
    node("BarChart", { labels: ["Jan"], series: [node("UnknownSeries", { category: "Bad", values: [1] })] }),
  ]);
  assert.ok(result.warnings.some((warning) => warning.includes("UnknownOption")));
  assert.ok(result.warnings.some((warning) => warning.includes("UnknownSeries")));
  assert.ok(result.warnings.some((warning) => warning.includes("Series is a data item")));
  assert.ok((await render(result.code)).includes("Unsupported standalone data item: Series"));
});
