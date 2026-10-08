import { expr, jsx, literal, text, type ExportContext, type Handler, type Props } from "./context";

const textSizes: Record<string, string> = {
  small: "text-sm text-muted-foreground",
  default: "text-base",
  large: "text-lg",
  "small-heavy": "text-sm font-semibold",
  "large-heavy": "text-lg font-semibold",
};

const headingClasses: Record<string, string> = {
  h1: "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl",
  h2: "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0",
  h3: "scroll-m-20 text-2xl font-semibold tracking-tight",
  h4: "scroll-m-20 text-xl font-semibold tracking-tight",
};

const alertClasses: Record<string, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400",
  success:
    "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200 [&>svg]:text-green-600 dark:[&>svg]:text-green-400",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400",
};

const buttonVariants = ["default", "destructive", "outline", "secondary", "ghost", "link"];
const badgeVariants = ["default", "secondary", "destructive", "outline", "ghost", "link"];

function stringValue(value: unknown, ctx: ExportContext, location: string): string {
  if (value == null) return "";
  if (typeof value === "object") {
    ctx.warn(`${location}: structured data is displayed as text, matching the original renderer.`);
  }
  return String(value);
}

function choice(
  value: unknown,
  allowed: readonly string[],
  fallback: string,
  location: string,
  ctx: ExportContext,
): string {
  if (value == null) return fallback;
  if (typeof value === "string" && allowed.includes(value)) return value;
  ctx.warn(`${location}: unsupported value ${literal(value)}; using ${literal(fallback)}.`);
  return fallback;
}

function array(value: unknown, location: string, ctx: ExportContext): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  ctx.warn(`${location}: expected an array; exporting the supplied value as one item.`);
  return [value];
}

function dataProps(value: unknown, name: string): Props | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const node = value as Props;
  if (
    node.type !== "element" ||
    node.typeName !== name ||
    typeof node.props !== "object" ||
    node.props === null ||
    Array.isArray(node.props)
  ) {
    return undefined;
  }
  return node.props;
}

function unexpected(value: unknown, location: string, expected: string, ctx: ExportContext): string {
  ctx.warn(`${location}: expected ${expected}; exporting the unexpected value separately.`);
  return ctx.render(value);
}

function siblings(parts: string[]): string {
  const children = parts.filter(Boolean);
  if (!children.length) return "<></>";
  return children.length === 1 ? children[0] : `<>\n${children.join("\n")}\n</>`;
}

function dataOnly(name: string): Handler {
  return (props, ctx) => {
    ctx.warn(`${name} is a data definition outside its parent component; displaying its properties.`);
    return jsx("pre", { className: "overflow-x-auto rounded-md border p-3 text-sm" }, text(literal(props)));
  };
}

const image: Handler = (props, ctx) =>
  jsx(
    "div",
    { className: "overflow-hidden rounded-lg" },
    jsx("img", {
      src: stringValue(props.src, ctx, "Image.src"),
      alt: stringValue(props.alt, ctx, "Image.alt"),
      className: "w-full h-auto object-cover rounded-lg",
    }),
  );

function badge(props: Props, ctx: ExportContext, name: "Badge" | "Tag"): string {
  const Badge = ctx.useImport("Badge", "@/components/ui/badge");
  return jsx(
    Badge,
    {
      variant: choice(
        props.variant,
        name === "Tag" ? badgeVariants.filter((variant) => variant !== "link") : badgeVariants,
        name === "Tag" ? "secondary" : "default",
        `${name}.variant`,
        ctx,
      ),
    },
    text(stringValue(props.text, ctx, `${name}.text`)),
  );
}

