import { Transform } from 'class-transformer';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';

function flattenMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenMessages(error.children ?? []),
  ]);
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppError(
        'BAD_REQUEST',
        'VALIDATION_FAILED',
        flattenMessages(errors).join('; '),
      ),
  });
}

/** Trims string input before validation (e.g. emails pasted with whitespace). */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
