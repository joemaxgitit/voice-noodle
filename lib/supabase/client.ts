import { createBrowserClient } from "@supabase/ssr";
import { fetchRetry } from "./fetchRetry";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: fetchRetry } }
  );
}
