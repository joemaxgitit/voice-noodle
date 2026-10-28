"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The answer key lives on Insights & tuning now (Tuning the grader tab); old links land there. */
export default function AnswerKeyMoved() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/calls/insights?tab=tuning");
  }, [router]);
  return null;
}
