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

    router.push(params.get("next") || "/");
    router.refresh();
  }

  return (
    <main className="shell">
      <div className="card" style={{ marginTop: "12vh" }}>
        {/*
          ProEdge is the company, Lionside and Bolton are the two sides of the
          operation. Whoever signs in sees only their own script afterwards,
          so this is the one place all three belong together.
        */}
        <div className="login-logos">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/proedge-logo.png" alt="ProEdge Solutions" className="ll-pro" />
          <span className="ll-rule" aria-hidden="true" />
          <div className="ll-pair">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lionside-logo.png" alt="Lionside Financial" className="ll-lion" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bolton-logo.png" alt="Bolton Service Group" className="ll-bolton" />
          </div>
        </div>

        <div className="eyebrow">Sales script training</div>
        <h1>Voice Noodle</h1>
        <p className="muted">Sign in with your work account.</p>

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
