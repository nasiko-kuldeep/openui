import { expr, jsx, text, type ExportContext, type Handler, type Props } from "./context";

const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function array(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function record(value: unknown): Props | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Props
    : undefined;
}

/** Data registrations can materialize as element nodes or their inline schemas. */
function dataItems(value: unknown, typeName: string, ctx: ExportContext): Props[] {
  return array(value).flatMap((item) => {
    const node = record(item);
    if (!node) {
      ctx.warn(`${typeName}: an invalid data item could not be exported.`);
      return [];
    }
    if (node.type === "element") {
      if (node.typeName !== typeName || !record(node.props)) {
        ctx.warn(`${typeName}: unsupported child ${String(node.typeName ?? "unknown")}.`);
        return [];
      }
      return [node.props as Props];
    }
    return [node];
  });
}

function options(props: Props, typeName: string, ctx: ExportContext) {
  return dataItems(props.items, typeName, ctx).flatMap((item) => {
    if (typeof item.value !== "string" || !item.value) {
      ctx.warn(`${typeName}: an option with an empty or invalid value could not be exported.`);
      return [];
    }
    return [{ value: item.value, label: String(item.label || item.value) }];
  });
}

function validationRules(props: Props, ctx: ExportContext): Props | undefined {
  if (props.rules == null) return undefined;
  const rules = record(props.rules);
  if (!rules) {
    ctx.warn(`${String(props.name ?? "Field")}: custom validation rules could not be preserved.`);
    return undefined;
  }
  const supported: Props = {};
  for (const [key, value] of Object.entries(rules)) {
    if (value == null || value === false) continue;
    const valid =
      (["required", "email", "url", "numeric"].includes(key) && value === true) ||
      (["min", "max", "minLength", "maxLength"].includes(key) &&
        typeof value === "number" && Number.isFinite(value)) ||
      (key === "pattern" && typeof value === "string");
    if (!valid) {
      ctx.warn(`${String(props.name ?? "Field")}: custom validation rule "${key}" could not be preserved.`);
      continue;
    }
    if (key === "pattern") {
      try {
        new RegExp(value as string);
      } catch {
        ctx.warn(`${String(props.name ?? "Field")}: invalid pattern validation could not be preserved.`);
        continue;
      }
    }
    supported[key] = value;
  }
  return Object.keys(supported).length ? supported : undefined;
}

/** Keep the original rules' regex/parseFloat semantics in addition to native constraints. */
function validationHelper(ctx: ExportContext): string {
  return ctx.addHelper("ExportedValidateField", `function ExportedValidateField(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const rules = JSON.parse(field.dataset.exportRules || "{}") as Record<string, unknown>;
  const value = field.value;
  let message = "";
  for (const [rule, arg] of Object.entries(rules)) {
    if (rule === "required" && value === "") message = "This field is required";
    if (value !== "") {
      if (rule === "email" && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)) message = "Please enter a valid email";
      if (rule === "url") {
        try { new URL(value); } catch { message = "Please enter a valid URL"; }
      }
      if (rule === "numeric" && (Number.isNaN(parseFloat(value)) || value.trim() === "")) message = "Must be a number";
      if (rule === "min" && parseFloat(value) < Number(arg)) message = "Must be at least " + String(arg);
      if (rule === "max" && parseFloat(value) > Number(arg)) message = "Must be no more than " + String(arg);
      if (rule === "minLength" && value.length < Number(arg)) message = "Must be at least " + String(arg) + " characters";
      if (rule === "maxLength" && value.length > Number(arg)) message = "Must be no more than " + String(arg) + " characters";
      if (rule === "pattern" && typeof arg === "string") {
        try { if (!new RegExp(arg).test(value)) message = "Invalid format"; } catch { /* Invalid patterns are reported when exporting. */ }
      }
    }
    if (message) break;
  }
  field.setCustomValidity(message);
  field.setAttribute("aria-invalid", String(!field.validity.valid));
  return message || field.validationMessage;
}`);
}

