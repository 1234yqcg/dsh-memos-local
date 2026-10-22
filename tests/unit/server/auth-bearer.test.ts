/**
 * Bearer token auth fallback for DSH desktop protocol forwarding.
 *
 * DSH desktop strips `Set-Cookie` from upstream responses when forwarding
 * via the `dsh-app://app` protocol. This test verifies that after login,
 * the client can use the returned token as a Bearer auth header and still
 * be accepted — mirroring the viewer-proxy localStorage persistence path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHttpServer } from "../../../server/index.js";
import type { ServerHandle } from "../../../server/index.js";
import type { MemoryCore } from "../../../agent-contract/memory-core.js";

function stubCore(): MemoryCore {
  const noop = vi.fn(async () => ({}) as never);
  return new Proxy({} as MemoryCore, { get: () => noop });
}

describe("Bearer token auth fallback (DSH desktop)", () => {
  let tmpRoots: string[] = [];
  let handles: ServerHandle[] = [];
  let home = "";
  let handle!: ServerHandle;

  beforeEach(async () => {
    tmpRoots = [];
    handles = [];
    home = mkdtempSync(join(tmpdir(), "memos-bearer-auth-"));
    tmpRoots.push(home);
    handle = await startHttpServer(
      { core: stubCore(), home: { root: home } },
      { port: 0, agent: "deepseek-harness" },
    );
    handles.push(handle);
  });

  afterEach(async () => {
    for (const h of handles) {
      try { await h.close(); } catch { /* ignore */ }
    }
    for (const r of tmpRoots) {
      try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  async function setup(password: string): Promise<Response> {
    return fetch(`${handle.url}/api/v1/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
  }

  async function login(password: string): Promise<{ status: number; json: () => Promise<unknown> }> {
    const res = await fetch(`${handle.url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const json = () => res.json() as Promise<unknown>;
    return { status: res.status, json };
  }

  it("setup response includes ok + token fields", async () => {
    const res = await setup("secret");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, token: expect.any(String) });
    expect(typeof body.token).toBe("string");
    expect((body.token as string).length).toBeGreaterThan(0);
  });

  it("login response includes ok + token fields", async () => {
    await setup("secret");
    const { status, json } = await login("secret");
    expect(status).toBe(200);
    const body = (await json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, token: expect.any(String) });
  });

  it("bearer token is accepted where cookie-only would fail", async () => {
    await setup("secret");
    const { json } = await login("secret");
    const body = (await json()) as Record<string, unknown>;
    const token = body.token as string;
    expect(token).toBeTruthy();

    // Without any cookie, /ping should 401.
    const noAuth = await fetch(`${handle.url}/api/v1/ping`);
    expect(noAuth.status).toBe(401);

    // With Bearer token, /ping should 200.
    const withBearer = await fetch(`${handle.url}/api/v1/ping`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(withBearer.status).toBe(200);

    // Status endpoint confirms authentication via bearer.
    const status = await fetch(`${handle.url}/api/v1/auth/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.status).toBe(200);
    const st = (await status.json()) as { authenticated: boolean };
    expect(st.authenticated).toBe(true);
  });

  it("cookie takes priority over bearer (both provided)", async () => {
    await setup("secret");
    // Login via cookie path to get a cookie.
    const loginRes = await fetch(`${handle.url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    });
    expect(loginRes.status).toBe(200);

    // Fake a Bearer token that is NOT a valid session token.
    const fakeBearer = await fetch(`${handle.url}/api/v1/ping`, {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(fakeBearer.status).toBe(401);

    // Provide a valid cookie but also a fake bearer — cookie path wins.
    const raw = loginRes.headers.get("set-cookie");
    expect(raw).toBeTruthy();
    const cookieReq = await fetch(`${handle.url}/api/v1/ping`, {
      headers: {
        cookie: raw!,
        authorization: "Bearer not-a-real-token",
      },
    });
    expect(cookieReq.status).toBe(200);
  });

  it("malformed bearer header is rejected", async () => {
    await setup("secret");
    const bad = await fetch(`${handle.url}/api/v1/ping`, {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(bad.status).toBe(401);
  });
});