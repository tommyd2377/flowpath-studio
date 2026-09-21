/** Safe visitor wording for a model transport failure; the original cause is
 * retained only for the existing opt-in engineering recorder. */
export class VisitorTaskConnectionError extends Error {
  constructor(cause: unknown) {
    super('The conversation backend is temporarily unavailable.', { cause });
    this.name = 'VisitorTaskConnectionError';
  }
}

const connectionCodes = new Set(['UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE']);

/** Called only around a model request, never around capability execution. */
export function modelConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error) || ['AbortError', 'TimeoutError'].includes(error.name)) return false;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++, current = current.cause) {
    if ('code' in current && typeof current.code === 'string' && connectionCodes.has(current.code)) return true;
  }
  return false;
}

export function visitorTaskFailureMessage(error: unknown) {
  return error instanceof VisitorTaskConnectionError
    ? 'The assistant connection was interrupted. Your current view is still available. Please try your request again.'
    : 'The task could not finish. Any confirmed views remain available.';
}