function fieldAttributes(props: Props, ctx: ExportContext, multiline = false): Props {
  const rules = validationRules(props, ctx);
  const type = props.type ?? "text";
  const attrs: Props = {
    id: props.name,
    name: props.name,
    placeholder: props.placeholder,
    defaultValue: props.defaultValue ?? "",
    ...(multiline ? { rows: props.rows ?? 3 } : { type }),
  };
  if (!rules) return attrs;
  if (rules.required) attrs.required = true;
  if (typeof rules.minLength === "number") attrs.minLength = Math.max(0, rules.minLength);
  if (typeof rules.maxLength === "number") attrs.maxLength = Math.max(0, rules.maxLength);
  if (!multiline && type === "number") {
    attrs.min = rules.min;
    attrs.max = rules.max;
    attrs.step = "any";
  }
  // HTML pattern anchors the entire value; the DSL uses RegExp.test instead.
  // Preserve that distinction with the portable validator.
  attrs["data-export-rules"] = JSON.stringify(rules);
  const validate = validationHelper(ctx);
  attrs.onBlur = expr(`(event) => { ${validate}(event.currentTarget); }`);
  attrs.onInput = expr(`(event) => { ${validate}(event.currentTarget); }`);
  return attrs;
}

function formControl(props: Props, ctx: ExportContext): string {
  const Label = ctx.useImport("Label", "@/components/ui/label");
  const useState = ctx.useImport("useState", "react");
  const ReactNode = ctx.useImport("ReactNode", "react");
  const validate = validationHelper(ctx);
  const Field = ctx.addHelper("ExportedFormControl", `function ExportedFormControl({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ${ReactNode} }) {
  const [error, setError] = ${useState}("");
  function update(target: EventTarget, container?: HTMLElement) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      target = container?.querySelector("[data-export-rules]") ?? target;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      setError(${validate}(target));
    }
  }
  return <div className="space-y-2"
    onBlurCapture={(event) => update(event.target, event.currentTarget)}
    onInputCapture={(event) => { if (error) update(event.target); }}
    onInvalidCapture={(event) => update(event.target)}>
    <${Label} htmlFor={htmlFor}>{label}</${Label}>
    {children}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}`);
  const field = record(record(props.field)?.props);
  return jsx(Field, { label: String(props.label ?? ""), htmlFor: field?.name }, ctx.render(props.field));
}

function select(props: Props, ctx: ExportContext): string {
  const Select = ctx.useImport("Select", "@/components/ui/select");
  const Trigger = ctx.useImport("SelectTrigger", "@/components/ui/select");
  const Value = ctx.useImport("SelectValue", "@/components/ui/select");
  const Content = ctx.useImport("SelectContent", "@/components/ui/select");
  const Item = ctx.useImport("SelectItem", "@/components/ui/select");
  const useState = ctx.useImport("useState", "react");
  const useRef = ctx.useImport("useRef", "react");
  const useEffect = ctx.useImport("useEffect", "react");
  const validate = validationHelper(ctx);
  const Component = ctx.addHelper("ExportedSelect", `function ExportedSelect({ name, placeholder, items, defaultValue = "", rules = {} }: {
  name: string; placeholder: string; items: { value: string; label: string }[]; defaultValue?: string; rules?: Record<string, unknown>;
}) {
  const [value, setValue] = ${useState}(defaultValue);
  const input = ${useRef}<HTMLInputElement>(null);
  const trigger = ${useRef}<HTMLButtonElement>(null);
  ${useEffect}(() => {
    if (input.current) {
      ${validate}(input.current);
      input.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, [value, rules]);
  return <div>
    <input ref={input} type="text" name={name} value={value} onChange={(event) => setValue(event.target.value)}
      required={rules.required === true} data-export-rules={JSON.stringify(rules)}
      className="sr-only" tabIndex={-1} aria-label={name} onFocus={() => trigger.current?.focus()} />
    <${Select} value={value} onValueChange={setValue}>
      <${Trigger} ref={trigger} id={name} aria-required={rules.required === true}>
        <${Value} placeholder={placeholder} />
      </${Trigger}>
      <${Content}>
        {items.map((item, index) => <${Item} key={index} value={item.value}>{item.label}</${Item}>)}
      </${Content}>
    </${Select}>
  </div>;
}`);
  return jsx(Component, {
    name: props.name,
    placeholder: props.placeholder ?? "Select...",
    items: options(props, "SelectItem", ctx),
    defaultValue: props.defaultValue,
    rules: validationRules(props, ctx),
  });
}

