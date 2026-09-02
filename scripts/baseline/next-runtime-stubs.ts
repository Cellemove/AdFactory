// Makes the app's real server code runnable from a plain `tsx` script, so the
// baseline measures the pipeline instead of a copy of it.
//
// Three Next-only things stand between a node script and src/app/actions/*:
//   1. `import "server-only"` — the package is not installed at the top level
//      (only next/dist/compiled/server-only), so resolution fails outright.
//   2. `revalidatePath()` — throws without a static generation store.
//   3. `cookies()` from next/headers — throws outside a request, and every
//      strategist action goes through it via requireStrategist().
//
// All three are cleared by patching CommonJS `Module._load`. It has to be _load
// rather than a `module.register()` ESM hook or `_resolveFilename`:
//   - package.json has no "type": "module", so tsx transpiles to CJS and ESM
//     resolve hooks are never consulted;
//   - `module.registerHooks()` (the sync API that does cover CJS) only exists
//     from Node 22.15, and this repo runs 22.13;
//   - `server-only` has no file on disk, and _resolveFilename must return a real
//     path, whereas _load can hand back an exports object directly.
// Short-circuiting inside _load also means tsx's own resolver is never asked
// about the stubbed names, so the patch composes with it rather than racing it.
//
// This file must import NOTHING from src/ — anything it pulled in would load
// before the patch is installed, which is the exact failure it exists to prevent.

import Module from "node:module";

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;

// Duplicated from @/lib/session on purpose; see the no-src/ rule above.
const SESSION_COOKIE = "cm_session";

let sessionToken: string | null = null;
const revalidationLog: string[] = [];

/** Set the signed session the stubbed `cookies()` will hand to getSessionUser(). */
export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

/** Paths/tags the real code asked to revalidate. Proof the actions ran to the end. */
export function getRevalidationLog(): readonly string[] {
  return [...revalidationLog];
}

const cookieStore = {
  get(name: string): { name: string; value: string } | undefined {
    return name === SESSION_COOKIE && sessionToken ? { name, value: sessionToken } : undefined;
  },
  getAll(): Array<{ name: string; value: string }> {
    return sessionToken ? [{ name: SESSION_COOKIE, value: sessionToken }] : [];
  },
  has(name: string): boolean {
    return name === SESSION_COOKIE && sessionToken !== null;
  },
  set(): void {},
  delete(): void {},
};

function redirectStub(url: string): never {
  const error = new Error(`NEXT_REDIRECT ${url}`);
  (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw error;
}

// `__esModule: true` keeps TypeScript's interop helpers from wrapping these in a
// synthetic default when a consumer uses `import * as` or a default import.
const STUBS: Readonly<Record<string, Record<string, unknown>>> = {
  "server-only": { __esModule: true },
  "client-only": { __esModule: true },
  "next/cache": {
    __esModule: true,
    revalidatePath: (path: string) => { revalidationLog.push(path); },
    revalidateTag: (tag: string) => { revalidationLog.push(`tag:${tag}`); },
    unstable_cache: <T>(fn: T): T => fn,
    unstable_noStore: () => {},
  },
  "next/headers": {
    __esModule: true,
    // Async: Next 15 awaits cookies(), and so does @/lib/auth.
    cookies: async () => cookieStore,
    headers: async () => new Headers(),
    draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
  },
  "next/navigation": {
    __esModule: true,
    redirect: redirectStub,
    permanentRedirect: redirectStub,
    notFound: (): never => { throw new Error("NEXT_NOT_FOUND"); },
  },
};

interface PatchableModule {
  _load: ModuleLoad;
  __baselineStubsInstalled?: boolean;
}

const internals = Module as unknown as PatchableModule;

if (!internals.__baselineStubsInstalled) {
  const originalLoad = internals._load;
  internals._load = function patchedLoad(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  internals.__baselineStubsInstalled = true;
}
