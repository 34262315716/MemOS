/**
 * Ambient type shim for the `openclaw/plugin-sdk` virtual module.
 *
 * OpenClaw injects this module at plugin load time; it is not a real npm
 * package. Without this declaration, `tsc` cannot resolve the `import type`
 * statement in `index.ts` and the published `dist/` build fails.
 *
 * Types are intentionally permissive (`any`) — the runtime contract lives in
 * OpenClaw itself, and this shim only exists so `tsc` emits compiled JS for
 * the published npm package (see bug #1619: dist/ shipping).
 */
declare module "openclaw/plugin-sdk" {
  /** Factory form used by tools that need access to a per-call context. */
  export type OpenClawToolFactory = (context: any) => Record<string, any>;
  /** Direct form used by tools that don't need the context. */
  export type OpenClawToolDefinition = Record<string, any>;

  export interface OpenClawPluginApi {
    /**
     * Register a tool. Accepts either a tool object directly, or a factory
     * `(context) => tool` invoked per call. The optional second argument is a
     * dedup/name hint used by some host versions when the first argument is a
     * factory.
     */
    registerTool(
      toolOrFactory: OpenClawToolDefinition | OpenClawToolFactory,
      options?: { name?: string } & Record<string, any>,
    ): void;
    registerHook(...args: any[]): void;
    registerMemoryCapability(...args: any[]): void;
    getConfig?(): any;
    getLogger?(): any;
    logger?: any;
    log?: any;
    config?: any;
    [key: string]: any;
  }

  export type ToolContext = any;
}
