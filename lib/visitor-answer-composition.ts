import { z } from 'zod';

export const answerCompositionSchema = z.object({ text: z.string().trim().min(1).max(8000), relationship: z.enum(['related', 'new-subject']) }).strict();
// Model instructions: distinguish a confirmed visual result from additional answer content.
export const ANSWER_COMPOSITION_GUIDANCE = 'An ordinary final answer is always displayed automatically: as the main answer before a display is confirmed, or as compact supporting text within the current information after a confirmed display. After a confirmed grid, comparison or estimate, briefly explain the result or change without repeating the visible item list, price table or standard caveats. Preserve material exceptions and answer any additional question. For richer explanations, calculations, comparisons or findings that should occupy their own region beside the displayed content, use present_answer. Reserve a tool step for that composition after any necessary retrieval. Do not use present_answer merely to repeat a filter, count, navigation or display confirmation.';
// Model tool: describe complete answer composition while retaining related context or replacing a subject.
export const answerCompositionTool = {
  type: 'function', name: 'present_answer',
  description: 'Present a complete answer on the information surface. Choose related to retain useful media/context and put this answer beside it; choose new-subject to replace unrelated prior information. Use natural, well-structured prose, exact published facts and attributed external findings. This is the final display step after any necessary tools. Use it for substantive new content beyond an already displayed view, including short explanations or calculations. A simple confirmation of displayed results needs only final text. Never generate HTML or CSS.',
  parameters: z.toJSONSchema(answerCompositionSchema, { target: 'draft-7' }),
};
