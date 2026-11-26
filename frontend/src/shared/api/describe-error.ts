import { isApiError } from './errors';

/** What the user should do next, so every error screen offers a way forward (GEN-16). */
export type Recovery =
  'retry' | 'sign-in' | 'refresh' | 'go-back' | 'fix-input' | 'none';

export type ErrorDescription = {
  title: string;
  message: string;
  /** One short sentence on how to recover, or null when the message already says it. */
  hint: string | null;
  recovery: Recovery;
  /** Whether running the same action again can succeed without changing anything. */
  retryable: boolean;
};

const GENERIC = 'Something went wrong. Please try again.';

/**
 * GEN-16: turns any thrown value into a title, a message and a recovery hint the user can act on.
 * It switches on the API's `code` and HTTP status, never on message text, except for the
 * provider-deactivated 403 (ACC-15), whose server message is already the clearest explanation.
 */
export function describeApiError(error: unknown): ErrorDescription {
  if (!isApiError(error)) {
    return {
      title: 'Something went wrong',
      message: GENERIC,
      hint: null,
      recovery: 'retry',
      retryable: true,
    };
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        title: 'You seem to be offline',
        message: error.message,
        hint: null,
        recovery: 'retry',
        retryable: true,
      };
    case 'VALIDATION_FAILED':
    case 'INVALID_ID':
    case 'BAD_REQUEST':
      return {
        title: 'Please check your input',
        message: error.message,
        hint: error.hasFieldErrors()
          ? 'The fields that need a fix are marked.'
          : null,
        recovery: 'fix-input',
        retryable: false,
      };
    case 'UNAUTHENTICATED':
      return {
        title: 'Your session has ended',
        message: 'Please sign in again to continue.',
        hint: null,
        recovery: 'sign-in',
        retryable: false,
      };
    case 'PROVIDER_INACTIVE':
      return {
        title: 'Not available right now',
        message: error.message,
        hint: null,
        recovery: 'go-back',
        retryable: false,
      };
    case 'TOO_MANY_REQUESTS':
      return {
        title: 'Too many attempts',
        message: error.retryAfter
          ? `Please wait ${waitText(error.retryAfter)} and try again.`
          : 'Please wait a moment and try again.',
        hint: null,
        recovery: 'retry',
        retryable: true,
      };
    case 'PAYLOAD_TOO_LARGE':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return {
        title: 'That file cannot be uploaded',
        message: error.message,
        hint: 'Choose a different file and try again.',
        recovery: 'fix-input',
        retryable: false,
      };
  }

  if (error.status === 403) {
    // ACC-15: the API explains a deactivated hotel or airline in its own words; keep them.
    const deactivated = /deactivated/i.test(error.message);
    return {
      title: deactivated ? 'This provider is deactivated' : 'Not allowed',
      message: deactivated
        ? error.message
        : 'You do not have permission to do this.',
      hint: null,
      recovery: 'go-back',
      retryable: false,
    };
  }
  if (error.status === 404) {
    return {
      title: 'Not found',
      message: 'It may have been removed, or the link is wrong.',
      hint: null,
      recovery: 'go-back',
      retryable: false,
    };
  }
  if (error.status === 409) {
    // Conflicts (DUPLICATE_KEY, INSUFFICIENT_INVENTORY, CONFLICT...) carry a specific message
    // that names what clashed, for example the reserved nights of a room.
    return {
      title: 'This could not be done',
      message: error.message,
      hint: 'Refresh to see the latest data, then try again.',
      recovery: 'refresh',
      retryable: false,
    };
  }
  if (error.status >= 500 || error.code === 'UNKNOWN') {
    return {
      title: 'Something went wrong on our side',
      message: error.status === 503 ? error.message : GENERIC,
      hint: null,
      recovery: 'retry',
      retryable: true,
    };
  }
  return {
    title: 'This could not be done',
    message: error.message,
    hint: null,
    recovery: 'none',
    retryable: false,
  };
}

function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
