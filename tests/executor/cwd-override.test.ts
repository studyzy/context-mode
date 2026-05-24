import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolyglotExecutor } from "../../src/executor.js";
import { detectRuntimes } from "../../src/runtime.js";

// ─────────────────────────────────────────────────────────
// Issue #45 / c4529042182 — defense-in-depth.
// Even when resolveProjectDir() returns the wrong path (e.g. plugin
// install dir, $HOME, or PWD pre-chdir), the executor must accept an
// explicit cwd override on ExecuteOptions so per-call sites (Codex MCP
// handlers) can pin the shell working directory to the resolved
// project root without mutating process-wide state.
// ─────────────────────────────────────────────────────────

const runtimes = detectRuntimes();

describe("PolyglotExecutor cwd override", () => {
  it("uses explicit cwd over projectRoot for shell language", async () => {
    const realDir = mkdtempSync(join(tmpdir(), "ctx-cwd-real-"));
    const wrongDir = mkdtempSync(join(tmpdir(), "ctx-cwd-wrong-"));

    try {
      const executor = new PolyglotExecutor({
        runtimes,
        projectRoot: () => wrongDir,
      });
      const result = await executor.execute({
        language: "shell",
        code: "pwd",
        cwd: realDir,
      });

      expect(result.exitCode).toBe(0);
      // macOS resolves /var → /private/var, /tmp → /private/tmp — normalize.
      const stdout = result.stdout.trim().replace(/^\/private/, "");
      const expected = realDir.replace(/^\/private/, "");
      expect(stdout).toBe(expected);
    } finally {
      try { rmSync(realDir, { recursive: true, force: true }); } catch {}
      try { rmSync(wrongDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("falls back to projectRoot when cwd is undefined", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ctx-proj-"));

    try {
      const executor = new PolyglotExecutor({
        runtimes,
        projectRoot: () => projectDir,
      });
      const result = await executor.execute({
        language: "shell",
        code: "pwd",
      });

      expect(result.exitCode).toBe(0);
      const stdout = result.stdout.trim().replace(/^\/private/, "");
      const expected = projectDir.replace(/^\/private/, "");
      expect(stdout).toBe(expected);
    } finally {
      try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
    }
  });
});
