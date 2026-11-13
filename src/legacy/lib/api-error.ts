// @ts-nocheck -- imported School Hub source, kept as-is
/** Return a safe, consistent message from AppDeploy API errors without exposing raw objects. */
export function apiErrorMessage(
  cause: unknown,
  fallback: string,
  includeClientMessage = true,
): string {
  if (cause && typeof cause === 'object') {
    const candidate = cause as {
      response?: { data?: { error?: unknown } };
      message?: unknown;
    };
    const serverMessage = candidate.response?.data?.error;
    if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage;
    if (includeClientMessage && typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }
  }
  return fallback;
}