function choiceGroup(props: Props, ctx: ExportContext, kind: "checkbox" | "switch"): string {
  const Control = ctx.useImport(kind === "checkbox" ? "Checkbox" : "Switch", `@/components/ui/${kind}`);
  const Label = ctx.useImport("Label", "@/components/ui/label");
  const useState = ctx.useImport("useState", "react");
  const useId = ctx.useImport("useId", "react");
  const isSwitch = kind === "switch";
  const helperName = isSwitch ? "ExportedSwitchGroup" : "ExportedCheckBoxGroup";
  const control = `<${Control} id={id + "-" + index} checked={value.includes(item.value)}
    onCheckedChange={(checked) => setValue((current) => checked ? [...current.filter((entry) => entry !== item.value), item.value] : current.filter((entry) => entry !== item.value))} />`;
  const label = `<${Label} htmlFor={id + "-" + index}>{item.label}</${Label}>`;
  const Component = ctx.addHelper(helperName, `function ${helperName}({ name, items, defaultValue = [] }: {
  name: string; items: { value: string; label: string }[]; defaultValue?: string[];
}) {
  const [value, setValue] = ${useState}<string[]>(defaultValue);
  const id = ${useId}();
  return <div id={name} className="${isSwitch ? "space-y-3" : "space-y-2"}" role="group" aria-label={name}>
    <input type="hidden" name={name} value={JSON.stringify(value)} data-export-type="json" />
    {items.map((item, index) => <div key={index} className="${isSwitch ? "flex items-center justify-between" : "flex items-center space-x-2"}">
      ${isSwitch ? label + control : control + label}
    </div>)}
  </div>;
}`);
  return jsx(Component, {
    name: props.name,
    items: options(props, isSwitch ? "SwitchItem" : "CheckBoxItem", ctx),
    defaultValue: Array.isArray(props.defaultValue) ? props.defaultValue : undefined,
  });
}

function radioGroup(props: Props, ctx: ExportContext): string {
  const Group = ctx.useImport("RadioGroup", "@/components/ui/radio-group");
  const Item = ctx.useImport("RadioGroupItem", "@/components/ui/radio-group");
  const Label = ctx.useImport("Label", "@/components/ui/label");
  const useId = ctx.useImport("useId", "react");
  const Component = ctx.addHelper("ExportedRadioGroup", `function ExportedRadioGroup({ name, items, defaultValue = "" }: {
  name: string; items: { value: string; label: string }[]; defaultValue?: string;
}) {
  const id = ${useId}();
  return <${Group} name={name} id={name} defaultValue={defaultValue}>
    {items.map((item, index) => <div key={index} className="flex items-center space-x-2">
      <${Item} value={item.value} id={id + "-" + index} />
      <${Label} htmlFor={id + "-" + index}>{item.label}</${Label}>
    </div>)}
  </${Group}>;
}`);
  return jsx(Component, {
    name: props.name,
    items: options(props, "RadioItem", ctx),
    defaultValue: props.defaultValue,
  });
}

function slider(props: Props, ctx: ExportContext): string {
  const Slider = ctx.useImport("Slider", "@/components/ui/slider");
  const useState = ctx.useImport("useState", "react");
  const Component = ctx.addHelper("ExportedSlider", `function ExportedSlider({ name, min = 0, max = 100, step = 1, defaultValue = min }: {
  name: string; min?: number; max?: number; step?: number; defaultValue?: number;
}) {
  const [value, setValue] = ${useState}(defaultValue);
  return <div className="space-y-2">
    <div className="flex justify-between text-sm"><span>{name}</span><span className="text-muted-foreground">{value}</span></div>
    <input type="hidden" name={name} value={value} data-export-type="number" />
    <${Slider} id={name} aria-label={name} min={min} max={max} step={step} value={[value]}
      onValueChange={([next]) => { if (next !== undefined) setValue(next); }} />
  </div>;
}`);
  return jsx(Component, {
    name: props.name,
    min: props.min ?? 0,
    max: props.max ?? 100,
    step: props.step ?? 1,
    defaultValue: props.defaultValue ?? props.min ?? 0,
  });
}

