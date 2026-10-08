"use client";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ExportResult } from "@/lib/code-export";
import {
  hasLangSyntax,
  parsePersistedState,
  separateContentAndContext,
  wrapContent,
  wrapContext,
} from "@/lib/export-content";
import { shadcnChatLibrary } from "@/lib/shadcn-genui";
import { useThread, type AssistantMessage } from "@openuidev/react-headless";
import { BuiltinActionType, Renderer, type ActionEvent } from "@openuidev/react-lang";
import { safeOpenUrl } from "@openuidev/react-ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ExportableMessageProps = {
  message: AssistantMessage & { actions?: ReactNode };
  isStreaming: boolean;
};

type ExportState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ExportResult };

function isExportResult(value: unknown): value is ExportResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.dsl === "string" &&
    typeof result.code === "string" &&
    result.code.length > 0 &&
    result.language === "tsx" &&
    result.filename === "GeneratedUI.tsx" &&
    ["dependencies", "shadcnComponents", "warnings"].every(
      (key) => Array.isArray(result[key]) && result[key].every((item) => typeof item === "string"),
    )
  );
}

function exportErrorMessage(value: unknown): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = value.error;
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  }
  return "Could not export this response. Please try again.";
}

function downloadCode(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Let the browser begin the download before releasing its object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CodePanel({ dsl }: { dsl: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("dsl");
  const [state, setState] = useState<ExportState>({ status: "idle" });
  const [copyStatus, setCopyStatus] = useState("");
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const copyAttempt = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      copyAttempt.current += 1;
    };
  }, []);

  function cancelExport() {
    request.current?.abort();
    request.current = null;
    setState((current) => (current.status === "loading" ? { status: "idle" } : current));
  }

  async function requestExport() {
    if (request.current || state.status === "ready") return;
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dsl }),
        signal: controller.signal,
        cache: "no-store",
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(exportErrorMessage(result));
      if (!isExportResult(result)) throw new Error("The export response was invalid. Try again.");
      if (mounted.current && !controller.signal.aborted && request.current === controller) {
        setState({ status: "ready", result });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && request.current === controller) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not export this response.",
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function selectTab(value: string) {
    setTab(value);
    setCopyStatus("");
    copyAttempt.current += 1;
    if (value === "tsx") void requestExport();
    else cancelExport();
  }

  async function copyCode(content: string) {
    const attempt = ++copyAttempt.current;
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(content);
      if (mounted.current && copyAttempt.current === attempt) setCopyStatus("Copied.");
    } catch {
      if (mounted.current && copyAttempt.current === attempt) {
        setCopyStatus("Copy failed. Use Download or select the code.");
      }
    }
  }

  const result = state.status === "ready" ? state.result : null;
  const selectedCode = tab === "dsl" ? dsl : result?.code;
  const selectedFilename = tab === "dsl" ? "GeneratedUI.openui" : "GeneratedUI.tsx";

  return (
    <details
      className="mt-3 min-w-0 rounded-lg border bg-background text-foreground"
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (!nextOpen) {
          cancelExport();
          setTab("dsl");
          setCopyStatus("");
          copyAttempt.current += 1;
        }
      }}
    >
      <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        View code / export
      </summary>
      {open && (
        <Tabs value={tab} onValueChange={selectTab} className="min-w-0 border-t p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList aria-label="Export format">
              <TabsTrigger value="dsl">OpenUI DSL</TabsTrigger>
              <TabsTrigger value="tsx">React TSX</TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedCode === undefined}
                aria-label={`Copy ${tab === "dsl" ? "OpenUI DSL" : "React TSX"}`}
                onClick={() => selectedCode !== undefined && void copyCode(selectedCode)}
              >
                Copy
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedCode === undefined}
                aria-label={`Download ${selectedFilename}`}
                onClick={() =>
                  selectedCode !== undefined && downloadCode(selectedCode, selectedFilename)
                }
              >
                Download
              </Button>
            </div>
          </div>
          {copyStatus && (
            <p role="status" className="text-xs text-muted-foreground">
              {copyStatus}
            </p>
          )}
          <TabsContent value="dsl" className="min-w-0">
            <pre
              className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs"
              tabIndex={0}
              aria-label="Original OpenUI DSL"
            >
              <code>{dsl}</code>
            </pre>
          </TabsContent>
          <TabsContent
            value="tsx"
            className="min-w-0 space-y-3"
            aria-busy={state.status === "loading"}
          >
            {state.status === "loading" && (
              <p role="status" className="text-sm text-muted-foreground">
                Generating React TSX…
              </p>
            )}
            {state.status === "error" && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {state.message}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => void requestExport()}>
                  Retry export
                </Button>
              </div>
            )}
            {result && (
              <>
                <p className="text-xs text-muted-foreground">
                  Standalone React using your shadcn/ui components.
                  {result.shadcnComponents.length > 0 &&
                    ` Components: ${result.shadcnComponents.join(", ")}.`}
                  {result.dependencies.length > 0 &&
                    ` Dependencies: ${result.dependencies.join(", ")}.`}
                </p>
                {result.warnings.length > 0 && (
                  <div role="status" className="rounded-md border p-2 text-xs">
                    <p className="font-medium">Export notes</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {result.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <pre
                  className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs"
                  tabIndex={0}
                  aria-label="Standalone React TSX"
                >
                  <code>{result.code}</code>
                </pre>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </details>
  );
}

export function ExportableAssistantMessage({ message, isStreaming }: ExportableMessageProps) {
  const processMessage = useThread((state) => state.processMessage);
  const updateMessage = useThread((state) => state.updateMessage);
  const { content: dsl, contextString, contentHeader } = useMemo(
    () => separateContentAndContext(message.content ?? ""),
    [message.content],
  );
  const initialState = useMemo(() => parsePersistedState(contextString), [contextString]);

  // Preserve the same state persistence and action callbacks as react-ui's
  // GenUIAssistantMessage, using only public APIs.
  const handleStateUpdate = useCallback(
    (state: Record<string, unknown>) => {
      const content = wrapContent(dsl, contentHeader);
      updateMessage({
        ...message,
        content: Object.keys(state).length > 0 ? content + wrapContext(JSON.stringify([state])) : content,
      });
    },
    [contentHeader, dsl, message, updateMessage],
  );

  const handleAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === BuiltinActionType.ContinueConversation) {
        const content = event.humanFriendlyMessage ? wrapContent(event.humanFriendlyMessage) : "";
        const context: (string | object)[] = [`User clicked: ${event.humanFriendlyMessage}`];
        if (event.formState) context.push(event.formState);
        processMessage({ role: "user", content: content + wrapContext(JSON.stringify(context)) });
      } else if (event.type === BuiltinActionType.OpenUrl) {
        const url = event.params?.["url"];
        if (typeof url === "string") safeOpenUrl(url);
      }
    },
    [processMessage],
  );

  return (
    <div className="openui-shell-thread-message-assistant openui-shell-thread-message-assistant--without-logo">
      <div className="openui-shell-thread-message-assistant__content min-w-0">
        {dsl && (
          <Renderer
            response={dsl}
            library={shadcnChatLibrary}
            isStreaming={isStreaming}
            onAction={handleAction}
            onStateUpdate={handleStateUpdate}
            initialState={initialState}
          />
        )}
        {message.actions}
        {!isStreaming && hasLangSyntax(dsl) && (
          // Reset cached code and cancel pending work when message content
          // changes; keep the interactive Renderer mounted above.
          <CodePanel key={`${message.id}:${message.content}`} dsl={dsl} />
        )}
      </div>
    </div>
  );
}
