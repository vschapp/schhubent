// @ts-nocheck -- loose-typed compatibility layer for imported backend
// Compatibility layer: implements the AppDeploy SDK surface used by the imported
// backend on top of Supabase (document table + app_transact RPC + Storage + Auth).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ApiResult = { __apiResult: true; status: number; body: unknown };
export type RouterMiddleware = (ctx: any) => Promise<ApiResult | void | undefined> | ApiResult | void | undefined;

export function json(body: unknown, status = 200): ApiResult {
  return { __apiResult: true, status, body };
}
export function error(message: string, status = 400): ApiResult {
  return json({ error: message }, status);
}

export class AppDatabaseError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}
export function isAppDatabaseError(e: unknown): e is AppDatabaseError {
  return e instanceof AppDatabaseError;
}

const db_ = () => supabaseAdmin as any;
const BUCKET = "app-files";

function clean(record: unknown, patch: boolean): unknown {
  // undefined fields mean "remove" in patch mode
  return JSON.parse(JSON.stringify(record, (_k, v) => (v === undefined ? (patch ? null : undefined) : v)));
}

type Op = { op: "add" | "update" | "delete"; collection: string; items: unknown[]; patch?: boolean };

async function runOps(ops: Op[]) {
  if (!ops.length) return;
  const { error: e } = await db_().rpc("app_transact", { ops });
  if (e) {
    const msg = String(e.message || "");
    const code = ["AppDatabaseDuplicateId", "AppDatabaseConditionFailed"].find((c) => msg.includes(c));
    throw new AppDatabaseError(code || "AppDatabaseUnknownOutcome", msg);
  }
}

const tx = {
  add(collection: string, items: any[]): Op {
    return { op: "add", collection, items: items.map((i) => clean(i, false) as any) };
  },
  update(collection: string, items: any[], options: { patch?: boolean } = {}): Op {
    const patch = Boolean(options.patch);
    return {
      op: "update",
      collection,
      patch,
      items: items.map((i) => ({ id: String(i.id), ...(i.if ? { if: clean(i.if, true) } : {}), record: clean(i.record ?? {}, patch) })),
    };
  },
  delete(collection: string, ids: string[]): Op {
    return { op: "delete", collection, items: ids.map(String) };
  },
};

export const db = {
  tx,
  async transact(ops: Op[]) {
    await runOps(ops.filter(Boolean));
  },
  async add(collection: string, items: any[]) {
    await runOps([tx.add(collection, items)]);
  },
  async delete(collection: string, ids: string[]) {
    await runOps([tx.delete(collection, ids)]);
  },
  async get<T = any>(collection: string, ids: string[], _o?: unknown): Promise<(T | undefined)[]> {
    const list = ids.map(String).filter(Boolean);
    if (!list.length) return ids.map(() => undefined);
    const { data, error: e } = await db_().from("app_documents").select("id,data").eq("collection", collection).in("id", list);
    if (e) throw new AppDatabaseError("AppDatabaseUnknownOutcome", e.message);
    const map = new Map((data || []).map((r: any) => [r.id, r.data]));
    return ids.map((id) => map.get(String(id)) as T | undefined);
  },
  async list<T = any>(collection: string, options: { limit?: number; nextToken?: string } = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000);
    const offset = options.nextToken ? Math.max(0, Number(atob(String(options.nextToken))) || 0) : 0;
    const { data, error: e } = await db_()
      .from("app_documents")
      .select("data")
      .eq("collection", collection)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + limit);
    if (e) throw new AppDatabaseError("AppDatabaseUnknownOutcome", e.message);
    const rows = (data || []).map((r: any) => r.data as T);
    const more = rows.length > limit;
    return { items: rows.slice(0, limit), nextToken: more ? btoa(String(offset + limit)) : undefined };
  },
};

export const storage = {
  async write(files: { path: string; content: string; contentType: string }[]) {
    return Promise.all(
      files.map(async (f) => {
        const bytes = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
        const { error: e } = await db_().storage.from(BUCKET).upload(f.path, bytes, { contentType: f.contentType, upsert: false });
        return e ? null : { path: f.path };
      }),
    );
  },
  async url(paths: string[]) {
    return Promise.all(
      paths.map(async (p) => {
        const { data } = await db_().storage.from(BUCKET).createSignedUrl(p, 600);
        return data?.signedUrl ? { path: p, url: data.signedUrl } : null;
      }),
    );
  },
  async delete(paths: string[]) {
    const { error: e } = await db_().storage.from(BUCKET).remove(paths);
    return paths.map(() => !e);
  },
};

// Realtime push is not wired up; subscribers poll instead.
export const ws = { async send(_ids: string[], _msg: unknown) {} };

export function requireAuth(): RouterMiddleware {
  return async (ctx) => {
    const header = String(ctx.event?.headers?.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return error("Authentication required", 401);
    const { data, error: e } = await db_().auth.getUser(token);
    if (e || !data?.user) return error("Authentication required", 401);
    const u = data.user;
    ctx.user = { userId: u.id, email: u.email, name: u.user_metadata?.full_name || u.user_metadata?.name || u.email };
  };
}

type Compiled = { method: string; parts: string[]; chain: RouterMiddleware[] };
export function router(routes: Record<string, RouterMiddleware[]>) {
  const compiled: Compiled[] = Object.entries(routes).map(([key, chain]) => {
    const [method, path] = key.split(" ");
    return { method, parts: path.split("/").filter(Boolean), chain };
  });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method.toUpperCase();
    let match: { r: Compiled; params: Record<string, string> } | null = null;
    let score = -1;
    for (const r of compiled) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true, s = 0;
      r.parts.forEach((p, i) => {
        if (p.startsWith(":")) params[p.slice(1)] = segs[i];
        else if (p === segs[i]) s++;
        else ok = false;
      });
      if (ok && s > score) { match = { r, params }; score = s; }
    }
    const send = (res: ApiResult) =>
      new Response(JSON.stringify(res.body ?? null), { status: res.status, headers: { "content-type": "application/json" } });
    if (!match) return send(error("Not found", 404));
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    headers.host = url.host;
    headers["x-forwarded-proto"] = url.protocol.replace(":", "");
    let body: unknown = undefined;
    if (!["GET", "HEAD"].includes(method)) {
      const text = await request.text();
      try { body = text ? JSON.parse(text) : undefined; } catch { return send(error("Invalid JSON body", 400)); }
    }
    const ctx: any = {
      params: match.params,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      event: { headers, httpMethod: method, requestContext: { http: { method }, domainName: url.host } },
    };
    for (const mw of match.r.chain) {
      const out = await mw(ctx);
      if (out && (out as ApiResult).__apiResult) return send(out as ApiResult);
    }
    return send(json(null, 204));
  };
}
