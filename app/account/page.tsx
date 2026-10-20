"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import FeatureToggles from "./FeatureToggles";

/** Change your own password. Also where a temporary password sends you on sign-in. */
function AccountForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const first = useSearchParams().get("first") === "1";
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? ""));
  }, [supabase]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Use at least 8 characters.");
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      return setError(/same/i.test(error.message) ? "That's your current password -- pick a new one." : error.message);
    }
    await supabase.rpc("password_changed");
    setBusy(false);
    setDone(true);
    setPw("");
    setPw2("");
    if (first) setTimeout(() => router.replace("/"), 1200);
  }

  return (
    <main className="shell" style={{ maxWidth: 520 }}>
      {!first && (
        <div className="topbar">
          <Link className="btn" href="/" style={{ textDecoration: "none" }}>
            &larr; Back
          </Link>
        </div>
      )}
      <div className="eyebrow">Account</div>
      <h1>{first ? "Choose your password" : "Account"}</h1>
      {first && <p className="muted">You signed in with a temporary password. Pick your own to continue.</p>}
      {email && <p className="muted">Signed in as {email}</p>}

      {/* username field lets phones save the new password against the right account */}
      <form className="card" onSubmit={save} style={{ display: "grid", gap: 12 }}>
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <label className="field" style={{ margin: 0 }}>
          <span className="label">New password</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="label">Type it again</span>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required />
        </label>
        <p className="hint" style={{ margin: 0 }}>
          At least 8 characters. On your phone, tap &ldquo;Save password&rdquo; when it asks &mdash; next time you can sign in with Face ID or your fingerprint.
        </p>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
        {error && <div className="error">{error}</div>}
        {done && <div className="status">Password changed.{first ? " Taking you in…" : ""}</div>}
      </form>
      {!first && <FeatureToggles supabase={supabase} />}
    </main>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountForm />
    </Suspense>
  );
}
