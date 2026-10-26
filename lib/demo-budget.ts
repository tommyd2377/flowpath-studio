export type DemoEntryPoint = 'studio' | 'news';
export type DemoBudget = { dailySeconds: number; concurrency: number; visitorDailySeconds: number };
export type DemoBudgets = Record<DemoEntryPoint, DemoBudget>;

/** Platform spending controls, separate from paid wallets and participant previews. */
export function demoBudgets(environment: Record<string, string | undefined>, parent: { dailySeconds: number; concurrency: number }): DemoBudgets | null {
  const read = (name: string, fallback: number) => environment[name] === undefined ? fallback
    : /^\d+$/.test(environment[name]!) ? Number(environment[name]) : NaN;
  const entry = (name: 'STUDIO' | 'NEWS', fallback: number): DemoBudget => ({
    dailySeconds: read(`FLOWPATH_DEMO_${name}_DAILY_SECONDS`, fallback),
    concurrency: read(`FLOWPATH_DEMO_${name}_CONCURRENCY`, parent.concurrency),
    visitorDailySeconds: read(`FLOWPATH_DEMO_${name}_VISITOR_SECONDS`, 180),
  });
  const budgets = { studio: entry('STUDIO', parent.dailySeconds), news: entry('NEWS', 0) };
  if (Object.values(budgets).some(b => !Number.isSafeInteger(b.dailySeconds) || b.dailySeconds < 0
    || !Number.isSafeInteger(b.concurrency) || b.concurrency < 1 || b.concurrency > parent.concurrency
    || !Number.isSafeInteger(b.visitorDailySeconds) || b.visitorDailySeconds < 0 || b.visitorDailySeconds > 180
    || b.dailySeconds > parent.dailySeconds)) return null;
  return budgets;
}
