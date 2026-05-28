import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { buildRebuildEnv, rebuildBetterSqlite3 } from "../src/storage/rebuild-native";

describe("rebuild-native — pin to current Node binary (Issue #1734)", () => {
  describe("buildRebuildEnv", () => {
    it("prepends dirname(execPath) to PATH so child processes resolve the same node", () => {
      const env = buildRebuildEnv(
        "/opt/homebrew/Cellar/node/25.9.0/bin/node",
        { PATH: "/usr/local/bin:/usr/bin" },
        ":",
      );

      expect(env.PATH).toBe("/opt/homebrew/Cellar/node/25.9.0/bin:/usr/local/bin:/usr/bin");
    });

    it("sets npm_node_execpath and NODE so npm + node-gyp pick the right binary", () => {
      const exec = "/Users/dev/.nvm/versions/node/v22.10.0/bin/node";
      const env = buildRebuildEnv(exec, { PATH: "/anything" }, ":");

      expect(env.npm_node_execpath).toBe(exec);
      expect(env.NODE).toBe(exec);
    });

    it("preserves other environment variables", () => {
      const env = buildRebuildEnv(
        "/usr/local/bin/node",
        { PATH: "/usr/bin", HOME: "/home/dev", LANG: "en_US.UTF-8" },
        ":",
      );

      expect(env.HOME).toBe("/home/dev");
      expect(env.LANG).toBe("en_US.UTF-8");
    });

    it("handles empty PATH gracefully", () => {
      const env = buildRebuildEnv("/usr/local/bin/node", {}, ":");
      expect(env.PATH).toBe("/usr/local/bin");
    });

    it("falls back to Path / path keys when PATH is missing (Windows-ish env shape)", () => {
      const env = buildRebuildEnv(
        "C:\\Program Files\\nodejs\\node.exe",
        { Path: "C:\\Windows\\System32" },
        ";",
      );

      // The exec directory should be prepended to whatever PATH-like key existed.
      expect(env.PATH).toBe(`${path.dirname("C:\\Program Files\\nodejs\\node.exe")};C:\\Windows\\System32`);
      expect(env.npm_node_execpath).toBe("C:\\Program Files\\nodejs\\node.exe");
    });
  });

  describe("rebuildBetterSqlite3", () => {
    it("invokes npm with the pinned env and the better-sqlite3 rebuild args", () => {
      const spawnSync = vi.fn().mockReturnValue({
        status: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = rebuildBetterSqlite3({
        pluginDir: "/plugins/memos",
        execPath: "/opt/homebrew/Cellar/node/25.9.0/bin/node",
        baseEnv: { PATH: "/usr/bin" },
        spawnSyncImpl: spawnSync as any,
        npmCmd: "npm",
      });

      expect(spawnSync).toHaveBeenCalledOnce();
      const [command, args, options] = spawnSync.mock.calls[0];

      expect(command).toBe("npm");
      expect(args).toEqual(["rebuild", "better-sqlite3"]);
      expect(options?.cwd).toBe("/plugins/memos");
      expect(options?.stdio).toBe("pipe");
      expect(options?.shell).toBe(false);
      expect(options?.timeout).toBe(180_000);

      const env = options?.env as NodeJS.ProcessEnv;
      expect(env.npm_node_execpath).toBe("/opt/homebrew/Cellar/node/25.9.0/bin/node");
      expect(env.NODE).toBe("/opt/homebrew/Cellar/node/25.9.0/bin/node");
      expect(env.PATH?.startsWith("/opt/homebrew/Cellar/node/25.9.0/bin")).toBe(true);
      expect(env.PATH).toContain("/usr/bin");

      expect(result.status).toBe(0);
    });

    it("honors timeoutMs override", () => {
      const spawnSync = vi.fn().mockReturnValue({
        status: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
        pid: 0,
        output: [],
        signal: null,
      });

      rebuildBetterSqlite3({
        pluginDir: "/p",
        execPath: "/usr/bin/node",
        baseEnv: { PATH: "/usr/bin" },
        spawnSyncImpl: spawnSync as any,
        timeoutMs: 60_000,
      });

      expect(spawnSync.mock.calls[0][2]?.timeout).toBe(60_000);
    });

    it("uses npm.cmd on Windows by default", () => {
      const spawnSync = vi.fn().mockReturnValue({
        status: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
        pid: 0,
        output: [],
        signal: null,
      });

      rebuildBetterSqlite3({
        pluginDir: "/p",
        execPath: "/usr/bin/node",
        baseEnv: { PATH: "/usr/bin" },
        spawnSyncImpl: spawnSync as any,
        npmCmd: "npm.cmd",
      });

      expect(spawnSync.mock.calls[0][0]).toBe("npm.cmd");
    });

    it("propagates non-zero exit status from spawnSync", () => {
      const spawnSync = vi.fn().mockReturnValue({
        status: 1,
        stdout: Buffer.from(""),
        stderr: Buffer.from("node-gyp: command not found"),
        pid: 0,
        output: [],
        signal: null,
      });

      const result = rebuildBetterSqlite3({
        pluginDir: "/p",
        execPath: "/usr/bin/node",
        baseEnv: { PATH: "/usr/bin" },
        spawnSyncImpl: spawnSync as any,
      });

      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toContain("node-gyp: command not found");
    });
  });
});