const table: Handler = (props, ctx) => {
  const Table = ctx.useImport("Table", "@/components/ui/table");
  const TableHeader = ctx.useImport("TableHeader", "@/components/ui/table");
  const TableHead = ctx.useImport("TableHead", "@/components/ui/table");
  const TableBody = ctx.useImport("TableBody", "@/components/ui/table");
  const TableRow = ctx.useImport("TableRow", "@/components/ui/table");
  const TableCell = ctx.useImport("TableCell", "@/components/ui/table");
  const extra: string[] = [];
  const columns = array(props.columns, "Table.columns", ctx).map((value, index) => {
    const col = dataProps(value, "Col");
    if (!col) {
      extra.push(unexpected(value, `Table.columns[${index}]`, "Col", ctx));
      return { header: "", type: "string" };
    }
    return {
      header: stringValue(col.header, ctx, `Table.columns[${index}].header`),
      type: choice(col.type, ["string", "number", "boolean"], "string", `Table.columns[${index}].type`, ctx),
    };
  });
  const rows = array(props.rows, "Table.rows", ctx).map((value, rowIndex) => {
    const row = array(value, `Table.rows[${rowIndex}]`, ctx);
    if (row.length > columns.length) {
      ctx.warn(`Table.rows[${rowIndex}]: cells beyond the defined columns are retained as extra cells.`);
    }
    return jsx(
      TableRow,
      { key: rowIndex },
      Array.from({ length: Math.max(columns.length, row.length) }, (_, colIndex) =>
        jsx(
          TableCell,
          {
            key: colIndex,
            className: columns[colIndex]?.type === "number" ? "text-right tabular-nums" : "",
          },
          text(stringValue(row[colIndex], ctx, `Table.rows[${rowIndex}][${colIndex}]`)),
        ),
      ),
    );
  });
  return siblings([
    jsx(
      "div",
      { className: "rounded-md border" },
      jsx(Table, {}, [
        jsx(
          TableHeader,
          {},
          jsx(
            TableRow,
            {},
            columns.map((col, index) =>
              jsx(
                TableHead,
                { key: index, className: col.type === "number" ? "text-right" : "" },
                text(col.header),
              ),
            ),
          ),
        ),
        jsx(TableBody, {}, rows),
      ]),
    ),
    ...extra,
  ]);
};

const tabs: Handler = (props, ctx) => {
  const extra: string[] = [];
  const items: Props[] = [];
  for (const [index, value] of array(props.items, "Tabs.items", ctx).entries()) {
    const item = dataProps(value, "TabItem");
    if (!item || item.value == null || item.trigger == null) {
      extra.push(unexpected(value, `Tabs.items[${index}]`, "TabItem with value and trigger", ctx));
    } else {
      items.push(item);
    }
  }
  if (!items.length) return siblings(extra);
  const Tabs = ctx.useImport("Tabs", "@/components/ui/tabs");
  const TabsList = ctx.useImport("TabsList", "@/components/ui/tabs");
  const TabsTrigger = ctx.useImport("TabsTrigger", "@/components/ui/tabs");
  const TabsContent = ctx.useImport("TabsContent", "@/components/ui/tabs");
  const seen = new Set<string>();
  const values = items.map((item, index) => {
    const value = stringValue(item.value, ctx, `Tabs.items[${index}].value`);
    if (seen.has(value)) ctx.warn(`Tabs: duplicate value ${literal(value)} shares the same active panel.`);
    seen.add(value);
    return value;
  });
  const defaultValue = stringValue(props.defaultValue ?? values[0], ctx, "Tabs.defaultValue");
  if (!seen.has(defaultValue)) {
    ctx.warn(`Tabs.defaultValue ${literal(defaultValue)} does not match a panel; initially no panel is shown.`);
  }
  return siblings([
    jsx(Tabs, { defaultValue }, [
      jsx(
        TabsList,
        {},
        items.map((item, index) =>
          jsx(
            TabsTrigger,
            { key: index, value: values[index] },
            text(stringValue(item.trigger, ctx, `Tabs.items[${index}].trigger`)),
          ),
        ),
      ),
      ...items.map((item, index) =>
        jsx(
          TabsContent,
          { key: index, value: values[index], className: "space-y-3" },
          ctx.render(item.content),
        ),
      ),
    ]),
    ...extra,
  ]);
};

