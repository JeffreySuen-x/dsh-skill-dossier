/** Convert a report payload's structured failure into UI state. */
export function reportFailureMessage(payload: { lastError?: unknown }): string {
  return typeof payload.lastError === 'string' ? payload.lastError : ''
}
