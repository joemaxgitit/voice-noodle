/** A standing grading rule written from the manager's corrections (or added by hand). */
export type GradingRule = { rule: string; why: string; count: number; manual?: boolean };