const accordion: Handler = (props, ctx) => {
  const Accordion = ctx.useImport("Accordion", "@/components/ui/accordion");
  const AccordionItem = ctx.useImport("AccordionItem", "@/components/ui/accordion");
  const AccordionTrigger = ctx.useImport("AccordionTrigger", "@/components/ui/accordion");
  const AccordionContent = ctx.useImport("AccordionContent", "@/components/ui/accordion");
  const type = choice(props.type, ["single", "multiple"], "multiple", "Accordion.type", ctx);
  const extra: string[] = [];
  const seen = new Set<string>();
  const items = array(props.items, "Accordion.items", ctx).map((value, index) => {
    const item = dataProps(value, "AccordionItem");
    if (!item) {
      extra.push(unexpected(value, `Accordion.items[${index}]`, "AccordionItem", ctx));
      return "";
    }
    const itemValue = stringValue(item.value ?? index, ctx, `Accordion.items[${index}].value`);
    if (seen.has(itemValue)) {
      ctx.warn(`Accordion: duplicate value ${literal(itemValue)} shares the same expansion state.`);
    }
    seen.add(itemValue);
    return jsx(AccordionItem, { key: index, value: itemValue }, [
      jsx(
        AccordionTrigger,
        {},
        text(stringValue(item.trigger, ctx, `Accordion.items[${index}].trigger`)),
      ),
      jsx(AccordionContent, {}, ctx.render(item.content)),
    ]);
  });
  return siblings([
    jsx(Accordion, { type, ...(type === "single" ? { collapsible: true } : {}) }, items),
    ...extra,
  ]);
};

const carousel: Handler = (props, ctx) => {
  const Carousel = ctx.useImport("Carousel", "@/components/ui/carousel");
  const CarouselContent = ctx.useImport("CarouselContent", "@/components/ui/carousel");
  const CarouselItem = ctx.useImport("CarouselItem", "@/components/ui/carousel");
  const CarouselPrevious = ctx.useImport("CarouselPrevious", "@/components/ui/carousel");
  const CarouselNext = ctx.useImport("CarouselNext", "@/components/ui/carousel");
  const variant = choice(props.variant, ["default", "card"], "default", "Carousel.variant", ctx);
  const Card = variant === "card" ? ctx.useImport("Card", "@/components/ui/card") : "";
  const CardContent = variant === "card" ? ctx.useImport("CardContent", "@/components/ui/card") : "";
  return jsx(Carousel, { className: "w-full" }, [
    jsx(
      CarouselContent,
      {},
      array(props.slides, "Carousel.slides", ctx).map((slide, index) =>
        jsx(
          CarouselItem,
          { key: index },
          variant === "card"
            ? jsx(Card, {}, jsx(CardContent, { className: "p-4 space-y-3" }, ctx.render(slide)))
            : jsx("div", { className: "space-y-3" }, ctx.render(slide)),
        ),
      ),
    ),
    jsx(CarouselPrevious),
    jsx(CarouselNext),
  ]);
};

const dialog: Handler = (props, ctx) => {
  const Dialog = ctx.useImport("Dialog", "@/components/ui/dialog");
  const DialogTrigger = ctx.useImport("DialogTrigger", "@/components/ui/dialog");
  const DialogContent = ctx.useImport("DialogContent", "@/components/ui/dialog");
  const DialogHeader = ctx.useImport("DialogHeader", "@/components/ui/dialog");
  const DialogTitle = ctx.useImport("DialogTitle", "@/components/ui/dialog");
  const DialogDescription = ctx.useImport("DialogDescription", "@/components/ui/dialog");
  const Button = ctx.useImport("Button", "@/components/ui/button");
  return jsx(Dialog, {}, [
    jsx(
      DialogTrigger,
      { asChild: true },
      jsx(
        Button,
        { variant: choice(props.triggerVariant, buttonVariants, "outline", "DialogBlock.triggerVariant", ctx) },
        text(stringValue(props.triggerLabel, ctx, "DialogBlock.triggerLabel")),
      ),
    ),
    jsx(DialogContent, {}, [
      jsx(DialogHeader, {}, [
        jsx(DialogTitle, {}, text(stringValue(props.title, ctx, "DialogBlock.title"))),
        props.description
          ? jsx(DialogDescription, {}, text(stringValue(props.description, ctx, "DialogBlock.description")))
          : "",
      ]),
      jsx("div", { className: "space-y-3" }, ctx.render(props.content)),
    ]),
  ]);
};

