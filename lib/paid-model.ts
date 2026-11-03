export type PaymentMode = 'creator' | 'intro' | 'visitor';
export type PaymentSettings = { mode: PaymentMode; allowanceSeconds: number; budgetSeconds: number };
export type PublicWaveform = { id: string; name: string; accentColor: string; profilePhoto: string | null; textPanel?: import('./text-panel').TextPanelConfiguration | null; visualDisplay?: import('./visual-display').VisualDisplayConfiguration | null };
export type MinutePack = { id: string; seconds: number; amount: number; currency: 'usd'; priceId: string };

export const DEFAULT_PACK: MinutePack = { id: 'minutes-15', seconds: 900, amount: 500, currency: 'usd', priceId: '' };
export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = { mode: 'visitor', allowanceSeconds: 300, budgetSeconds: 0 };
export const validWaveformId = (id: unknown): id is string => typeof id === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export const returnDestination = (value: unknown) => typeof value === 'string'
  && /^\/(?:p|w)\/[0-9a-f-]{36}$/.test(value) && validWaveformId(value.slice(3)) ? value : '/account';
export const packLabel = (pack: MinutePack) => `${new Intl.NumberFormat('en-US', { style: 'currency', currency: pack.currency }).format(pack.amount / 100)} USD for ${pack.seconds / 60} minutes`;

export function paymentSettings(value: unknown, allowUnfunded = false): PaymentSettings {
  const row = value as PaymentSettings;
  if (!row || Object.keys(row).some(key => !['mode', 'allowanceSeconds', 'budgetSeconds'].includes(key))
    || !['creator', 'intro', 'visitor'].includes(row.mode)
    || !Number.isSafeInteger(row.allowanceSeconds) || row.allowanceSeconds < 1 || row.allowanceSeconds > 86_400
    || !Number.isSafeInteger(row.budgetSeconds) || row.budgetSeconds < 0 || row.budgetSeconds > 10_000_000
    || !allowUnfunded && row.mode !== 'visitor' && row.budgetSeconds < 1) throw new Error('Choose a payment mode, a finite budget and an allowance between 1 second and 24 hours.');
  return { mode: row.mode, allowanceSeconds: row.allowanceSeconds, budgetSeconds: row.budgetSeconds };
}
