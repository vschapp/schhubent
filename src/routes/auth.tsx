import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { GraduationCap, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import legacyCss from "@/legacy/legacy.css?url";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — School Hub Enterprise" },
      { name: "description", content: "Sign in or create your School Hub Enterprise account." },
      { property: "og:title", content: "Sign in — School Hub Enterprise" },
      { property: "og:description", content: "Sign in or create your School Hub Enterprise account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "stylesheet", href: legacyCss }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (res.error) return setMsg(res.error.message);
    if (res.data.session) window.location.href = "/";
    else setMsg("Check your email to confirm your account, then sign in.");
  }

  return (
    <main className="auth-gate-screen">
      <section className="auth-gate-card">
        <div className="auth-gate-brand">
          <span><GraduationCap size={24} /></span>
          <div><b>School Hub</b><small>ENTERPRISE</small></div>
        </div>
        <h1>{mode === "in" ? "Welcome back" : "Create your account"}</h1>
        <p>Secure access to your school's academic, administrative and financial workspace.</p>
        <form className="auth-gate-form" onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="auth-gate-primary" disabled={busy} type="submit">
            <LogIn size={18} /> {mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>
        {msg && <div className="auth-gate-error">{msg}</div>}
        <button type="button" className="auth-gate-foot" style={{ background: "none", border: 0, width: "100%", cursor: "pointer" }} onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
