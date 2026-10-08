# Shadcn Chat Example

A full-stack generative UI chatbot that demonstrates wiring [OpenUI Lang](https://www.openui.com/docs/openui-lang/overview) to a custom component library built on [shadcn/ui](https://ui.shadcn.com/). Instead of replying with plain text or markdown, the LLM generates structured UI markup that the client renders as shadcn/ui components — cards, tables, charts, forms, dialogs, and more — in real time as tokens stream in.

Features: 45+ custom shadcn/ui components, multi-step tool calling, Server-Sent Events (SSE) streaming, automatic light/dark theme support, and on-demand exports of the original DSL and standalone React TSX.

<video src="../../../docs/public/videos/shadcn-demo-chat.mp4"
    noControls
    playsInline
    muted
    preload="metadata"
    className="w-full rounded-lg m-auto"
    autoPlay
    loop
/>

[View source on GitHub →](https://github.com/thesysdev/openui/tree/main/examples/design-systems/shadcn)

---

## How It Works

The integration starts with real shadcn/ui components imported from `src/components/ui/`. Each adapter in `src/lib/shadcn-genui/` manually defines an OpenUI component name, a Zod prop schema, a description, and a React render function using `defineComponent()`. OpenUI does not infer an exportable schema or source code from arbitrary React imports.

`createLibrary()` combines these definitions into `shadcnChatLibrary`. The CLI writes their signatures and JSON schema to `src/generated/spec.json`, and the server uses that spec to prompt the LLM. The model returns **OpenUI Lang**, using positional arguments in schema order:

```openui-lang
root = Card([header, table])
header = CardHeader("Q1 Sales Report", "Revenue by product")
table = Table([Col("Product", "string"), Col("Revenue", "number")], [["Widget", 12000], ["Gadget", 8400]])
```

On the client, the `<AgentInterface />` component from `@openuidev/react-ui` handles everything — thread history, conversation state, streaming, input, and rendering. You give it an `llm` describing how to call your backend and parse its stream, and a `componentLibrary`. Threads stay in memory (no Cloud storage). It parses Chat Completions SSE with `openAIAdapter()` and renders each OpenUI Lang node using `shadcnChatLibrary` — the custom 45-component library defined in `src/lib/shadcn-genui/`.

Export takes a separate path after a response completes: the wrapper extracts the original OpenUI content, and `POST /api/export` parses it against the generated JSON schema. Explicit TSX templates in `src/lib/code-export/` translate supported nodes into React code that imports shadcn/ui components. The downloaded `GeneratedUI.tsx` runs without OpenUI, its DSL parser, or its renderer. Export is deterministic and does not make another LLM request.

```text
Imported shadcn/ui components
  → manually authored defineComponent schemas + render functions
  → generated library spec → LLM → OpenUI DSL
  → schema-aware parser
      → live OpenUI renderer → interactive chat
      → explicit TSX templates → GeneratedUI.tsx
```

Adding a component requires both its manual OpenUI definition and an export template if it should support TSX export. A component's live React implementation is not automatically converted into source code.

---

## Architecture

```
┌────────────────────────────────────┐        ┌────────────────────────────────────┐
│   Browser                          │  HTTP  │   Next.js API Route                │
│                                    │ ──────►│                                    │
│  • <AgentInterface /> manages UI   │        │  • OpenUI Cloud Completions proxy  │
│  • openAIAdapter()                 │◄────── │  • Full thread sent each turn      │
│  • shadcnChatLibrary renders nodes │  SSE   │  • App tools via runChatToolLoop   │
│  • In-memory threads               │        │  • Streams Completions SSE events  │
└────────────────────────────────────┘        └────────────────────────────────────┘
```

### Request / Response Flow

1. User types a message. `<AgentInterface />` calls `llm.send`, which sends `POST /api/chat` with the full thread formatted via `openAIMessageFormat`.
2. The API route loads the generated library spec, wraps it with `generateSystemPrompt({ cloud: true })`, and calls OpenUI Cloud's Chat Completions API with the full message history.
3. If the model calls an app-owned tool, `runChatToolLoop` executes it on this server and continues until the model returns a final answer.
4. The model streams OpenUI Lang as Chat Completions SSE events.
5. On the client, `openAIAdapter()` parses the events and hands the accumulated text to `<AgentInterface />`.
6. The renderer parses OpenUI Lang against `shadcnChatLibrary` and renders each node as a shadcn/ui component in real time.
7. After completion, **View code / export** reveals the original DSL. Selecting **React TSX** sends only that content to `/api/export`; each tab offers Copy and Download. Opening the DSL panel alone makes no export request.

---

## Project Structure

```
shadcn/
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts      # OpenUI Cloud Completions proxy + app tools
│   │   ├── api/export/route.ts    # Validate DSL and return standalone TSX + metadata
│   │   ├── page.tsx               # Single page — mounts <AgentInterface />
│   │   └── layout.tsx             # Root layout with ThemeProvider
│   ├── components/
│   │   ├── exportable-message.tsx # Public Renderer + chat callbacks + code panel
│   │   └── ui/                   # Base shadcn/ui primitives (accordion, card, table, etc.)
│   ├── lib/
│   │   ├── code-export/          # Schema-aware parser integration + explicit TSX templates
│   │   ├── export-content.ts     # Local sentinel extraction + form-state helpers
│   │   └── shadcn-genui/          # Custom OpenUI component library
│   │       ├── index.tsx          # Library export — createLibrary() call
│   │       ├── action.ts          # Button action Zod schemas
│   │       ├── helpers.ts         # Chart data builder utilities
│   │       ├── rules.ts           # Form validation rule schemas
│   │       ├── unions.ts          # Zod union types for component children
│   │       └── components/        # One file per component (45+ total)
│   └── generated/
│       └── spec.json              # Auto-generated library spec — do not edit manually
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 22.15+ (including the TypeScript test loader)
- pnpm, npm, or Bun
- An OpenUI Cloud API key (https://console.thesys.dev/keys)

### 1. Install dependencies

```bash
cd examples/design-systems/shadcn
pnpm install --ignore-workspace
```

### 2. Configure environment

Create a `.env.local` file in the `examples/design-systems/shadcn/` directory:

```
THESYS_API_KEY=sk-th-...
```

### 3. Start the dev server

```bash
pnpm dev
```

This runs `generate` first (compiles the component library → `src/generated/spec.json`) then starts the Next.js dev server at `http://localhost:3000`.

---

## What's in This Example

### System Prompt Generation

The `src/lib/shadcn-genui/index.tsx` file defines the entire component library using `createLibrary()`. At dev time, the OpenUI CLI reads this library and writes `src/generated/spec.json`. Cloud's `generateSystemPrompt({ cloud: true, library })` turns that spec into the managed system prompt.

Re-run generation any time you change component definitions:

```bash
pnpm generate
```

### `src/app/api/chat/route.ts` — Backend

The route proxies OpenUI Cloud's Chat Completions API. Completions is message-based, so the full thread is sent every turn. App-owned tools run in `runChatToolLoop`.

The response is streamed as **Chat Completions SSE** for `openAIAdapter()`.

### `src/app/api/export/route.ts` — DSL and React Export

Send a JSON object with a non-empty `dsl` string. Send the OpenUI program, excluding the chat's `]]>openui:content`, `]]>openui:context`, and `]]>openui:end` envelopes and any saved form-state context.

```bash
curl -X POST http://localhost:3000/api/export \
  -H 'Content-Type: application/json' \
  --data '{"dsl":"root = Card([CardHeader(\"Hello\", \"Exported with shadcn/ui\")])"}'
```

The route reads `src/generated/spec.json` using the same file-loading pattern as `cloud-prompt.ts`, then calls `exportOpenUI(dsl, library.schema)`. Run `pnpm generate` before using the endpoint; `pnpm dev` and `pnpm build` do this automatically.

A successful JSON response has this shape:

```ts
{
  dsl: string;
  code: string;
  language: "tsx";
  filename: "GeneratedUI.tsx";
  dependencies: string[];
  shadcnComponents: string[];
  warnings: string[];
}
```

`dsl` contains the OpenUI source and `code` contains the standalone TSX. `dependencies` lists packages used by the generated code; `shadcnComponents` identifies the shadcn/ui components it imports. `warnings` describes behavior requiring integration in the receiving app.

Malformed JSON, missing/empty/non-string DSL, a request body larger than 1 MiB, or DSL larger than 200,000 UTF-8 bytes returns **400**. Invalid or unsupported DSL returns **422** with `{ "error": { "message": "...", "details": ... } }`; `details` is optional. Server configuration or unexpected exporter failures return **500**. This endpoint does not change `/api/chat` or its streaming response.

### Export Scope

- Copy/download in the **OpenUI DSL** tab preserves the original message content after removing its chat envelope and saved context. It does not rewrite the program from the rendered UI or include subsequently edited form values.
- **React TSX** produces `GeneratedUI.tsx`, which imports the required shadcn/ui primitives from `@/components/ui/*` and any additional packages listed in `dependencies`. Use it in a React project with those components, their supporting files, styles, and the matching `@/` alias. It has no OpenUI runtime dependency.
- Chat continuations, form submission, pagination, and other app actions need the generated component's callbacks connected to your application. Export cannot reproduce a chat backend or app-specific side effects; read its warnings and callback interfaces.
- Data needed for export must already be resolved into the DSL. Live tool calls, server queries, reactive expressions, or other unsupported constructs cannot be assumed to transfer to the standalone file; the exporter reports unsupported programs with **422**. Resolve the data in your app or provide a supported static program.
- Export supports the components and behavior covered by its explicit templates. Newly registered or custom components require matching templates, and complex behaviors may need application code.

### `src/app/page.tsx` — Frontend

The entire chat interface is the `<AgentInterface />` component from `@openuidev/react-ui`. You configure it with:

| Prop               | Value                      | Purpose                                                                   |
| ------------------ | -------------------------- | ------------------------------------------------------------------------- |
| `llm`              | `{ send, streamProtocol }` | How to call your backend (`send`) and parse its stream (`streamProtocol`) |
| `componentLibrary` | `shadcnChatLibrary`        | Which components to render OpenUI Lang nodes with                         |
| `components.AssistantMessage` | `ExportableAssistantMessage` | Render the GenUI message and add the collapsed export panel |

`llm` is created with `fetchLLM({ streamAdapter: openAIAdapter(), messageFormat: openAIMessageFormat })`. Threads stay in memory — there is no `storage` prop.

```tsx
<AgentInterface
  llm={llm}
  componentLibrary={shadcnChatLibrary}
  components={{ AssistantMessage: ExportableAssistantMessage }}
/>
```

`ExportableAssistantMessage` uses the public `Renderer` and `useThread` APIs and preserves optional `message.actions`. It forwards streaming status, hydrates saved form state, persists updates using the original content header, sends chat continuation actions with their form context, and handles URL actions. The live renderer stays mounted when export state changes.

The local, tested helpers in `src/lib/export-content.ts` mirror react-ui's sentinel formats, including legacy XML messages, and separate display content from stored context before export. No package-internal imports are required. The code panel appears after streaming finishes, starts collapsed, and only requests TSX when the user selects that tab or retries an export. Requests are cancelled when the panel closes, the user switches back to DSL, or the message changes; changing content also resets cached exports.

The page also passes 7 built-in `starters` (each a `{ displayText, prompt }` pair) to showcase the component library:

| Starter           | What it demonstrates                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| Startup dashboard | Tabs, BarChart, LineChart, PieChart, Table, Progress, Tags                 |
| Travel planner    | CalendarBlock, Accordion, Tags, Form (Select, Slider, Checkboxes)          |
| Market watch      | Tool calling (get_stock_price), Table, Alert, DrawerBlock, BarChart        |
| Event RSVP        | Form (Input, Select, RadioGroup, DatePicker, Slider, Checkboxes, Switches) |
| Team standup      | Progress, Table, Alert, Accordion, DialogBlock, PieChart                   |
| Recipe card       | Tabs, Accordion, PieChart, Button, DialogBlock                             |
| Chart showcase    | All 6 chart types: Bar, Line, Area, Pie, Radar, Scatter + RadialChart      |

### `src/lib/shadcn-genui/` — Custom Component Library

Each component is defined with `defineComponent()` from `@openuidev/react-lang`, which takes:

- `name` — the OpenUI Lang node name the LLM will emit
- `props` — a Zod schema that validates and types the node's props as they stream in
- `description` — included in the system prompt so the LLM knows when and how to use the component
- `component` — the React render function; `renderNode()` recursively renders child nodes

The full library (`shadcnChatLibrary`) is assembled with `createLibrary({ root: "Card", components: [...] })`.

#### Component Groups

| Group                | Components                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Content**          | `Card`, `CardHeader`, `TextContent`, `MarkDownRenderer`, `Alert`, `Badge`, `Avatar`, `CodeBlock`, `Image`, `Progress`, `Separator`                                                           |
| **Tables**           | `Table`, `Col`                                                                                                                                                                               |
| **Charts (2D)**      | `BarChart`, `LineChart`, `AreaChart`, `RadarChart`, `Series`                                                                                                                                 |
| **Charts (1D)**      | `PieChart`, `RadialChart`, `Slice`                                                                                                                                                           |
| **Charts (Scatter)** | `ScatterChart`, `ScatterSeries`, `Point`                                                                                                                                                     |
| **Forms**            | `Form`, `FormControl`, `Label`, `Input`, `TextArea`, `Select`, `SelectItem`, `DatePicker`, `Slider`, `CheckBoxGroup`, `CheckBoxItem`, `RadioGroup`, `RadioItem`, `SwitchGroup`, `SwitchItem` |
| **Buttons**          | `Button`, `Buttons`                                                                                                                                                                          |
| **Follow-ups**       | `FollowUpBlock`, `FollowUpItem`                                                                                                                                                              |
| **Layout**           | `Tabs`, `TabItem`, `Accordion`, `AccordionItemDef`, `Carousel`                                                                                                                               |
| **Data Display**     | `TagBlock`, `Tag`                                                                                                                                                                            |
| **Typography**       | `Heading`, `Blockquote`, `InlineCode`                                                                                                                                                        |
| **Navigation**       | `PaginationBlock`                                                                                                                                                                            |
| **Overlays**         | `DialogBlock`, `AlertDialogBlock`, `DrawerBlock`                                                                                                                                             |
| **Calendar**         | `CalendarBlock`                                                                                                                                                                              |

### Mock Tools

All three tools are mock implementations with simulated network delays. They return realistic-looking data so the LLM can generate rich UI responses.

#### `get_weather`

Returns current conditions and a two-day forecast for a city.

- **Input**: `location` (string) — city name
- **Simulated delay**: 800ms
- **Returns**:

| Field                    | Example                                     |
| ------------------------ | ------------------------------------------- |
| `temperature_celsius`    | `22`                                        |
| `temperature_fahrenheit` | `72`                                        |
| `condition`              | `"Sunny"`                                   |
| `humidity_percent`       | `65`                                        |
| `wind_speed_kmh`         | `12`                                        |
| `forecast`               | 2-day array with `high`, `low`, `condition` |

Hardcoded temperatures for: Tokyo (22°C), San Francisco (18°C), London (14°C), New York (25°C), Paris (19°C), Sydney (27°C), Mumbai (33°C), Berlin (16°C). Other cities get a random value.

#### `get_stock_price`

Returns current price data for a stock ticker.

- **Input**: `symbol` (string) — e.g. `AAPL`
- **Simulated delay**: 600ms
- **Returns**:

| Field            | Example   |
| ---------------- | --------- |
| `price`          | `190.12`  |
| `change`         | `+0.28`   |
| `change_percent` | `+0.15%`  |
| `volume`         | `"42.3M"` |
| `day_high`       | `191.50`  |
| `day_low`        | `188.90`  |

Hardcoded prices for: AAPL ($189.84), GOOGL ($141.80), TSLA ($248.42), MSFT ($378.91), AMZN ($178.25), NVDA ($875.28), META ($485.58). Other tickers get a random price.

#### `search_web`

Returns mock search results for any query.

- **Input**: `query` (string) — the search term
- **Simulated delay**: 1000ms
- **Returns**: an array of 3 results, each with `title` and `snippet` templated from the query string

---

## Scripts

| Script                 | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `pnpm dev`             | Generate system prompt, then start the Next.js dev server    |
| `pnpm generate` | Recompile `shadcn-genui` → `src/generated/spec.json` |
| `pnpm build`           | Build for production                                         |
| `pnpm start`           | Start the production server                                  |
| `pnpm test`            | Run exporter and message-content tests (Node.js 22.15+)      |

---

## Learn More

- [OpenUI Lang overview](https://www.openui.com/docs/openui-lang/overview) — Library, Prompt Generator, Parser, Renderer
- [Defining Components](https://www.openui.com/docs/openui-lang/defining-components) — `defineComponent` and `createLibrary` API
- [shadcn/ui](https://ui.shadcn.com/) — the underlying component system
- [`@openuidev/react-lang` package](../../../packages/react-lang)

## Verify

```bash
pnpm verify
```
