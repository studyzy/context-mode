/**
 * adapters/codebuddy/hooks — CodeBuddy hook definitions.
 *
 * CodeBuddy uses the same JSON stdin/stdout wire protocol as Claude Code.
 * Hook events: PreToolUse, PostToolUse, PreCompact, SessionStart, UserPromptSubmit.
 *
 * Config: ~/.codebuddy/settings.json under "hooks" key.
 */

// ─────────────────────────────────────────────────────────
// External MCP routing matcher (#529)
// ─────────────────────────────────────────────────────────

/**
 * Negative-lookahead matcher for external MCP tool namespaces on CodeBuddy.
 *
 * CodeBuddy MCP wire shape: `mcp__<server>__<tool>`. Own context-mode MCP
 * surfaces as `mcp__context-mode__ctx_*`. The negative lookahead
 * `(?!.*context-mode)` excludes context-mode's own tools from the
 * external-MCP routing branch so they are not double-routed.
 */
export const EXTERNAL_MCP_MATCHER_PATTERN = "mcp__(?!.*context-mode)";

export const ROUTING_INSTRUCTIONS_PATH = "configs/codebuddy/CODEBUDDY.md";
