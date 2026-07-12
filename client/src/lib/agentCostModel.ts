/**
 * Theoretical call-count range per agent, derived from reading
 * server/src/agents/base.ts's tool-use loop and each agent's getContextTools()
 * override — not measured. Shown next to real averages on the Usage page so
 * the comparison is direct instead of requiring a separate write-up.
 *
 * `tools` is a free-text summary of the agent's getContextTools() override —
 * not used for any UI logic (see UsagePage.tsx), only surfaced via `note`'s
 * tooltip — so it doesn't need a closed set of categories. Roughly:
 * - no context tools: output tool is the model's only option — one call,
 *   barring a validation-error retry.
 * - lookup_names only / a narrow 1-2 tool subset: one or two calls.
 * - the full context-tool set (up to MAX_ITERATIONS = 10 in base.ts) —
 *   genuinely open-ended, depends on how much the model explores.
 *
 * These are call-count ranges, not cost ranges — since AnthropicProvider caches
 * the system prompt (providers/anthropic.ts), repeat turns within an agent's
 * own loop, and repeated calls to the same agent/world, are billed well below
 * full price per call. The call-count range above still holds; token cost no
 * longer scales linearly with it.
 */
export interface AgentCostProfile {
  calls: string;
  tools: string;
  note: string;
}

export const AGENT_COST_MODEL: Record<string, AgentCostProfile> = {
  architect:         { calls: '1–2',  tools: 'lookup',  note: 'lookup_names only' },
  muse:              { calls: '1–2',  tools: 'lookup',  note: 'lookup_names only' },
  curator:           { calls: '1',    tools: 'none',    note: 'no context tools' },
  oracle:            { calls: '1–2',  tools: 'lookup',  note: 'lookup_names only' },
  researcher:        { calls: '1–10', tools: 'full',    note: 'full context-tool set + lookup_names' },
  scribe:            { calls: '1–2',  tools: 'lookup',  note: 'lookup_names only' },
  continuity_editor: { calls: '1',    tools: 'none',    note: 'no context tools — relies on contextPackage + Researcher brief' },
  lorekeeper:        { calls: '1',    tools: 'none',    note: 'no context tools' },
  cartographer:      { calls: '1–2',  tools: 'lookup',  note: 'lookup_names only' },
  grounding_check:   { calls: '1–3',  tools: 'partial', note: 'get_article + search_articles' },
  dedup_check:       { calls: '1–3',  tools: 'partial', note: 'get_article + search_articles' },
  sentinel:          { calls: '1',    tools: 'none',    note: 'no context tools' },
  warden:            { calls: '1–10', tools: 'full',    note: 'full context-tool set' },
  style_warden:      { calls: '1',    tools: 'none',    note: 'no context tools' },
  linter:            { calls: '1–10', tools: 'full',    note: 'full context-tool set' },
  fixer:             { calls: '1–10', tools: 'full',    note: 'full context-tool set' },
  condenser:         { calls: '1',    tools: 'none',    note: 'no context tools, unbounded input' },
  auditor:           { calls: '1–10', tools: 'full',    note: 'full context-tool set, unbounded input' },
  stylist:           { calls: '1',    tools: 'none',    note: 'no context tools' },
};
