import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasLangSyntax,
  parsePersistedState,
  separateContentAndContext,
  wrapContent,
  wrapContext,
} from "../src/lib/export-content";

const dsl = 'root = Card([CardHeader("Hello", "World")])';

test("preserves original bare and fenced DSL without rewriting whitespace", () => {
  for (const content of [dsl, `\n${dsl}\n`, `\`\`\`openui-lang\n${dsl}\n\`\`\``]) {
    assert.deepEqual(separateContentAndContext(content), { content, contextString: null });
    assert.ok(hasLangSyntax(content));
  }
  assert.equal(hasLangSyntax("Here is a plain text answer."), false);
});

test("separates content, header attributes, saved state, and the end marker", () => {
  const header = "]]>openui:content?libraryVersion=v2";
  const state = '[{"contact":{"email":{"value":"private@example.com"}}}]';
  const raw = `${wrapContent(dsl, header)}${wrapContext(state)}\n]]>openui:end`;
  assert.deepEqual(separateContentAndContext(raw), {
    content: dsl,
    contextString: state,
    contentHeader: header,
    end: true,
  });
  assert.equal(raw.includes("private@example.com"), true, "The source message stays untouched.");
});

test("separates CRLF envelopes without trimming the original DSL", () => {
  const original = `${dsl}\r\n`;
  const raw = `]]>openui:content\r\n${original}\r\n]]>openui:context\r\n[{}]\r\n]]>openui:end`;
  const parsed = separateContentAndContext(raw);
  assert.equal(parsed.content, original);
  assert.equal(parsed.contextString, "[{}]");
  assert.equal(parsed.contentHeader, "]]>openui:content\r");
});

test("selects the latest content section and drops older context", () => {
  const raw = `${wrapContent("old")}${wrapContext('["old state"]')}\n${wrapContent(dsl)}`;
  const parsed = separateContentAndContext(raw);
  assert.equal(parsed.content, dsl);
  assert.equal(parsed.contextString, null);
});

test("context-only messages never become exportable DSL", () => {
  const context = `["User clicked: root = Card([])"]`;
  const parsed = separateContentAndContext(wrapContext(context));
  assert.equal(parsed.content, "");
  assert.equal(parsed.contextString, context);
  assert.equal(hasLangSyntax(parsed.content), false);
});

test("separates context following bare content", () => {
  const parsed = separateContentAndContext(`${dsl}${wrapContext('[{"name":"Ada"}]')}`);
  assert.equal(parsed.content, dsl);
  assert.equal(parsed.contextString, '[{"name":"Ada"}]');
});

test("removes end markers with attributes while retaining following content", () => {
  const raw = `${wrapContent(dsl)}\n]]>openui:end?status=done\n// following text\n]]>openui:end`;
  const parsed = separateContentAndContext(raw);
  assert.equal(parsed.content, `${dsl}\n// following text`);
  assert.equal(parsed.end, true);
});

test("strips partial streaming markers and incomplete content headers", () => {
  for (const marker of ["]]>openui:content", "]]>openui:context", "]]>openui:end"]) {
    for (let length = 1; length < marker.length; length++) {
      const parsed = separateContentAndContext(`${wrapContent(dsl)}\n${marker.slice(0, length)}`);
      assert.equal(parsed.content, dsl);
    }
  }
  assert.equal(separateContentAndContext("]]>openui:content").content, "");
});

test("supports legacy XML envelopes while excluding persisted state", () => {
  const raw = `<content libraryVersion="v1">${dsl}</content>\n<context>[{"name":"Ada"}]</context>`;
  assert.deepEqual(separateContentAndContext(raw), {
    content: dsl,
    contextString: '[{"name":"Ada"}]',
  });
});

test("round-trips form-state updates without changing the content header or DSL", () => {
  const header = "]]>openui:content?libraryVersion=v3&trace=test";
  const before = separateContentAndContext(wrapContent(dsl, header));
  const state = { signup: { email: { value: "ada@example.com", componentType: "Input" } } };
  const persisted = wrapContent(before.content, before.contentHeader) + wrapContext(JSON.stringify([state]));
  const after = separateContentAndContext(persisted);
  assert.equal(after.content, dsl);
  assert.equal(after.contentHeader, header);
  assert.deepEqual(parsePersistedState(after.contextString), state);
  assert.deepEqual(
    separateContentAndContext(wrapContent(after.content, after.contentHeader)),
    before,
    "Clearing form state removes context without changing the program.",
  );
});

test("hydrates object state and tolerates malformed or non-object context", () => {
  const state = { signup: { name: { value: "Ada" } } };
  assert.deepEqual(parsePersistedState(JSON.stringify(state)), state);
  assert.deepEqual(parsePersistedState(JSON.stringify([state])), state);
  for (const context of [null, "", "{", "null", "[]", "[null]", '[["nested"]]', '["action"]', "1"]) {
    assert.equal(parsePersistedState(context), undefined);
  }
});
