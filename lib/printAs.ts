/**
 * Prints the page under a name of its own: the browser names a saved PDF after
 * the page title, so the title is swapped for this one just while the print
 * dialog is open ("Day review - Lucy Garcia - 2026-10-27.pdf"), then put back.
 */
export function printAs(name: string, print: () => void = () => window.print()) {
  const before = document.title;
  document.title = name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || before;
  const restore = () => {
    document.title = before;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  print();
  // Some browsers never fire afterprint: put the title back anyway.
  setTimeout(restore, 60_000);
}
