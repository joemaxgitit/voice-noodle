/*
  A short pause in a long loop so the page stays responsive. Not setTimeout:
  browsers slow timers to once a second in a tab you've left (and to once a
  minute after a few minutes), which made compressing and measuring a call
  crawl whenever you switched windows. A message to ourselves isn't slowed.
*/
export function yieldNow(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => {
      c.port1.close();
      r();
    };
    c.port2.postMessage(0);
  });
}
