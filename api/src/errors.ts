import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Standard error envelope returned for every non-2xx response.
 */
export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  request_id?: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (msg = 'Not found', details?: unknown) =>
  new AppError(404, 'not_found', msg, details);
export const badRequest = (msg = 'Bad request', details?: unknown) =>
  new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Unauthorized') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Forbidden') => new AppError(403, 'forbidden', msg);
export const conflict = (msg = 'Conflict', details?: unknown) =>
  new AppError(409, 'conflict', msg, details);

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.id;

    if (err instanceof AppError) {
      req.log.warn({ err, requestId }, 'app error');
      const body: ErrorBody = {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: requestId,
      };
      return reply.status(err.statusCode).send(body);
    }

    // Fastify validation / built-ins
    const fe = err as FastifyError;
    if (fe.validation) {
      const body: ErrorBody = {
        code: 'validation_error',
        message: fe.message,
        details: fe.validation,
        request_id: requestId,
      };
      return reply.status(400).send(body);
    }

    req.log.error({ err, requestId }, 'unhandled error');
    const body: ErrorBody = {
      code: 'internal_error',
      message: 'Internal server error',
      request_id: requestId,
    };
    return reply.status(fe.statusCode ?? 500).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ErrorBody = {
      code: 'not_found',
      message: `Route ${req.method} ${req.url} not found`,
      request_id: req.id,
    };
    return reply.status(404).send(body);
  });
}
