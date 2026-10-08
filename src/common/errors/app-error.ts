export type AppErrorKind =
  'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';

/**
 * Application/domain error with a machine-readable code. Thrown from services,
 * repositories and guards; mapped to HTTP by AppErrorFilter.
 */
export class AppError extends Error {
  constructor(
    readonly kind: AppErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
