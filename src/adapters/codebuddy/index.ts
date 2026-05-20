/**
 * adapters/codebuddy — CodeBuddy platform adapter.
 *
 * Extends ClaudeCodeBaseAdapter (shared wire-protocol parse/format methods)
 * with CodeBuddy-specific configuration, diagnostics, and session ID logic.
 *
 * Differences from Claude Code:
 *   - Config dir: ~/.codebuddy/ (not ~/.claude/)
 *   - Env vars: CODEBUDDY_PROJECT_DIR, CODEBUDDY_SESSION_ID (not CLAUDE_*)
 *   - Session ID priority: session_id field first (Claude: transcript_path first)
 *   - MCP clientInfo: CodeBuddy
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

import { ClaudeCodeBaseAdapter, type ClaudeCodeWireInput } from "../claude-code-base.js";
import { EXTERNAL_MCP_MATCHER_PATTERN } from "./hooks.js";

import {
  buildNodeCommand,
  type HookAdapter,
  type HookParadigm,
  type PlatformCapabilities,
  type DiagnosticResult,
  type HookRegistration,
} from "../types.js";

// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────

export class CodeBuddyAdapter extends ClaudeCodeBaseAdapter implements HookAdapter {
  constructor() {
    super([".codebuddy"]);
  }

  readonly name = "CodeBuddy";
  readonly paradigm: HookParadigm = "json-stdio";
  protected readonly projectDirEnvVar = "CODEBUDDY_PROJECT_DIR";

  readonly capabilities: PlatformCapabilities = {
    preToolUse: true,
    postToolUse: true,
    preCompact: true,
    sessionStart: true,
    canModifyArgs: true,
    canModifyOutput: true,
    canInjectSessionContext: true,
  };

  // ── Configuration (differs from Claude Code) ───────────

  getSettingsPath(): string {
    return resolve(homedir(), ".codebuddy", "settings.json");
  }

  getInstructionFiles(): string[] {
    return ["CODEBUDDY.md"];
  }

  generateHookConfig(pluginRoot: string): HookRegistration {
    const preToolUseMatcher = [
      // CodeBuddy tool names (same as Claude Code convention)
      "Bash", "WebFetch", "Read", "Grep", "Agent",
      // MCP tools
      "mcp__context-mode__ctx_execute",
      "mcp__context-mode__ctx_execute_file",
      "mcp__context-mode__ctx_batch_execute",
      // External MCP catch-all
      EXTERNAL_MCP_MATCHER_PATTERN,
    ].join("|");

    return {
      PreToolUse: [
        {
          matcher: preToolUseMatcher,
          hooks: [
            { type: "command", command: buildNodeCommand(`${pluginRoot}/hooks/pretooluse.mjs`) },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|TodoWrite|Agent|AskUserQuestion|mcp__",
          hooks: [
            { type: "command", command: buildNodeCommand(`${pluginRoot}/hooks/posttooluse.mjs`) },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: "",
          hooks: [
            { type: "command", command: buildNodeCommand(`${pluginRoot}/hooks/sessionstart.mjs`) },
          ],
        },
      ],
      PreCompact: [
        {
          matcher: "",
          hooks: [
            { type: "command", command: buildNodeCommand(`${pluginRoot}/hooks/precompact.mjs`) },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          matcher: "",
          hooks: [
            { type: "command", command: buildNodeCommand(`${pluginRoot}/hooks/userpromptsubmit.mjs`) },
          ],
        },
      ],
    };
  }

  // ── Settings read/write ────────────────────────────────

  readSettings(): Record<string, unknown> | null {
    try {
      const raw = readFileSync(this.getSettingsPath(), "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  writeSettings(settings: Record<string, unknown>): void {
    writeFileSync(this.getSettingsPath(), JSON.stringify(settings, null, 2));
  }

  // ── Diagnostics (doctor) ───────────────────────────────

  validateHooks(_pluginRoot: string): DiagnosticResult[] {
    const results: DiagnosticResult[] = [];
    const settings = this.readSettings();
    const hooks = (settings?.hooks ?? {}) as Record<string, unknown>;

    for (const hookName of ["PreToolUse", "PostToolUse", "SessionStart", "PreCompact", "UserPromptSubmit"]) {
      const configured = Array.isArray(hooks[hookName]) && (hooks[hookName] as unknown[]).length > 0;
      results.push({
        check: `${hookName} hook`,
        status: configured ? "pass" : "fail",
        message: configured
          ? `${hookName} hook configured in ~/.codebuddy/settings.json`
          : `${hookName} hook not found in ~/.codebuddy/settings.json`,
        ...(configured ? {} : { fix: `Add ${hookName} hook to ~/.codebuddy/settings.json` }),
      });
    }

    return results;
  }

  checkPluginRegistration(): DiagnosticResult {
    try {
      const settings = this.readSettings();
      if (settings?.mcpServers && typeof settings.mcpServers === "object") {
        const servers = settings.mcpServers as Record<string, unknown>;
        if (Object.keys(servers).some(k => k.includes("context-mode"))) {
          return {
            check: "Plugin registration",
            status: "pass",
            message: "context-mode found in mcpServers",
          };
        }
        return {
          check: "Plugin registration",
          status: "fail",
          message: "mcpServers exists but context-mode not found",
          fix: "Add context-mode to mcpServers in ~/.codebuddy/settings.json",
        };
      }
      return {
        check: "Plugin registration",
        status: "warn",
        message: "No mcpServers in ~/.codebuddy/settings.json",
      };
    } catch {
      return {
        check: "Plugin registration",
        status: "warn",
        message: "Could not read ~/.codebuddy/settings.json",
      };
    }
  }

  getInstalledVersion(): string {
    const settings = this.readSettings();
    if (!settings) return "not installed";

    const hooks = settings.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) return "not installed";

    const contextModeScripts = [
      "pretooluse.mjs",
      "posttooluse.mjs",
      "precompact.mjs",
      "sessionstart.mjs",
      "userpromptsubmit.mjs",
    ];
    for (const [, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const e = entry as { hooks?: Array<{ command?: string }> };
        if (e.hooks?.some((h) =>
          h.command && contextModeScripts.some((s) => h.command!.includes(s)),
        )) {
          return "installed (hooks configured)";
        }
      }
    }

    return "not installed";
  }

  configureAllHooks(pluginRoot: string): string[] {
    const settings = this.readSettings() ?? {};
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
    const changes: string[] = [];

    // ── Phase 1: Clean stale context-mode hooks ──────────
    for (const hookType of Object.keys(hooks)) {
      const entries = hooks[hookType];
      if (!Array.isArray(entries)) continue;

      const filtered = (entries as Array<Record<string, unknown>>).filter(
        (entry) => {
          const e = entry as { hooks?: Array<{ command?: string }> };
          const commands = e.hooks ?? [];

          const isContextMode = commands.some(
            (h) => h.command && /context-mode|pretooluse|posttooluse|precompact|sessionstart|userpromptsubmit/i.test(h.command),
          );
          if (!isContextMode) return true;

          return commands.every((h) => {
            if (!h.command) return true;
            const newFmt = h.command.match(/"[^"]+"\s+"([^"]+\.mjs)"/);
            const legacyFmt = h.command.match(/node\s+"?([^"]+\.mjs)"?/);
            const scriptMatch = newFmt || legacyFmt;
            if (!scriptMatch) return true;
            return existsSync(scriptMatch[1]);
          });
        },
      );

      const removed = entries.length - filtered.length;
      if (removed > 0) {
        hooks[hookType] = filtered;
        changes.push(`Removed ${removed} stale ${hookType} hook(s)`);
      }
    }

    // ── Phase 2: Register fresh hooks ────────────────────
    const hookTypes: Array<{
      name: string;
      script: string;
      matcher: string;
    }> = [
      {
        name: "PreToolUse",
        script: "pretooluse.mjs",
        matcher: [
          "Bash", "WebFetch", "Read", "Grep", "Agent",
          "mcp__context-mode__ctx_execute",
          "mcp__context-mode__ctx_execute_file",
          "mcp__context-mode__ctx_batch_execute",
          EXTERNAL_MCP_MATCHER_PATTERN,
        ].join("|"),
      },
      {
        name: "PostToolUse",
        script: "posttooluse.mjs",
        matcher: "Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|TodoWrite|Agent|AskUserQuestion|mcp__",
      },
      {
        name: "SessionStart",
        script: "sessionstart.mjs",
        matcher: "",
      },
      {
        name: "PreCompact",
        script: "precompact.mjs",
        matcher: "",
      },
      {
        name: "UserPromptSubmit",
        script: "userpromptsubmit.mjs",
        matcher: "",
      },
    ];

    for (const { name, script, matcher } of hookTypes) {
      const entry = {
        matcher,
        hooks: [{ type: "command", command: buildNodeCommand(`${pluginRoot}/hooks/${script}`) }],
      };

      const existing = hooks[name] as Array<Record<string, unknown>> | undefined;
      if (existing && Array.isArray(existing)) {
        const idx = existing.findIndex((e) => {
          const typed = e as { hooks?: Array<{ command?: string }> };
          return typed.hooks?.some(
            (h) => h.command?.includes(script),
          ) ?? false;
        });
        if (idx >= 0) {
          existing[idx] = entry;
          changes.push(`Updated ${name} hook`);
        } else {
          existing.push(entry);
          changes.push(`Added ${name} hook`);
        }
        hooks[name] = existing;
      } else {
        hooks[name] = [entry];
        changes.push(`Created ${name} hooks`);
      }
    }

    settings.hooks = hooks;
    this.writeSettings(settings);
    return changes;
  }

  setHookPermissions(_pluginRoot: string): string[] {
    return [];
  }

  updatePluginRegistry(_pluginRoot: string, _version: string): void {
    // No plugin registry in CodeBuddy
  }

  getRoutingInstructionsConfig() {
    const instructionsPath = resolve(
      join(homedir(), ".codebuddy", "CODEBUDDY.md"),
    );
    return {
      instructionsPath,
      targetPath: "CODEBUDDY.md",
      platformName: "CodeBuddy",
    };
  }

  // ── Session ID extraction (differs from Claude Code) ───
  // CodeBuddy prioritizes session_id field, then CODEBUDDY_SESSION_ID env var.

  protected extractSessionId(input: ClaudeCodeWireInput): string {
    if (input.session_id) return input.session_id;
    if (input.transcript_path) {
      const match = input.transcript_path.match(
        /([a-f0-9-]{36})\.jsonl$/,
      );
      if (match) return match[1];
    }
    if (process.env.CODEBUDDY_SESSION_ID) return process.env.CODEBUDDY_SESSION_ID;
    return `pid-${process.ppid}`;
  }
}
