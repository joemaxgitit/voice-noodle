"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Material, Person, Topic } from "@/lib/training";

/** Everything the Training Hub tabs share. Loaded once by the page. */
export type HubData = {
  supabase: SupabaseClient;
  orgId: string;
  me: string;
  managers: Person[];
  reps: Person[];
  topics: Topic[];
  materials: Material[];
  reloadLibrary: () => Promise<void>;
  personById: (id: string | null | undefined) => Person | undefined;
};

export const HubContext = createContext<HubData | null>(null);

export function useHub(): HubData {
  const h = useContext(HubContext);
  if (!h) throw new Error("useHub outside the Training Hub");
  return h;
}

/** Right-hand slide-out panel. Escape and the close button both call onClose. */
export function Drawer({
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <>
      <div className="tr-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="tr-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="tr-drawer-head">
          <div>
            {eyebrow && <div className="eyebrow" style={{ margin: 0 }}>{eyebrow}</div>}
            <div className="tr-drawer-title">{title}</div>
          </div>
          <button className="tr-x" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="tr-drawer-body">{children}</div>
        {footer && <div className="tr-drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

/** Pick training materials to attach. */
export function MaterialPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { materials } = useHub();
  if (!materials.length) return <p className="hint">No materials in the library yet -- add them on the Library tab.</p>;
  return (
    <div className="tr-checklist">
      {materials.map((m) => (
        <label key={m.id}>
          <input
            type="checkbox"
            checked={value.includes(m.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, m.id] : value.filter((x) => x !== m.id))}
          />
          <span>
            {m.title} <small className="muted">· {m.kind}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Manager picker shown as name chips. */
export function ManagerChips({
  value,
  onChange,
  single,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
}) {
  const { managers } = useHub();
  return (
    <div className="tr-chips" role="group">
      {managers.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            className={on ? "on" : ""}
            onClick={() => onChange(single ? (on ? [] : [m.id]) : on ? value.filter((x) => x !== m.id) : [...value, m.id])}
          >
            {m.full_name || "Unnamed"}
          </button>
        );
      })}
    </div>
  );
}
