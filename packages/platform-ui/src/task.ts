import { z } from 'zod';
import { publicationRefSchema, taskIdSchema } from './query.js';
import { temporalDateSchema } from './contracts.js';
const id = taskIdSchema;
export const capabilityDescriptorSchema = z.object({ id, version: z.number().int().positive(), purpose: z.string().min(1).max(500),
  inputType: id, outputType: id, effect: z.enum(['read', 'localState', 'externalDraft', 'externalCommit']), scopes: z.array(id).max(32),
  preconditions: z.array(id).max(12), freshnessMs: z.number().int().min(1).max(7_200_000), authorization: z.enum(['published', 'enabled', 'confirmation']),
  prepare: z.boolean(), status: z.boolean(), idempotent: z.boolean(), maxCalls: z.number().int().min(1).max(16),
  cancellation: z.enum(['abort', 'reconcile']), presentations: z.array(id).max(12), demoOnly: z.boolean(),
}).strict();
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;
export const resultHandleSchema = z.object({ id, type: id, sessionId: id, publication: publicationRefSchema, generation: z.number().int().nonnegative(),
  observedAt: temporalDateSchema, expiresAt: temporalDateSchema, authority: z.enum(['publisher', 'external', 'calculated', 'provider', 'display']),
  dependencies: z.array(z.object({ id, revision: z.number().int().nonnegative() }).strict()).max(24),
}).strict();
export type ResultHandle = z.infer<typeof resultHandleSchema>;
export const taskReceiptSchema = z.object({ id, operationId: id, kind: z.enum(['result', 'display', 'draft', 'effect']), status: z.enum(['confirmed', 'failed', 'cancelled', 'reconciling']),
  handle: resultHandleSchema.optional(), observedAt: temporalDateSchema,
  display: z.object({ queryId: id, queryRevision: z.number().int().nonnegative(), resultSetId: id, sceneRevision: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export type TaskReceipt = z.infer<typeof taskReceiptSchema>;
export const taskStepSchema = z.object({ id, capabilityId: id, capabilityVersion: z.number().int().positive(), operationId: id,
  bindings: z.array(z.object({ input: id, handleId: id, outputType: id }).strict()).max(12),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'reconciling']), receipt: taskReceiptSchema.optional(),
}).strict();
export type TaskStep = z.infer<typeof taskStepSchema>;
export const visitorTaskStateSchema = z.object({ version: z.literal(2), taskId: id, sessionId: id, revision: z.number().int().nonnegative(), publication: publicationRefSchema,
  generation: z.number().int().nonnegative(), outcome: z.string().max(500),
  status: z.enum(['interpreting', 'needsClarification', 'running', 'awaitingDisplay', 'awaitingConfirmation', 'completed', 'partiallyCompleted', 'failed', 'cancelled', 'reconciling']),
  steps: z.array(taskStepSchema).max(16), receipts: z.array(taskReceiptSchema).max(24),
  budget: z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), modelCalls: z.number().int().min(0).max(5), capabilityCalls: z.number().int().min(0).max(16), expiresAt: temporalDateSchema }).strict(),
}).strict();
export type VisitorTaskState = z.infer<typeof visitorTaskStateSchema>;
