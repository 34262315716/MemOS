import * as path from "path";
import type { SpawnSyncOptions, SpawnSyncReturns } from "child_process";

/**
 * Build the spawn environment used to rebuild `better-sqlite3` against the
 * *current* Node binary (`process.execPath`).
 *
 * Issue #1734: when the OpenClaw Gateway runs under a different Node version
 * than the one used at `npm install` time, `npm rebuild better-sqlite3`
 * resolved through a plain PATH lookup may pick up yet another Node binary
 * (Homebrew, nvm, system) and compile the binding against the wrong ABI,
 * recreating the original `NODE_MODULE_VERSION` mismatch.
 *
 * The fix is to pin every Node-resolving lookup inside the child process to
 * the binary that is actually loading the module right now:
 *
 *  - `npm_node_execpath` / `NODE` are honored by npm and node-gyp to choose
 *    which Node executable (and matching headers) to use for the compile.
 *  - Prepending `dirname(process.execPath)` to `PATH` makes sure any shell
 *    script that calls `node` (npm wrappers, node-gyp helpers, …) finds the
 *    same binary first.
 */
export function buildRebuildEnv(
  execPath: string = process.execPath,
  baseEnv: NodeJS.ProcessEnv = process.env,
  pathSeparator: string = path.delimiter,
): NodeJS.ProcessEnv {
  const execDir = path.dirname(execPath);
  const existingPath = baseEnv.PATH ?? baseEnv.Path ?? baseEnv.path ?? "";
  const pinnedPath = existingPath
    ? `${execDir}${pathSeparator}${existingPath}`
    : execDir;

  return {
    ...baseEnv,
    PATH: pinnedPath,
    npm_node_execpath: execPath,
    NODE: execPath,
  };
}

export interface RebuildOptions {
  /** Plugin directory passed as `cwd` to `npm rebuild better-sqlite3`. */
  pluginDir: string;
  /** Override the Node binary (defaults to `process.execPath`). */
  execPath?: string;
  /** Override `process.env` (used by tests). */
  baseEnv?: NodeJS.ProcessEnv;
  /** Inject `spawnSync` (used by tests). */
  spawnSyncImpl?: (
    command: string,
    args: readonly string[],
    options?: SpawnSyncOptions,
  ) => SpawnSyncReturns<Buffer>;
  /** Timeout in milliseconds (default 180s, matches the previous behavior). */
  timeoutMs?: number;
  /** npm executable name (defaults to platform-appropriate). */
  npmCmd?: string;
}

/**
 * Run `npm rebuild better-sqlite3` with the pinned environment from
 * {@link buildRebuildEnv}. Returns the raw `spawnSync` result so callers can
 * inspect status/stdout/stderr.
 */
export function rebuildBetterSqlite3(opts: RebuildOptions): SpawnSyncReturns<Buffer> {
  const execPath = opts.execPath ?? process.execPath;
  const baseEnv = opts.baseEnv ?? process.env;
  const npmCmd = opts.npmCmd ?? (process.platform === "win32" ? "npm.cmd" : "npm");
  const env = buildRebuildEnv(execPath, baseEnv);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const spawnSync = opts.spawnSyncImpl ?? (require("child_process") as typeof import("child_process")).spawnSync;

  return spawnSync(npmCmd, ["rebuild", "better-sqlite3"], {
    cwd: opts.pluginDir,
    stdio: "pipe",
    shell: false,
    timeout: opts.timeoutMs ?? 180_000,
    env,
  });
}
