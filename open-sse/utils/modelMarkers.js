// Claude Code appends a bracketed context marker to the model name when the
// 1M-context beta is toggled on: `claude-opus-5` becomes `claude-opus-5[1m]`.
// The marker is a client-side annotation, not part of any model id: it never
// matches a combo name, an alias or a `provider/model` pair, so a request that
// carries it dies at model resolution with "Invalid model format".
//
// The capability itself travels in the `anthropic-beta: context-1m-2025-08-07`
// header, which is forwarded untouched — stripping the marker is enough to let
// the request route normally and still reach the upstream as a 1M request.

const CONTEXT_MARKER = /\[1m\]$/i;

// Returns { model, contextMarker } — contextMarker is null when there is none.
export function stripModelContextMarker(modelStr) {
  if (typeof modelStr !== "string") return { model: modelStr, contextMarker: null };
  const trimmed = modelStr.trim();
  const match = trimmed.match(CONTEXT_MARKER);
  if (!match) return { model: modelStr, contextMarker: null };
  return { model: trimmed.slice(0, -match[0].length), contextMarker: match[0].slice(1, -1).toLowerCase() };
}

// Idempotent: never stacks `[1m][1m]`.
export function withModelContextMarker(modelStr) {
  return `${stripModelContextMarker(modelStr).model}[1m]`;
}

// Behind a gateway Claude Code assumes a 200K window for every id (even ones it
// recognises) unless the id carries `[1m]`, and it keeps a discovered
// `/v1/models` entry only when the id contains "claude" or "anthropic". A combo
// name can't hold the marker (the dashboard rejects `[`), so the catalog emits a
// `<id>[1m]` twin after each bare (combo-style, no `provider/`) Claude-named
// entry whose real window is at least 1M; the marker is stripped again at the
// chat handler so the twin routes like its base id. Provider-prefixed ids are
// skipped: their twins only clutter the picker next to the combo rows.
const CONTEXT_MARKER_MIN_WINDOW = 1_000_000;
const CLAUDE_DISCOVERY_ID = /claude|anthropic/i;

export function expandContextMarkerTwins(models) {
  if (!Array.isArray(models)) return models;
  const out = [];
  for (const entry of models) {
    out.push(entry);
    const id = entry?.id;
    if (typeof id !== "string" || id.includes("/") || !CLAUDE_DISCOVERY_ID.test(id) || stripModelContextMarker(id).contextMarker) continue;
    const window = entry.context_length ?? entry.capabilities?.contextWindow;
    if (!Number.isFinite(window) || window < CONTEXT_MARKER_MIN_WINDOW) continue;
    out.push({ ...entry, id: withModelContextMarker(id), display_name: `${entry.display_name || id} (1M context)` });
  }
  return out;
}
