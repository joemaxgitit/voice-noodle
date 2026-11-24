"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

/*
  The client's phone number on this call. Filled in from the file name when
  it has one; typed here when it doesn't (inbound recordings are saved as
  recording-<code>.mp3). It's what links the call to that client's calls in
  every department (supabase/call-phone.sql).
*/
export default function PhoneField({ supabase, callId, onSaved }: { supabase: ReturnType<typeof createClient>; callId: string; onSaved: () => void }) {
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void supabase
      .from("calls")
      .select("phone")
      .eq("id", callId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setPhone(undefined);
        const p = (data as { phone?: string | null } | null)?.phone ?? null;
        setPhone(p);
        setDraft(p ?? "");
      });
  }, [supabase, callId]);

  if (phone === undefined) return null;

  const digits = draft.replace(/\D/g, "").slice(-10);
  async function save() {
    if (draft.trim() && digits.length !== 10) return setMsg("Enter the 10-digit number.");
    const { error } = await supabase.from("calls").update({ phone: digits || null }).eq("id", callId);
    if (error) return setMsg(error.message);
    setPhone(digits || null);
    setMsg(digits ? "Saved -- linked to every call with this number." : "Removed.");
    onSaved();
  }

  return (
    <>
      <label className="field" style={{ maxWidth: 360 }}>
        <span>Client phone</span>
        <div className="row" style={{ gap: 8 }}>
          <input value={draft} inputMode="tel" placeholder="(541) 555-1234" onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
          {(digits || "") !== (phone ?? "") && (
            <button className="primary" onClick={save}>
              Save
            </button>
          )}
        </div>
      </label>
      <p className="muted" style={{ marginTop: -6 }}>
        {msg || (phone ? "Read from the file name. It links this call to the client's calls in every department." : "Not in the file name. Type it to link this call to the client's calls in every department.")}
      </p>
    </>
  );
}
