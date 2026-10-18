/**
 * fetch that rides out "JWT issued at future".
 *
 * When a session refreshes (a phone waking up, the middleware renewing the
 * cookie), the new token is stamped with Supabase Auth's clock. If the
 * database's clock is a hair behind, the very next query is rejected with
 * "JWT issued at future" even though the token is perfectly good. A second
 * later the clocks agree and the same request goes through. So: on that one
 * error, wait briefly and send the same request again. Anything else --
 * including a genuinely bad or expired token -- comes back untouched.
 */
export const fetchRetry: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 401 || attempt >= 3) return res;
    const body = await res.clone().text().catch(() => "");
    if (!/issued at future/i.test(body)) return res;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
};
