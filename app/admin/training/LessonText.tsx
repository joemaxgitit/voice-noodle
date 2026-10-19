import { Fragment } from "react";

/*
  Shows pasted lesson content laid out nicely. The words are never changed:
  every line shows exactly as typed. Only the look changes -- headings,
  bullet points, spacing.
*/

type Block = { kind: "h" | "sub" | "li" | "p"; lines: string[] };

const BULLET = /^\s*[-•*–·▪●◦]\s+/;
const isCaps = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase() && s.replace(/[^A-Za-z]/g, "").length >= 4 && s.length <= 120;
// "1. Introduction: The Person in the Mirror (3 minutes)", "Part 2 -- Tonality", "Step 3:"
const isSection = (s: string) =>
  s.length <= 120 && (/^(\d+|[IVX]+)[.)]\s+\S.*(\(\s*\d+\s*(min|minutes?|mins?)\s*\)|:)\s*$/i.test(s) || /^(part|section|step|module|lesson|segment)\s+\d+\b/i.test(s));
const isLabel = (s: string) => s.length <= 80 && /:\s*$/.test(s) && !/[.!?]["”]?\s*:\s*$/.test(s);

export function lessonBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", lines: para });
    para = [];
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      out.push({ kind: "li", lines: [line.replace(BULLET, "")] });
    } else if (isSection(line) || isCaps(line)) {
      flush();
      out.push({ kind: "h", lines: [line] });
    } else if (isLabel(line)) {
      flush();
      out.push({ kind: "sub", lines: [line] });
    } else para.push(line);
  }
  flush();
  return out;
}

export default function LessonText({ text }: { text: string }) {
  const blocks = lessonBlocks(text);
  const els: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "li") {
      const items: string[] = [];
      while (i < blocks.length && blocks[i].kind === "li") items.push(blocks[i++].lines[0]);
      i--;
      els.push(
        <ul key={i} className="lesson-ul">
          {items.map((x, j) => (
            <li key={j}>{x}</li>
          ))}
        </ul>
      );
    } else if (b.kind === "h") els.push(<h4 key={i} className="lesson-h">{b.lines[0]}</h4>);
    else if (b.kind === "sub") els.push(<p key={i} className="lesson-sub">{b.lines[0]}</p>);
    else
      els.push(
        <p key={i} className="lesson-p">
          {b.lines.map((l, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {l}
            </Fragment>
          ))}
        </p>
      );
  }
  return <div className="lesson">{els}</div>;
}