const alertDialog: Handler = (props, ctx) => {
  const AlertDialog = ctx.useImport("AlertDialog", "@/components/ui/alert-dialog");
  const AlertDialogTrigger = ctx.useImport("AlertDialogTrigger", "@/components/ui/alert-dialog");
  const AlertDialogContent = ctx.useImport("AlertDialogContent", "@/components/ui/alert-dialog");
  const AlertDialogHeader = ctx.useImport("AlertDialogHeader", "@/components/ui/alert-dialog");
  const AlertDialogTitle = ctx.useImport("AlertDialogTitle", "@/components/ui/alert-dialog");
  const AlertDialogDescription = ctx.useImport("AlertDialogDescription", "@/components/ui/alert-dialog");
  const AlertDialogFooter = ctx.useImport("AlertDialogFooter", "@/components/ui/alert-dialog");
  const AlertDialogCancel = ctx.useImport("AlertDialogCancel", "@/components/ui/alert-dialog");
  const AlertDialogAction = ctx.useImport("AlertDialogAction", "@/components/ui/alert-dialog");
  const Button = ctx.useImport("Button", "@/components/ui/button");
  const confirmLabel = stringValue(props.confirmLabel ?? "Continue", ctx, "AlertDialogBlock.confirmLabel");
  return jsx(AlertDialog, {}, [
    jsx(
      AlertDialogTrigger,
      { asChild: true },
      jsx(
        Button,
        { variant: choice(props.triggerVariant, buttonVariants, "outline", "AlertDialogBlock.triggerVariant", ctx) },
        text(stringValue(props.triggerLabel, ctx, "AlertDialogBlock.triggerLabel")),
      ),
    ),
    jsx(AlertDialogContent, {}, [
      jsx(AlertDialogHeader, {}, [
        jsx(AlertDialogTitle, {}, text(stringValue(props.title, ctx, "AlertDialogBlock.title"))),
        jsx(
          AlertDialogDescription,
          {},
          text(stringValue(props.description, ctx, "AlertDialogBlock.description")),
        ),
      ]),
      jsx(AlertDialogFooter, {}, [
        jsx(
          AlertDialogCancel,
          {},
          text(stringValue(props.cancelLabel ?? "Cancel", ctx, "AlertDialogBlock.cancelLabel")),
        ),
        jsx(
          AlertDialogAction,
          { onClick: ctx.action({ type: "continue_conversation" }, confirmLabel) },
          text(confirmLabel),
        ),
      ]),
    ]),
  ]);
};

const drawer: Handler = (props, ctx) => {
  const Drawer = ctx.useImport("Drawer", "@/components/ui/drawer");
  const DrawerTrigger = ctx.useImport("DrawerTrigger", "@/components/ui/drawer");
  const DrawerContent = ctx.useImport("DrawerContent", "@/components/ui/drawer");
  const DrawerHeader = ctx.useImport("DrawerHeader", "@/components/ui/drawer");
  const DrawerTitle = ctx.useImport("DrawerTitle", "@/components/ui/drawer");
  const DrawerDescription = ctx.useImport("DrawerDescription", "@/components/ui/drawer");
  const DrawerFooter = ctx.useImport("DrawerFooter", "@/components/ui/drawer");
  const DrawerClose = ctx.useImport("DrawerClose", "@/components/ui/drawer");
  const Button = ctx.useImport("Button", "@/components/ui/button");
  return jsx(Drawer, {}, [
    jsx(
      DrawerTrigger,
      { asChild: true },
      jsx(Button, { variant: "outline" }, text(stringValue(props.triggerLabel, ctx, "DrawerBlock.triggerLabel"))),
    ),
    jsx(DrawerContent, {}, [
      jsx(DrawerHeader, {}, [
        jsx(DrawerTitle, {}, text(stringValue(props.title, ctx, "DrawerBlock.title"))),
        props.description
          ? jsx(DrawerDescription, {}, text(stringValue(props.description, ctx, "DrawerBlock.description")))
          : "",
      ]),
      jsx("div", { className: "px-4 pb-4 space-y-3" }, ctx.render(props.content)),
      jsx(DrawerFooter, {}, jsx(DrawerClose, { asChild: true }, jsx(Button, { variant: "outline" }, text("Close")))),
    ]),
  ]);
};

function integer(value: unknown, fallback: number, minimum: number, location: string, ctx: ExportContext): number {
  if (value == null) return fallback;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum) return value;
  ctx.warn(`${location}: expected an integer of at least ${minimum}; using ${fallback}.`);
  return fallback;
}

