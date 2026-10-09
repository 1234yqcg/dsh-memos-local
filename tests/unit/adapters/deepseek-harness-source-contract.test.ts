/**
 * Guard the DSH message-source contract for memos-produced messages.
 *
 * DSH 0.1.7 (Session V4) rejected every turn with
 * `format v4 message requires a producer-owned source kind` because the plugin
 * still emitted the retired catch-all shell `{ kind: "plugin", plugin: ... }`.
 * `MessageSourceMap` in `@deepseek-ai/dsh-llm` is merge-extensible and states
 * plainly that "there is no shared catch-all `plugin` kind": each producer
 * declares its own kind, so an unregistered producer resolves to
 * `"plugin:<name>"` and the separate `plugin` field is dropped.
 *
 * The failure was silent on the plugin side (the local fixture in
 * `deepseek-harness-bridge.test.ts` kept the old shape and stayed green), so
 * these assertions pin the real producers' output directly. If DSH changes the
 * source vocabulary again, this file fails instead of the runtime.
 */

import { describe, expect, it } from "vitest";

import { DEEPSEEK_HARNESS_PLUGIN } from "../../../adapters/deepseek-harness/bridge.js";
import {
  createDeepSeekHarnessRecallMessage,
  deepSeekHarnessMemoryGuidance,
} from "../../../adapters/deepseek-harness/index.js";

/** The producer-owned kind DSH resolves for an unregistered plugin producer. */
const EXPECTED_PRODUCER_KIND = `plugin:${DEEPSEEK_HARNESS_PLUGIN}`;

function sourceOf(message: unknown): Record<string, unknown> {
  const source = (message as { source?: unknown }).source;
  if (source === null || typeof source !== "object") {
    throw new Error("memos message is missing its source object");
  }
  return source as Record<string, unknown>;
}

describe("DeepSeek Harness message source contract", () => {
  it("tags recalled memory with the producer-owned kind", () => {
    const message = createDeepSeekHarnessRecallMessage("<memos_context>recalled</memos_context>");

    expect(message.role).toBe("user");
    expect(sourceOf(message)).toEqual({
      kind: EXPECTED_PRODUCER_KIND,
      form: "recall",
    });
  });

  it("never re-introduces the retired catch-all plugin shell", () => {
    const message = createDeepSeekHarnessRecallMessage("recalled");
    const source = sourceOf(message);

    // The 0.1.7 regression: `kind:"plugin"` plus a sibling `plugin` field.
    expect(source["kind"]).not.toBe("plugin");
    expect(source).not.toHaveProperty("plugin");
  });

  it("carries the recalled text verbatim in one text block", () => {
    const text = "<memos_context>\nThe user prefers concise answers.\n</memos_context>";
    const message = createDeepSeekHarnessRecallMessage(text);

    expect(message.content).toEqual([{ type: "text", text }]);
  });

  it("resolves the producer kind from the plugin identity, not a literal", () => {
    // Guards against someone hard-coding a kind that silently diverges from
    // the bundle's registered plugin name.
    expect(EXPECTED_PRODUCER_KIND).toBe("plugin:memos-local-memory");
    expect(DEEPSEEK_HARNESS_PLUGIN).toBe("memos-local-memory");
  });

  it("keeps the memory guidance free of source-contract vocabulary", () => {
    // The prompt section is user-visible text; it must not leak the internal
    // source kinds that consumers switch on.
    const guidance = deepSeekHarnessMemoryGuidance(true);

    expect(guidance).toContain("<memos_context>");
    expect(guidance).not.toContain("plugin:");
  });
});