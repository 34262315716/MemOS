import { existsSync, mkdirSync, copyFileSync } from "fs";
import path from "path";
import { createRequire } from "module";
import { rebuildBetterSqlite3 } from "./rebuild-native";

/**
 * Ensure the better-sqlite3 native binary is available.
 *
 * OpenClaw installs plugins with `--ignore-scripts`, which skips
 * the native compilation step. This function checks for the binary
 * and restores it from bundled prebuilds if missing.
 *
 * If we have to fall back to `npm rebuild`, the rebuild is pinned to
 * `process.execPath` (the Gateway's current Node binary) via
 * {@link rebuildBetterSqlite3} so it cannot pick up a different Node
 * version from PATH and recreate the ABI mismatch (Issue #1734).
 */
export function ensureSqliteBinding(log?: { info: (msg: string) => void; warn: (msg: string) => void }): void {
  const _req = typeof require !== "undefined" ? require : createRequire(__filename);
  const bsqlPkg = _req.resolve("better-sqlite3/package.json");
  const bsqlDir = path.dirname(bsqlPkg);
  const bindingPath = path.join(bsqlDir, "build", "Release", "better_sqlite3.node");

  if (existsSync(bindingPath)) return;

  const platform = `${process.platform}-${process.arch}`;
  const pluginRoot = path.resolve(__dirname, "..", "..");
  const prebuildSrc = path.join(pluginRoot, "prebuilds", platform, "better_sqlite3.node");

  if (existsSync(prebuildSrc)) {
    log?.info(`[ensure-binding] Copying prebuild for ${platform}...`);
    mkdirSync(path.dirname(bindingPath), { recursive: true });
    copyFileSync(prebuildSrc, bindingPath);
    log?.info(`[ensure-binding] Prebuild installed successfully.`);
    return;
  }

  log?.warn(
    `[ensure-binding] No prebuild for ${platform}, attempting npm rebuild ` +
    `(pinned to Node ${process.version} at ${process.execPath})...`,
  );
  try {
    const installDir = path.resolve(bsqlDir, "..", "..");
    const result = rebuildBetterSqlite3({ pluginDir: installDir });
    if (result.status === 0 && existsSync(bindingPath)) {
      log?.info(`[ensure-binding] Rebuilt better-sqlite3 successfully.`);
      return;
    }
    if (result.status !== 0) {
      log?.warn(`[ensure-binding] npm rebuild exited with code ${result.status}.`);
    }
  } catch { /* fall through */ }

  throw new Error(
    `better-sqlite3 native binary not found for ${platform}.\n` +
    `Prebuild not bundled and npm rebuild (under Node ${process.version}) failed.\n` +
    `Fix: cd ${path.resolve(bsqlDir, "..", "..")} && ${process.execPath} $(command -v npm) rebuild better-sqlite3`,
  );
}
