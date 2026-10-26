import type { CreationReviewer } from './creation-review';

/** A synthetic callback is deliberately unavailable outside an explicitly enabled development fixture. */
export function createFixtureCreationReviewer(
  context: { nodeEnv: string | undefined; enabled: boolean },
  review: CreationReviewer['review'],
): CreationReviewer {
  if (context.nodeEnv !== 'development' || !context.enabled) throw new Error('Creation safety fixtures require explicit local development mode.');
  return { mode: 'fixture', review };
}