const pagination: Handler = (props, ctx) => {
  const useState = ctx.useImport("useState", "react");
  const Pagination = ctx.useImport("Pagination", "@/components/ui/pagination");
  const PaginationContent = ctx.useImport("PaginationContent", "@/components/ui/pagination");
  const PaginationItem = ctx.useImport("PaginationItem", "@/components/ui/pagination");
  const PaginationPrevious = ctx.useImport("PaginationPrevious", "@/components/ui/pagination");
  const PaginationNext = ctx.useImport("PaginationNext", "@/components/ui/pagination");
  const PaginationLink = ctx.useImport("PaginationLink", "@/components/ui/pagination");
  const PaginationEllipsis = ctx.useImport("PaginationEllipsis", "@/components/ui/pagination");
  const totalPages = integer(props.totalPages, 1, 0, "PaginationBlock.totalPages", ctx);
  const suppliedPage = integer(props.currentPage, 1, 1, "PaginationBlock.currentPage", ctx);
  const currentPage = Math.min(suppliedPage, Math.max(1, totalPages));
  if (currentPage !== suppliedPage) {
    ctx.warn("PaginationBlock.currentPage is outside the available pages; using the last page.");
  }
  const Helper = ctx.addHelper(
    "ExportedPagination",
    `function ExportedPagination({ currentPage, totalPages, onAction }: {
  currentPage: number;
  totalPages: number;
  onAction?: GeneratedActionHandler;
}) {
  const [current, setCurrent] = ${useState}(currentPage);
  const pages: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let page = 1; page <= totalPages; page++) pages.push(page);
  } else {
    pages.push(1);
    if (current > 3) pages.push("ellipsis");
    for (let page = Math.max(2, current - 1); page <= Math.min(totalPages - 1, current + 1); page++) {
      pages.push(page);
    }
    if (current < totalPages - 2) pages.push("ellipsis");
    pages.push(totalPages);
  }
  const navigate = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrent(page);
    onAction?.({ type: "continue_conversation", label: "Go to page " + page });
  };
  return (
    <${Pagination}>
      <${PaginationContent}>
        <${PaginationItem}>
          <${PaginationPrevious} href="#" onClick={(event) => {
            event.preventDefault();
            if (current > 1) navigate(current - 1);
          }} />
        </${PaginationItem}>
        {pages.map((page, index) => page === "ellipsis" ? (
          <${PaginationItem} key={"e-" + index}><${PaginationEllipsis} /></${PaginationItem}>
        ) : (
          <${PaginationItem} key={page}>
            <${PaginationLink} href="#" isActive={page === current} onClick={(event) => {
              event.preventDefault();
              navigate(page);
            }}>{page}</${PaginationLink}>
          </${PaginationItem}>
        ))}
        <${PaginationItem}>
          <${PaginationNext} href="#" onClick={(event) => {
            event.preventDefault();
            if (current < totalPages) navigate(current + 1);
          }} />
        </${PaginationItem}>
      </${PaginationContent}>
    </${Pagination}>
  );
}`,
  );
  ctx.warn("PaginationBlock changes the selected page locally; connect onAction to load the corresponding page data.");
  return jsx(Helper, { currentPage, totalPages, onAction: expr("onAction") });
};

const calendar: Handler = (props, ctx) => {
  const useState = ctx.useImport("useState", "react");
  const Calendar = ctx.useImport("Calendar", "@/components/ui/calendar");
  const mode = choice(props.mode, ["single", "multiple", "range"], "single", "CalendarBlock.mode", ctx);
  const captionLayout = choice(props.captionLayout, ["label", "dropdown"], "dropdown", "CalendarBlock.captionLayout", ctx);
  const numberOfMonths = integer(props.numberOfMonths, 1, 1, "CalendarBlock.numberOfMonths", ctx);
  let defaultMonth = props.defaultMonth ? stringValue(props.defaultMonth, ctx, "CalendarBlock.defaultMonth") : undefined;
  if (defaultMonth && !Number.isFinite(new Date(defaultMonth).getTime())) {
    ctx.warn("CalendarBlock.defaultMonth is not a valid date; the calendar will open on the current month.");
    defaultMonth = undefined;
  }
  const Helper = ctx.addHelper(
    "ExportedCalendar",
    `function ExportedCalendar({ mode, defaultMonth, numberOfMonths, captionLayout }: {
  mode: "single" | "multiple" | "range";
  defaultMonth?: string;
  numberOfMonths: number;
  captionLayout: "label" | "dropdown";
}) {
  const [selected, setSelected] = ${useState}<Date | undefined>();
  const [multiSelected, setMultiSelected] = ${useState}<Date[]>([]);
  const [range, setRange] = ${useState}<{ from: Date | undefined; to?: Date } | undefined>();
  const common = {
    numberOfMonths,
    defaultMonth: defaultMonth ? new Date(defaultMonth) : undefined,
    captionLayout,
    className: "rounded-lg border",
  };
  if (mode === "range") {
    return <${Calendar} mode="range" selected={range} onSelect={setRange} {...common} />;
  }
  if (mode === "multiple") {
    return <${Calendar} mode="multiple" selected={multiSelected} onSelect={(dates) => setMultiSelected(dates ?? [])} {...common} />;
  }
  return <${Calendar} mode="single" selected={selected} onSelect={setSelected} {...common} />;
}`,
  );
  return jsx(Helper, { mode, defaultMonth, numberOfMonths, captionLayout });
};

