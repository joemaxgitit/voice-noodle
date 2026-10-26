"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    // Managers and admins land on the manager home; reps on their training home.
    // A link that sent them here (?next=) still wins.
    let dest = params.get("next") || "/";
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const [{ data: prof }, { data: pw }] = await Promise.all([
        supabase.from("profiles").select("role, active").eq("id", user.id).maybeSingle(),
        // Separate query: an old database without this column must not break sign-in.
        supabase.from("profiles").select("must_change_password").eq("id", user.id).maybeSingle(),
      ]);
      if ((pw as { must_change_password?: boolean } | null)?.must_change_password) dest = "/account?first=1";
      else if (!params.get("next") && prof?.active && ["admin", "manager"].includes(prof.role as string)) dest = "/admin/home";
    }
    router.push(dest);
    router.refresh();
  }

  return (
    <main className="shell">
      <div className="card" style={{ marginTop: "12vh" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/proedge-logo.png"
          alt="ProEdge Solutions"
          className="login-logo dark-only"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/proedge-logo-light.png"
          alt="ProEdge Solutions"
          className="login-logo light-only"
        />

        <div className="eyebrow">Sales script training</div>
        <h1>Sign in</h1>
        <p className="muted">Use your work account.</p>

        <form onSubmit={signIn} style={{ marginTop: 22 }}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button className="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {error && <div className="error">{error}</div>}
        {!error && params.get("timeout") && <div className="note">You were signed out after 30 minutes without activity. Sign in again to pick up where you left off.</div>}

        {/*
          Attribution, deliberately small. The client's brand owns this screen;
          this just says whose tool it is. Matters more once Voice Noodle runs
          for a second organisation.
        */}
        <div className="powered-by">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/voicenoodle-mark-sm.png" alt="" />
          <span>Powered by Voice Noodle</span>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="shell"><p className="muted">Loading…</p></main>}>
      <LoginForm />
    </Suspense>
  );
}
