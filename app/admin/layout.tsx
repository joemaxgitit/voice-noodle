import type { ReactNode } from "react";
import AdminFrame from "./AdminFrame";

/** Every manager page sits inside the sidebar frame. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminFrame>{children}</AdminFrame>;
}
