import type { ServerDeps, ServerOptions } from "../types.js";
import { type Routes } from "./registry.js";
/**
 * Read a session token from an `Authorization: Bearer <token>` header.
 *
 * DSH Desktop serves the viewer through its own `dsh-app://app` protocol and
 * strips `set-cookie` from every forwarded response (it owns the shell's
 * cookie jar). A cookie-only login therefore succeeds and is then forgotten.
 * The viewer stores the token returned by `/auth/login` and replays it here,
 * which needs no cookie jar at all.
 */
export declare function readAuthHeaderSession(headers: {
    authorization?: string | string[] | undefined;
} | undefined): string | null;
/**
 * Resolve the session token for a request: cookie first (browser / standalone
 * viewer), then the Authorization header (protocol-forwarded embeds).
 */
export declare function readSessionToken(req: {
    headers: {
        cookie?: string | undefined;
        authorization?: string | string[] | undefined;
    };
}, agent: string | null | undefined): string | null;
export interface AuthState {
    version: 1;
    hash: string;
    salt: string;
    sessionSecret: string;
    createdAt: number;
}
/** True when the operator switched password protection off via the toggle. */
export declare function isAuthDisabled(homeDir: string): boolean;
export declare function readAuthState(homeDir: string): AuthState | null;
export declare function verifySession(token: string, state: AuthState): boolean;
export declare function readCookie(header: string | undefined, name: string): string | null;
export declare function registerAuthRoutes(routes: Routes, deps: ServerDeps, options?: ServerOptions): void;
/**
 * Middleware hook — returns true when the request is allowed to
 * proceed, false when it has been answered with 401.
 *
 * Called from `server/http.ts::dispatch` ahead of the route table.
 * Auth endpoints themselves bypass this check (they're what a locked
 * client uses to unlock).
 *
 * `agent` (optional) scopes the cookie name so this server's session
 * doesn't collide with another agent's session sharing the same
 * `localhost` cookie jar (see file header).
 */
export declare function requireSession(req: {
    headers: {
        cookie?: string;
    };
}, res: {
    setHeader: (n: string, v: string | string[]) => void;
    writeHead: (code: number, headers?: Record<string, string>) => void;
    end: (body?: string) => void;
}, homeDir: string, pathname: string, agent?: string | null): boolean;
//# sourceMappingURL=auth.d.ts.map