function datePicker(props: Props, ctx: ExportContext): string {
  const Button = ctx.useImport("Button", "@/components/ui/button");
  const Calendar = ctx.useImport("Calendar", "@/components/ui/calendar");
  const Popover = ctx.useImport("Popover", "@/components/ui/popover");
  const Trigger = ctx.useImport("PopoverTrigger", "@/components/ui/popover");
  const Content = ctx.useImport("PopoverContent", "@/components/ui/popover");
  const Icon = ctx.useImport("CalendarIcon", "lucide-react");
  const format = ctx.useImport("format", "date-fns");
  const useState = ctx.useImport("useState", "react");
  const Component = ctx.addHelper("ExportedDatePicker", `function ExportedDatePicker({ name, placeholder, defaultValue }: { name: string; placeholder: string; defaultValue?: string }) {
  const [date, setDate] = ${useState}<Date | undefined>(() => {
    const parsed = defaultValue ? new Date(defaultValue) : undefined;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  });
  return <div>
    <input type="hidden" name={name} value={date?.toISOString() ?? ""} />
    <${Popover}>
      <${Trigger} asChild>
        <${Button} id={name} type="button" variant="outline" className={"w-full justify-start text-left font-normal " + (!date ? "text-muted-foreground" : "")}>
          <${Icon} className="mr-2 h-4 w-4" />
          {date ? ${format}(date, "PPP") : placeholder}
        </${Button}>
      </${Trigger}>
      <${Content} className="w-auto p-0" align="start">
        <${Calendar} mode="single" selected={date} onSelect={(next) => { if (next) setDate(next); }} />
      </${Content}>
    </${Popover}>
  </div>;
}`);
  return jsx(Component, {
    name: props.name,
    placeholder: props.placeholder ?? "Pick a date",
    defaultValue: props.defaultValue,
  });
}

function button(props: Props, ctx: ExportContext): string {
  const Button = ctx.useImport("Button", "@/components/ui/button");
  const ComponentProps = ctx.useImport("ComponentProps", "react");
  const validate = validationHelper(ctx);
  const Component = ctx.addHelper("ExportedActionButton", `function ExportedActionButton({ validate = false, onClick, ...props }: ${ComponentProps}<typeof ${Button}> & { validate?: boolean }) {
  return <${Button} {...props} type="button" onClick={(event) => {
    const form = event.currentTarget.closest("form");
    if (validate && form) {
      for (const field of Array.from(form.elements)) {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) ${validate}(field);
      }
      if (!form.reportValidity()) return;
    }
    onClick?.(event);
  }} />;
}`);
  const action = record(props.action);
  return jsx(Component, {
    type: "button",
    variant: props.variant ?? "default",
    size: props.size ?? "default",
    validate: (props.variant ?? "default") === "default" &&
      (action?.type ?? "continue_conversation") === "continue_conversation",
    onClick: ctx.action(props.action, props.label),
  }, text(String(props.label ?? "")));
}

function chartConfig(labels: string[]) {
  // ChartContainer interpolates configuration keys into CSS. Never use DSL text as keys.
  return Object.fromEntries(labels.map((label, i) => [
    `series_${i}`,
    { label, color: chartColors[i % chartColors.length] },
  ]));
}

function chartTooltip(ctx: ExportContext, nameKey?: string): string {
  return jsx(ctx.useImport("ChartTooltip", "@/components/ui/chart"), {
    content: expr(jsx(ctx.useImport("ChartTooltipContent", "@/components/ui/chart"), { nameKey })),
  });
}

function chartContainer(ctx: ExportContext, labels: string[], children: string, round = false): string {
  return jsx(ctx.useImport("ChartContainer", "@/components/ui/chart"), {
    config: chartConfig(labels),
    className: round
      ? "min-h-[200px] w-full mx-auto aspect-square max-h-[250px]"
      : "min-h-[200px] w-full",
  }, children);
}

