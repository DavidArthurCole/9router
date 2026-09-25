/**
 * Regression: Claude Code appends `[1m]` to the model name when the
 * 1M-context beta is on, so `/v1/messages` arrives with
 * `model: "claude-opus-5[1m]"`. Nothing in 9router knows about the marker:
 * it matches no combo, no alias and no `provider/model` pair, so the request
 * is rejected at model resolution and the client reports
 *
 *   There's an issue with the selected model (claude-opus-5[1m]).
 *   It may not exist or you may not have access to it.
 *
 * The capability itself rides in the `anthropic-beta` header, which is
 * forwarded untouched, so stripping the marker is all that is needed.
 */

import { describe, it, expect } from "vitest";
import { stripModelContextMarker, withModelContextMarker, expandContextMarkerTwins } from "../../open-sse/utils/modelMarkers.js";

describe("model context marker", () => {
  it("strips the [1m] marker and reports it", () => {
    expect(stripModelContextMarker("claude-opus-5[1m]")).toEqual({
      model: "claude-opus-5",
      contextMarker: "1m",
    });
  });

  it("strips it from a provider-prefixed model too", () => {
    expect(stripModelContextMarker("cc/claude-sonnet-4.5[1m]")).toEqual({
      model: "cc/claude-sonnet-4.5",
      contextMarker: "1m",
    });
  });

  it("is case insensitive", () => {
    expect(stripModelContextMarker("claude-opus-5[1M]").model).toBe("claude-opus-5");
  });

  it("leaves a plain model untouched", () => {
    expect(stripModelContextMarker("claude-opus-5")).toEqual({
      model: "claude-opus-5",
      contextMarker: null,
    });
  });

  it("only strips a trailing marker, never one inside the name", () => {
    expect(stripModelContextMarker("weird[1m]name")).toEqual({
      model: "weird[1m]name",
      contextMarker: null,
    });
  });

  it("tolerates a non-string model", () => {
    expect(stripModelContextMarker(undefined)).toEqual({ model: undefined, contextMarker: null });
  });

  it("appends the marker without stacking it", () => {
    expect(withModelContextMarker("cc/claude-opus-5-5")).toBe("cc/claude-opus-5-5[1m]");
    expect(withModelContextMarker("cc/claude-opus-5-5[1m]")).toBe("cc/claude-opus-5-5[1m]");
  });
});

/**
 * The marker can't live in a combo name (`[` is rejected), so `/v1/models`
 * advertises a `<id>[1m]` twin for Claude-named entries with a real 1M window.
 * Claude Code's gateway discovery keeps only ids containing "claude"/"anthropic"
 * and assumes 200K for anything without `[1m]`.
 */
describe("expandContextMarkerTwins", () => {
  const combo = { id: "claude-opus-5-5", object: "model", owned_by: "combo", context_length: 1_000_000 };

  it("adds a [1m] twin right after a 1M Claude combo", () => {
    const out = expandContextMarkerTwins([combo]);
    expect(out.map((m) => m.id)).toEqual(["claude-opus-5-5", "claude-opus-5-5[1m]"]);
    expect(out[1]).toMatchObject({ owned_by: "combo", context_length: 1_000_000, display_name: "claude-opus-5-5 (1M context)" });
  });

  it("reads the window from capabilities when context_length is absent", () => {
    const out = expandContextMarkerTwins([{ id: "cc/claude-sonnet-5", capabilities: { contextWindow: 1_000_000 } }]);
    expect(out).toHaveLength(2);
  });

  it("skips 200K windows, non-Claude ids, and ids already marked", () => {
    const out = expandContextMarkerTwins([
      { id: "claude-haiku-4-5", context_length: 200_000 },
      { id: "ocg/deepseek-v4-pro", context_length: 1_000_000 },
      { id: "claude-opus-5-5[1m]", context_length: 1_000_000 },
      { id: "cc/claude-opus-5-5" },
    ]);
    expect(out.map((m) => m.id)).toEqual(["claude-haiku-4-5", "ocg/deepseek-v4-pro", "claude-opus-5-5[1m]", "cc/claude-opus-5-5"]);
  });

  it("passes non-arrays through", () => {
    expect(expandContextMarkerTwins(null)).toBeNull();
  });
});
