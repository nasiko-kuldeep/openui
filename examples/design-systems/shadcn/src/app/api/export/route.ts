import { ExportError, exportOpenUI } from "@/lib/code-export";
import type { LibrarySpec } from "@openuidev/lang-core";
import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import { join } from "path";

export const runtime = "nodejs";

// Bound the JSON body as well as the decoded program, including chunked requests.
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_DSL_BYTES = 200_000;

class RequestError extends Error {}

async function readBody(req: Request): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const size = Number(contentLength);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BODY_BYTES) {
      throw new RequestError("Request body must be at most 1 MiB.");
    }
  }

  if (!req.body) throw new RequestError("A JSON body is required.");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RequestError("Request body must be at most 1 MiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = Buffer.concat(chunks, size);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError("Request body must be valid JSON.");
  }
}

export async function POST(req: Request) {
  let dsl: string;
  try {
    const body = await readBody(req);
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      !("dsl" in body) ||
      typeof body.dsl !== "string" ||
      body.dsl.trim().length === 0
    ) {
      throw new RequestError("dsl must be a non-empty string.");
    }
    if (Buffer.byteLength(body.dsl, "utf-8") > MAX_DSL_BYTES) {
      throw new RequestError("dsl must be at most 200,000 UTF-8 bytes.");
    }
    dsl = body.dsl;
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: error instanceof RequestError ? error.message : "Could not read request body.",
        },
      },
      { status: 400 },
    );
  }

  try {
    // Match cloud-prompt.ts: load the CLI-generated spec without importing the
    // client component library into this server route.
    const library = JSON.parse(
      readFileSync(join(process.cwd(), "src/generated/spec.json"), "utf-8"),
    ) as LibrarySpec;
    if (!library.schema?.$defs) {
      throw new Error("Generated library spec is missing its JSON schema.");
    }

    return NextResponse.json(exportOpenUI(dsl, library.schema), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ExportError) {
      return NextResponse.json(
        {
          error: {
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {}),
          },
        },
        { status: 422 },
      );
    }
    console.error("OpenUI export failed:", error);
    return NextResponse.json(
      { error: { message: "Export is unavailable. Check the generated library spec and try again." } },
      { status: 500 },
    );
  }
}
