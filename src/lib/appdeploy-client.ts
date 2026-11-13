// Browser-side replacement for @appdeploy/client: calls the app's own /api routes
// with the Supabase session token, and exposes the auth helpers the screens use.
import { supabase } from "@/integrations/supabase/client";

async function request(method: string, url: string, body?: unknown) {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err: any = new Error(data?.error || `Request failed (${res.status})`);
    err.response = { status: res.status, data };
    throw err;
  }
  return { data, status: res.status };
}

export const api = {
  get: (url: string) => request("GET", url),
  delete: (url: string) => request("DELETE", url),
  post: (url: string, body?: unknown) => request("POST", url, body ?? {}),
  put: (url: string, body?: unknown) => request("PUT", url, body ?? {}),
  patch: (url: string, body?: unknown) => request("PATCH", url, body ?? {}),
};

export const auth = {
  async getUser() {
    const { data } = await supabase.auth.getSession();
    const u = data.session?.user;
    if (!u) return null;
    return { userId: u.id, email: u.email, name: (u.user_metadata?.['full_name'] as string) || u.email };
  },
  async signInWithRedirect() {
    window.location.href = "/auth";
  },
  async signOut() {
    await supabase.auth.signOut();
  },
};