export const contentHandlers: Record<string, Handler> = {
  Card: (props, ctx) => {
    const Card = ctx.useImport("Card", "@/components/ui/card");
    const CardContent = ctx.useImport("CardContent", "@/components/ui/card");
    return jsx(Card, {}, jsx(CardContent, { className: "p-0 space-y-3" }, ctx.render(props.children)));
  },
  CardHeader: (props, ctx) => {
    const CardHeader = ctx.useImport("CardHeader", "@/components/ui/card");
    const CardTitle = ctx.useImport("CardTitle", "@/components/ui/card");
    const CardDescription = ctx.useImport("CardDescription", "@/components/ui/card");
    return jsx(CardHeader, { className: "p-0" }, [
      jsx(CardTitle, {}, text(stringValue(props.title, ctx, "CardHeader.title"))),
      props.description
        ? jsx(CardDescription, {}, text(stringValue(props.description, ctx, "CardHeader.description")))
        : "",
    ]);
  },
  TextContent: (props, ctx) => {
    const size = choice(props.size, Object.keys(textSizes), "default", "TextContent.size", ctx);
    return jsx("p", { className: textSizes[size] }, text(stringValue(props.text, ctx, "TextContent.text")));
  },
  MarkDownRenderer: (props, ctx) => {
    const ReactMarkdown = ctx.useDefaultImport("ReactMarkdown", "react-markdown");
    const remarkGfm = ctx.useDefaultImport("remarkGfm", "remark-gfm");
    return jsx(
      "div",
      { className: "prose prose-neutral dark:prose-invert max-w-none text-sm" },
      jsx(
        ReactMarkdown,
        { remarkPlugins: expr(`[${remarkGfm}]`) },
        text(stringValue(props.text, ctx, "MarkDownRenderer.text")),
      ),
    );
  },
  Heading: (props, ctx) => {
    const level = choice(props.level, Object.keys(headingClasses), "h2", "Heading.level", ctx);
    return jsx(level, { className: headingClasses[level] }, text(stringValue(props.text, ctx, "Heading.text")));
  },
  Blockquote: (props, ctx) =>
    jsx("figure", {}, [
      jsx(
        "blockquote",
        { className: "mt-6 border-l-2 pl-6 italic text-muted-foreground" },
        text(stringValue(props.text, ctx, "Blockquote.text")),
      ),
      props.cite
        ? jsx(
            "figcaption",
            { className: "mt-1 pl-6 text-sm text-muted-foreground" },
            text(`— ${stringValue(props.cite, ctx, "Blockquote.cite")}`),
          )
        : "",
    ]),
  InlineCode: (props, ctx) =>
    jsx(
      "code",
      { className: "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold" },
      text(stringValue(props.code, ctx, "InlineCode.code")),
    ),
  Alert: (props, ctx) => {
    const Alert = ctx.useImport("Alert", "@/components/ui/alert");
    const AlertTitle = ctx.useImport("AlertTitle", "@/components/ui/alert");
    const AlertDescription = ctx.useImport("AlertDescription", "@/components/ui/alert");
    const variant = choice(props.variant, ["default", "destructive", "info", "success", "warning"], "default", "Alert.variant", ctx);
    const icons: Record<string, string> = {
      destructive: "AlertCircle", info: "Info", success: "CheckCircle2", warning: "TriangleAlert",
    };
    const Icon = icons[variant] ? ctx.useImport(icons[variant], "lucide-react") : undefined;
    return jsx(
      Alert,
      { variant: variant === "destructive" ? "destructive" : "default", className: alertClasses[variant] ?? "" },
      [
        Icon ? jsx(Icon, { className: "size-4" }) : "",
        jsx(AlertTitle, {}, text(stringValue(props.title, ctx, "Alert.title"))),
        jsx(AlertDescription, {}, text(stringValue(props.description, ctx, "Alert.description"))),
      ],
    );
  },
  Badge: (props, ctx) => badge(props, ctx, "Badge"),
  Avatar: (props, ctx) => {
    const Avatar = ctx.useImport("Avatar", "@/components/ui/avatar");
    const AvatarImage = ctx.useImport("AvatarImage", "@/components/ui/avatar");
    const AvatarFallback = ctx.useImport("AvatarFallback", "@/components/ui/avatar");
    return jsx(Avatar, {}, [
      props.src
        ? jsx(AvatarImage, {
            src: stringValue(props.src, ctx, "Avatar.src"),
            alt: stringValue(props.alt, ctx, "Avatar.alt"),
          })
        : "",
      jsx(AvatarFallback, {}, text(stringValue(props.fallback, ctx, "Avatar.fallback"))),
    ]);
  },
  CodeBlock: (props, ctx) =>
    jsx("div", { className: "rounded-lg border bg-muted" }, [
      props.title
        ? jsx("div", { className: "border-b px-4 py-2 text-xs font-medium text-muted-foreground" }, [
            text(stringValue(props.title, ctx, "CodeBlock.title")),
            props.language
              ? jsx(
                  "span",
                  { className: "ml-2 text-xs opacity-60" },
                  text(stringValue(props.language, ctx, "CodeBlock.language")),
                )
              : "",
          ])
        : "",
      jsx(
        "pre",
        { className: "overflow-x-auto p-4" },
        jsx("code", { className: "text-sm font-mono" }, text(stringValue(props.code, ctx, "CodeBlock.code"))),
      ),
    ]),
  Image: image,
  ImageBlock: (props, ctx) =>
    jsx("figure", { className: "space-y-2" }, [
      image(props, ctx),
      props.caption
        ? jsx(
            "figcaption",
            { className: "text-sm text-muted-foreground text-center" },
            text(stringValue(props.caption, ctx, "ImageBlock.caption")),
          )
        : "",
    ]),
  Progress: (props, ctx) => {
    const Progress = ctx.useImport("Progress", "@/components/ui/progress");
    let value = props.value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      ctx.warn("Progress.value is not a finite number; using 0.");
      value = 0;
    }
    return jsx("div", { className: "space-y-1" }, [
      props.label
        ? jsx("div", { className: "flex justify-between text-sm" }, [
            jsx("span", {}, text(stringValue(props.label, ctx, "Progress.label"))),
            jsx("span", { className: "text-muted-foreground" }, `${text(value)}${text("%")}`),
          ])
        : "",
      jsx(Progress, { value }),
    ]);
  },
  Separator: (props, ctx) =>
    jsx(ctx.useImport("Separator", "@/components/ui/separator"), {
      orientation: choice(props.orientation, ["horizontal", "vertical"], "horizontal", "Separator.orientation", ctx),
    }),
  Table: table,
  Col: dataOnly("Col"),
  Tabs: tabs,
  TabItem: dataOnly("TabItem"),
  Accordion: accordion,
  AccordionItem: dataOnly("AccordionItem"),
  Carousel: carousel,
  Tag: (props, ctx) => badge(props, ctx, "Tag"),
  TagBlock: (props, ctx) => {
    const Badge = ctx.useImport("Badge", "@/components/ui/badge");
    return jsx(
      "div",
      { className: "flex flex-wrap gap-1.5" },
      array(props.tags, "TagBlock.tags", ctx).map((value, index) => {
        if (typeof value === "string") {
          return jsx(Badge, { key: index, variant: "secondary" }, text(value));
        }
        const tag = dataProps(value, "Tag");
        return tag
          ? badge(tag, ctx, "Tag")
          : unexpected(value, `TagBlock.tags[${index}]`, "a string or Tag", ctx);
      }),
    );
  },
  DialogBlock: dialog,
  AlertDialogBlock: alertDialog,
  DrawerBlock: drawer,
  PaginationBlock: pagination,
  CalendarBlock: calendar,
};
