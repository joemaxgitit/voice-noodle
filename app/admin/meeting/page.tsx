"use client";

import HubShell from "../training/HubShell";
import MeetingTab from "../training/MeetingTab";

/** The Thursday 10:00 sales meeting: agenda, presenters, backlog, present mode. */
export default function MeetingPage() {
  return (
    <HubShell
      eyebrow="Meetings"
      title="Thursday sales meeting"
      intro="Thursday at 10:00, 15 to 20 minutes. Build the agenda, drag presenters into order, park ideas in the backlog, and run it in presentation mode."
      above={<div style={{ height: 18 }} />}
    >
      <MeetingTab />
    </HubShell>
  );
}