function chartData(props: Props, ctx: ExportContext): { labels: string[]; data: Props[] } {
  const labels = array(props.labels).map(String);
  const rows = array(props.series);
  if (rows.length && Array.isArray(rows[0])) {
    return {
      labels: labels.slice(1),
      data: rows.flatMap((row) => {
        if (!Array.isArray(row)) {
          ctx.warn("Chart: an invalid table row could not be exported.");
          return [];
        }
        return [{
          category: String(row[0] ?? ""),
          ...Object.fromEntries(labels.slice(1).map((_, i) => [`series_${i}`, Number(row[i + 1]) || 0])),
        }];
      }),
    };
  }
  const series = dataItems(props.series, "Series", ctx).flatMap((item) => {
    if (typeof item.category !== "string" || !Array.isArray(item.values)) {
      ctx.warn("Series: category and numeric values are required.");
      return [];
    }
    return [item];
  });
  return {
    labels: series.map((item) => item.category as string),
    data: labels.map((category, i) => ({
      category,
      ...Object.fromEntries(series.flatMap((item, j) =>
        i < item.values.length ? [[`series_${j}`, item.values[i]]] : [],
      )),
    })),
  };
}

function emptyChart(name: string, ctx: ExportContext): string {
  ctx.warn(`${name}: no chart data was available to export.`);
  return jsx("div", { role: "status", className: "min-h-[200px] flex items-center justify-center text-sm text-muted-foreground" }, text("No chart data"));
}

function cartesianChart(props: Props, ctx: ExportContext, kind: "Bar" | "Line" | "Area" | "Radar"): string {
  const { labels, data } = chartData(props, ctx);
  if (!data.length || !labels.length) return emptyChart(`${kind}Chart`, ctx);
  const Chart = ctx.useImport(`${kind}Chart`, "recharts");
  const Mark = ctx.useImport(kind, "recharts");
  const axes = kind === "Radar"
    ? [
      jsx(ctx.useImport("PolarGrid", "recharts")),
      jsx(ctx.useImport("PolarAngleAxis", "recharts"), { dataKey: "category" }),
    ]
    : [
      jsx(ctx.useImport("CartesianGrid", "recharts"), { vertical: false }),
      jsx(ctx.useImport("XAxis", "recharts"), { dataKey: "category", tickLine: false, axisLine: false }),
      jsx(ctx.useImport("YAxis", "recharts"), { tickLine: false, axisLine: false }),
    ];
  const marks = labels.map((_, i) => {
    const color = chartColors[i % chartColors.length];
    const attrs: Props = { dataKey: `series_${i}`, isAnimationActive: false };
    if (kind === "Bar") Object.assign(attrs, { fill: color, radius: 4, stackId: props.variant === "stacked" ? "stack" : undefined });
    if (kind === "Line") Object.assign(attrs, { type: "monotone", stroke: color, strokeWidth: 2, dot: false });
    if (kind === "Area") Object.assign(attrs, { type: "monotone", fill: color, stroke: color, fillOpacity: 0.2 });
    if (kind === "Radar") Object.assign(attrs, { fill: color, stroke: color, fillOpacity: 0.3 });
    return jsx(Mark, attrs);
  });
  return chartContainer(ctx, labels, jsx(Chart, { data }, [...axes, chartTooltip(ctx), ...marks]), kind === "Radar");
}

function sliceChart(props: Props, ctx: ExportContext, radial: boolean): string {
  const slices = dataItems(props.slices, "Slice", ctx);
  if (!slices.length) return emptyChart(radial ? "RadialChart" : "PieChart", ctx);
  const labels = slices.map((slice) => String(slice.category ?? ""));
  const data = slices.map((slice, i) => ({
    category: `series_${i}`,
    label: labels[i],
    value: slice.value,
    ...(radial ? { fill: chartColors[i % chartColors.length] } : {}),
  }));
  if (radial) {
    return chartContainer(ctx, labels, jsx(ctx.useImport("RadialBarChart", "recharts"), {
      data,
      innerRadius: 30,
      outerRadius: 110,
    }, [
      chartTooltip(ctx, "category"),
      jsx(ctx.useImport("RadialBar", "recharts"), { dataKey: "value", isAnimationActive: false }),
    ]), true);
  }
  return chartContainer(ctx, labels, jsx(ctx.useImport("PieChart", "recharts"), undefined, [
    chartTooltip(ctx, "category"),
    jsx(ctx.useImport("Pie", "recharts"), {
      data,
      dataKey: "value",
      nameKey: "label",
      innerRadius: props.donut ? "50%" : 0,
      isAnimationActive: false,
    }, slices.map((_, i) => jsx(ctx.useImport("Cell", "recharts"), { fill: chartColors[i % chartColors.length] }))),
  ]), true);
}

