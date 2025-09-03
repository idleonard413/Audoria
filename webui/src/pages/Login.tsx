
import React from "react";
import { auth } from "../auth/store";

export default function Login({ addonBase, onAuthed }:{ addonBase: string; onAuthed: ()=>void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<"login"|"register">("login");
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      const ep = mode === "login" ? "/auth/login" : "/auth/register";
      const r = await fetch(`${addonBase}${ep}`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Failed"); return; }
      auth.token = j.token;
      onAuthed();
    } catch (e:any) {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
        {err ? <div className="err">{err}</div> : null}
        <label>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
        <button disabled={loading}>{loading ? "Please wait…" : (mode === "login" ? "Sign in" : "Register")}</button>
        <div className="muted" style={{marginTop:10}}>
          {mode === "login" ? (
            <>No account? <a onClick={()=>setMode("register")}>Register</a></>
          ) : (
            <>Have an account? <a onClick={()=>setMode("login")}>Sign in</a></>
          )}
        </div>
      </form>
    </div>
  );
}
