export type OpenErrorCode = 'E_PARSE' | 'E_ENCRYPTED' | 'E_ZERO_PAGES' | 'E_LIMIT';

export interface OpenError extends Error {
  code: OpenErrorCode;
  detail?: string;
}

export function makeOpenError(code: OpenErrorCode, detail?: string): OpenError {
  const messages: Record<OpenErrorCode, string> = {
    E_PARSE: 'PDF cannot be parsed',
    E_ENCRYPTED: 'PDF is encrypted and no password was provided',
    E_ZERO_PAGES: 'PDF has no pages',
    E_LIMIT: 'PDF exceeds a configured limit',
  };
  const error = new Error(detail ? `${messages[code]}: ${detail}` : messages[code]) as OpenError;
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

export function isOpenError(error: unknown): error is OpenError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    /^E_(PARSE|ENCRYPTED|ZERO_PAGES|LIMIT)$/.test((error as { code: string }).code)
  );
}
