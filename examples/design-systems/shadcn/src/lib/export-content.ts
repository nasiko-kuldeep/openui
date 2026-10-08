// Keep message-envelope handling local: react-ui's equivalent sentinel helpers
// are not public exports. These mirror its content/context and legacy formats.
const CONTENT_MARKER = "]]>openui:content";
const CONTEXT_MARKER = "]]>openui:context";
const END_MARKER = "]]>openui:end";
const MARKERS = [CONTENT_MARKER, CONTEXT_MARKER, END_MARKER];

export interface MessageContent {
  content: string;
  contextString: string | null;
  contentHeader?: string;
  end?: boolean;
}

export function wrapContent(content: string, header = CONTENT_MARKER): string {
  return `${header}\n${content}`;
}

export function wrapContext(context: string): string {
  return `\n${CONTEXT_MARKER}\n${context}`;
}

function stripSeparator(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

function bodyStart(raw: string, markerIndex: number): number {
  const lineEnd = raw.indexOf("\n", markerIndex);
  return lineEnd === -1 ? raw.length : lineEnd + 1;
}

/** Return the original display content, excluding saved state and transport markers. */
export function separateContentAndContext(raw: string): MessageContent {
  let text = raw;
  let end = false;
  // End markers may have attributes. Preserve any text after their header line.
  for (let index = text.indexOf(END_MARKER); index !== -1; index = text.indexOf(END_MARKER)) {
    end = true;
    const lineEnd = text.indexOf("\n", index);
    const before = stripSeparator(text.slice(0, index));
    const after = lineEnd === -1 ? "" : text.slice(lineEnd + 1);
    text = after === "" ? before : `${before}\n${after}`;
  }

  const contentIndex = text.lastIndexOf(CONTENT_MARKER);
  const contextIndex = text.lastIndexOf(CONTEXT_MARKER);
  let content = text;
  let contextString: string | null = null;
  let contentHeader: string | undefined;

  if (contentIndex !== -1) {
    const lineEnd = text.indexOf("\n", contentIndex);
    contentHeader = lineEnd === -1 ? text.slice(contentIndex) : text.slice(contentIndex, lineEnd);
    content = text.slice(bodyStart(text, contentIndex));
    if (contextIndex > contentIndex) {
      content = stripSeparator(text.slice(bodyStart(text, contentIndex), contextIndex));
      contextString = text.slice(bodyStart(text, contextIndex));
    }
  } else if (contextIndex !== -1) {
    content = stripSeparator(text.slice(0, contextIndex));
    contextString = text.slice(bodyStart(text, contextIndex));
  } else {
    // Messages saved by older versions used <content>/<context> XML envelopes.
    const contextMatch = text.match(/<context>([\s\S]*)<\/context>\s*$/);
    if (contextMatch) {
      contextString = contextMatch[1] ?? null;
      content = text.slice(0, contextMatch.index).trimEnd();
    }
    const contentMatch = content.match(/^<content[^>]*>([\s\S]*)<\/content>\s*$/);
    if (contentMatch) content = contentMatch[1] ?? content;
  }

  // A marker can arrive over multiple streaming chunks. Hide only a proper
  // prefix at the end; a subsequent chunk reparses the complete message.
  let partialLength = 0;
  for (const marker of MARKERS) {
    for (let length = Math.min(marker.length - 1, content.length); length > partialLength; length--) {
      if (content.endsWith(marker.slice(0, length))) {
        partialLength = length;
        break;
      }
    }
  }
  if (partialLength > 0) content = stripSeparator(content.slice(0, -partialLength));

  return {
    content,
    contextString,
    ...(contentHeader !== undefined ? { contentHeader } : {}),
    ...(end ? { end: true } : {}),
  };
}

export function hasLangSyntax(content: string): boolean {
  return content.includes("```openui-lang") || /(^|\n)\s*root\s*=/.test(content);
}

/** Hydrate only an object-shaped form state, as accepted by the live renderer. */
export function parsePersistedState(context: string | null): Record<string, unknown> | undefined {
  if (!context) return undefined;
  try {
    const parsed: unknown = JSON.parse(context);
    const state: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof state === "object" && state !== null && !Array.isArray(state)) {
      return state as Record<string, unknown>;
    }
  } catch {
    // Partial or malformed context must not prevent the UI itself from rendering.
  }
  return undefined;
}
