import { z } from 'zod';

export const visitorWorkStageSchema = z.enum(['working', 'retrieving', 'searching', 'displaying', 'finishing']);
export type VisitorWorkStage = z.infer<typeof visitorWorkStageSchema>;
export type VisitorTaskObserver = {
  request?: string; traceId?: string;
  onProgress?: (stage: VisitorWorkStage) => void;
  onVerifiedResult?: (text: string) => void;
};
export const visitorWorkLabel: Record<VisitorWorkStage, string> = {
  working: 'Working on your request…', retrieving: 'Checking this site’s information…',
  searching: 'Searching the web…', displaying: 'Displaying results…', finishing: 'Results are ready · finishing your answer…',
};
export function capabilityWorkStage(capability: string): VisitorWorkStage {
  return capability === 'research.lookup' ? 'searching' : capability === 'presentation.show' ? 'displaying' : 'retrieving';
}
