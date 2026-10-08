import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError, AppErrorKind } from './app-error.js';

const STATUS_BY_KIND: Record<AppErrorKind, HttpStatus> = {
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
};

/**
 * Gives every HTTP error the same `{ statusCode, code, message }` shape.
 * AppErrors carry their own code; framework HttpExceptions (throttling,
 * ParseUUIDPipe, unknown routes) get the HTTP status name as code.
 * Unknown errors fall through to Nest's default 500 handler (no details leaked).
 */
@Catch(AppError, HttpException)
export class AppErrorFilter implements ExceptionFilter {
  catch(error: AppError | HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof AppError) {
      const statusCode = STATUS_BY_KIND[error.kind];
      response
        .status(statusCode)
        .json({ statusCode, code: error.code, message: error.message });
      return;
    }

    const statusCode = error.getStatus();
    response.status(statusCode).json({
      statusCode,
      code: HttpStatus[statusCode] ?? 'HTTP_ERROR',
      message: httpExceptionMessage(error),
    });
  }
}

function httpExceptionMessage(error: HttpException): string {
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : error.message;
}
