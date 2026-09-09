/** Publisher-facing USD values. Balances are decimal cents; actions use whole cents. */
export type BillingView = {
  siteId: string;
  revision: number;
  mode: 'preview' | 'unavailable';
  checkoutProvider?: 'local-test' | 'stripe';
  pendingCheckout?: {
    status: 'open' | 'unknown' | 'awaiting-confirmation';
    checkoutUrl?: string;
    kind: 'subscription' | 'topup';
    amountCents: number;
    cycle?: 'monthly' | 'annual';
  };
  subscription: {
    status: 'inactive' | 'active' | 'canceled';
    cycle: 'monthly' | 'annual' | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  };
  balances: { includedCents: number; purchasedCents: number; reservedCents: number };
  allowance: { monthlyCents: number; resetsAt: number | null };
  offer: { monthlyCents: number; annualCents: number; retailMultiplier: number; topUpAmountsCents: number[] };
  replenishment: {
    enabled: boolean;
    amountCents: number;
    thresholdCents: number;
    monthlyCeilingCents: number;
    spentThisMonthCents: number;
    pause?: 'failed' | 'unknown' | null;
  };
};

export type BillingAction =
  | { action: 'activate'; cycle: 'monthly' | 'annual'; idempotencyKey: string }
  | { action: 'topup'; amountCents: number; idempotencyKey: string }
  | { action: 'simulate-usage'; kind: 'chat' | 'voice'; idempotencyKey: string }
  | { action: 'replenishment'; enabled: boolean; amountCents: number; thresholdCents: number; monthlyCeilingCents: number; revision: number }
  | { action: 'cancel' | 'resume'; revision: number };
