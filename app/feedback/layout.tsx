import type { ReactNode } from "react";
import RepShell from "../RepShell";

/** Rep pages sit inside the rep menu. */
export default function Layout({ children }: { children: ReactNode }) {
  return <RepShell>{children}</RepShell>;
}
