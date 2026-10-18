"use client";

import HubShell from "../training/HubShell";
import MasteryTab from "../training/MasteryTab";

/** Master Your Craft: Mon-Wed 1:30-2:00, one manager teaching the week. */
export default function MasteryPage() {
  return (
    <HubShell
      eyebrow="Meetings"
      title="Master Your Craft"
      intro="Monday to Wednesday, 1:30 to 2:00. Pick who teaches the week and what they cover, sort reps into their days, and take attendance."
      above={<div style={{ height: 18 }} />}
    >
      <MasteryTab />
    </HubShell>
  );
}
