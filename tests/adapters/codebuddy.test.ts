import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CodeBuddyAdapter } from "../../src/adapters/codebuddy/index.js";

describe("CodeBuddyAdapter", () => {
  let adapter: CodeBuddyAdapter;

  beforeEach(() => {
    adapter = new CodeBuddyAdapter();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Capabilities ────────────────────────────────────────

  it("has correct name and paradigm", () => {
    expect(adapter.name).toBe("CodeBuddy");
    expect(adapter.paradigm).toBe("json-stdio");
  });

  it("declares full capabilities", () => {
    expect(adapter.capabilities).toEqual({
      preToolUse: true,
      postToolUse: true,
      preCompact: true,
      sessionStart: true,
      canModifyArgs: true,
      canModifyOutput: true,
      canInjectSessionContext: true,
    });
  });

  // ── parsePreToolUseInput ────────────────────────────────

  describe("parsePreToolUseInput", () => {
    it("extracts tool_name and tool_input", () => {
      const result = adapter.parsePreToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
      });
      expect(result.toolName).toBe("Bash");
      expect(result.toolInput).toEqual({ command: "ls" });
    });

    it("extracts sessionId from session_id field", () => {
      const result = adapter.parsePreToolUseInput({
        tool_name: "Read",
        session_id: "abc-123",
      });
      expect(result.sessionId).toBe("abc-123");
    });

    it("extracts sessionId from transcript_path UUID", () => {
      const result = adapter.parsePreToolUseInput({
        tool_name: "Read",
        transcript_path: "/tmp/sessions/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl",
      });
      expect(result.sessionId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("falls back to CODEBUDDY_SESSION_ID env", () => {
      vi.stubEnv("CODEBUDDY_SESSION_ID", "env-session-42");
      const result = adapter.parsePreToolUseInput({
        tool_name: "Read",
      });
      expect(result.sessionId).toBe("env-session-42");
    });

    it("falls back to pid-based sessionId", () => {
      const result = adapter.parsePreToolUseInput({
        tool_name: "Read",
      });
      expect(result.sessionId).toMatch(/^pid-\d+$/);
    });

    it("extracts projectDir from CODEBUDDY_PROJECT_DIR env", () => {
      vi.stubEnv("CODEBUDDY_PROJECT_DIR", "/home/user/project");
      const result = adapter.parsePreToolUseInput({
        tool_name: "Read",
      });
      expect(result.projectDir).toBe("/home/user/project");
    });
  });

  // ── formatPreToolUseResponse ────────────────────────────

  describe("formatPreToolUseResponse", () => {
    it("formats deny decision", () => {
      const result = adapter.formatPreToolUseResponse({
        decision: "deny",
        reason: "Blocked by routing",
      });
      expect(result).toEqual({
        permissionDecision: "deny",
        reason: "Blocked by routing",
      });
    });

    it("formats modify decision", () => {
      const result = adapter.formatPreToolUseResponse({
        decision: "modify",
        updatedInput: { command: "echo hello" },
      });
      expect(result).toEqual({
        updatedInput: { command: "echo hello" },
      });
    });

    it("returns undefined for allow", () => {
      const result = adapter.formatPreToolUseResponse({
        decision: "allow",
      });
      expect(result).toBeUndefined();
    });
  });

  // ── formatPostToolUseResponse ───────────────────────────

  describe("formatPostToolUseResponse", () => {
    it("formats additionalContext", () => {
      const result = adapter.formatPostToolUseResponse({
        additionalContext: "Session event captured",
      });
      expect(result).toEqual({
        additionalContext: "Session event captured",
      });
    });

    it("returns undefined when no content", () => {
      const result = adapter.formatPostToolUseResponse({});
      expect(result).toBeUndefined();
    });
  });

  // ── Config paths ────────────────────────────────────────

  describe("configuration", () => {
    it("settings path is ~/.codebuddy/settings.json", () => {
      const path = adapter.getSettingsPath();
      expect(path).toMatch(/\.codebuddy[/\\]settings\.json$/);
    });

    it("instruction files returns CODEBUDDY.md", () => {
      expect(adapter.getInstructionFiles()).toEqual(["CODEBUDDY.md"]);
    });

    it("getRoutingInstructionsConfig returns correct paths", () => {
      const config = adapter.getRoutingInstructionsConfig();
      expect(config.targetPath).toBe("CODEBUDDY.md");
      expect(config.platformName).toBe("CodeBuddy");
      expect(config.instructionsPath).toMatch(/\.codebuddy[/\\]CODEBUDDY\.md$/);
    });
  });

  // ── generateHookConfig ──────────────────────────────────

  describe("generateHookConfig", () => {
    it("returns all 5 hook types", () => {
      const config = adapter.generateHookConfig("/opt/context-mode");
      expect(Object.keys(config)).toEqual(
        expect.arrayContaining(["PreToolUse", "PostToolUse", "SessionStart", "PreCompact", "UserPromptSubmit"]),
      );
    });

    it("PreToolUse matcher includes Bash, WebFetch, Read, Grep, Agent, and MCP patterns", () => {
      const config = adapter.generateHookConfig("/opt/context-mode");
      const matcher = config.PreToolUse[0].matcher;
      expect(matcher).toContain("Bash");
      expect(matcher).toContain("WebFetch");
      expect(matcher).toContain("Read");
      expect(matcher).toContain("Grep");
      expect(matcher).toContain("Agent");
      expect(matcher).toContain("mcp__context-mode__ctx_execute");
      expect(matcher).toContain("mcp__(?!.*context-mode)");
    });
  });

  // ── parseSessionStartInput ──────────────────────────────

  describe("parseSessionStartInput", () => {
    it("parses source field", () => {
      const result = adapter.parseSessionStartInput!({
        source: "resume",
        session_id: "test-session",
      });
      expect(result.source).toBe("resume");
      expect(result.sessionId).toBe("test-session");
    });
  });
});