function scatterChart(props: Props, ctx: ExportContext): string {
  const series = dataItems(props.series, "ScatterSeries", ctx);
  const labels = series.map((item) => String(item.category ?? ""));
  const marks = series.map((item, i) => jsx(ctx.useImport("Scatter", "recharts"), {
    name: labels[i],
    data: dataItems(item.points, "Point", ctx).map((point) => ({
      x: Number(point.x ?? 0),
      y: Number(point.y ?? 0),
      ...(point.label == null ? {} : { label: String(point.label) }),
    })),
    fill: chartColors[i % chartColors.length],
    isAnimationActive: false,
  }));
  return chartContainer(ctx, labels, jsx(ctx.useImport("ScatterChart", "recharts"), undefined, [
    jsx(ctx.useImport("CartesianGrid", "recharts")),
    jsx(ctx.useImport("XAxis", "recharts"), { type: "number", dataKey: "x", name: props.xLabel ?? "x" }),
    jsx(ctx.useImport("YAxis", "recharts"), { type: "number", dataKey: "y", name: props.yLabel ?? "y" }),
    chartTooltip(ctx),
    ...marks,
  ]));
}

const orphanDataHandlers = Object.fromEntries([
  "SelectItem", "CheckBoxItem", "RadioItem", "SwitchItem", "FollowUpItem",
  "Series", "Slice", "ScatterSeries", "Point",
].map((name) => [name, (_props: Props, ctx: ExportContext) => {
  ctx.warn(`${name} is a data item and must be nested in its corresponding parent component.`);
  return jsx("div", { role: "note", className: "text-sm text-muted-foreground" }, text(`Unsupported standalone data item: ${name}`));
}]));

export const formsChartHandlers: Record<string, Handler> = {
  Form: (props, ctx) => jsx("form", {
    name: props.name,
    className: "space-y-4",
    onSubmit: expr("(event) => event.preventDefault()"),
  }, [ctx.render(props.fields), ctx.render(props.buttons)]),
  FormControl: formControl,
  Label: (props, ctx) => jsx(ctx.useImport("Label", "@/components/ui/label"), { htmlFor: props.htmlFor }, text(props.text)),
  Input: (props, ctx) => jsx(ctx.useImport("Input", "@/components/ui/input"), fieldAttributes(props, ctx)),
  TextArea: (props, ctx) => jsx(ctx.useImport("Textarea", "@/components/ui/textarea"), fieldAttributes(props, ctx, true)),
  Select: select,
  DatePicker: datePicker,
  Slider: slider,
  CheckBoxGroup: (props, ctx) => choiceGroup(props, ctx, "checkbox"),
  RadioGroup: radioGroup,
  SwitchGroup: (props, ctx) => choiceGroup(props, ctx, "switch"),
  Button: button,
  Buttons: (props, ctx) => jsx("div", {
    className: `flex gap-2 ${props.direction === "column" ? "flex-col" : "flex-row flex-wrap"}`,
  }, ctx.render(props.buttons)),
  FollowUpBlock: (props, ctx) => jsx("div", { className: "flex flex-wrap gap-2" },
    dataItems(props.items, "FollowUpItem", ctx).map((item) => {
      const label = String(item.text ?? "");
      return jsx(ctx.useImport("Button", "@/components/ui/button"), {
        type: "button",
        variant: "outline",
        size: "sm",
        className: "h-auto py-1.5 px-3 text-xs",
        onClick: ctx.action({ type: "continue_conversation" }, label),
      }, text(label));
    })),
  BarChart: (props, ctx) => cartesianChart(props, ctx, "Bar"),
  LineChart: (props, ctx) => cartesianChart(props, ctx, "Line"),
  AreaChart: (props, ctx) => cartesianChart(props, ctx, "Area"),
  RadarChart: (props, ctx) => cartesianChart(props, ctx, "Radar"),
  PieChart: (props, ctx) => sliceChart(props, ctx, false),
  RadialChart: (props, ctx) => sliceChart(props, ctx, true),
  ScatterChart: scatterChart,
  ...orphanDataHandlers,
};
