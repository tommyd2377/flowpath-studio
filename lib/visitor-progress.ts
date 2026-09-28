import { z } from 'zod';

export const visitorWorkStageSchema = z.enum(['working', 'retrieving', 'searching', 'organizing', 'calculating', 'displaying', 'finishing']);
export type VisitorWorkStage = z.infer<typeof visitorWorkStageSchema>;
export type VisitorTaskObserver = {
  request?: string; traceId?: string;
  onProgress?: (stage: VisitorWorkStage) => void;
  onVerifiedResult?: (text: string) => void;
};
export const visitorWorkLabel: Record<VisitorWorkStage, string> = {
  working: 'Working…', retrieving: 'Checking details…', searching: 'Searching the web…',
  organizing: 'Organizing results…', calculating: 'Calculating…', displaying: 'Showing results…', finishing: 'Finishing answer…',
};
export function capabilityWorkStage(capability: string): VisitorWorkStage {
  return capability === 'research.lookup' ? 'searching'
    : ['estimate.update', 'estimate.tax', 'prices.total'].includes(capability) ? 'calculating'
    : ['query.patch', 'query.compare', 'records.filter', 'selection.compare'].includes(capability) ? 'organizing'
    : ['presentation.show', 'estimate.show'].includes(capability) ? 'displaying' : 'retrieving';
}
