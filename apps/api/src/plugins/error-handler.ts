import { AppError, ErrorCode, errorPreset } from '@swissov/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import type { ErrorTracker } from '../lib/observability.js';
import { metrics } from '../lib/observability.js';

/**
 * Zentrale Fehlerbehandlung (§44).
 *
 * Nach aussen geht immer dasselbe Format mit maschinenlesbarem Code und
 * nutzerlesbarem Text. Interne Details (Stacktraces, SQL-Fehler) verlassen
 * den Server nie.
 */
export default fp<{ errors: ErrorTracker }>(async (fastify: FastifyInstance, options) => {
  fastify.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      metrics.increment(`error.${error.code}`);
      request.log.info({ code: error.code, msg: error.message }, 'AppError');
      return reply.status(error.statusCode).send(error.toJSON(requestId));
    }

    if (hasZodFastifySchemaValidationErrors(error) || error instanceof ZodError) {
      const issues =
        error instanceof ZodError
          ? error.issues
          : error.validation.map((v) => ({ path: v.instancePath, message: v.message }));
      metrics.increment('error.VALIDATION_FAILED');
      return reply.status(400).send({
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Request validation failed',
          userMessage: errorPreset(ErrorCode.VALIDATION_FAILED).userMessage,
          details: issues,
          requestId,
        },
      });
    }

    if (isResponseSerializationError(error)) {
      // Ein Serialisierungsfehler ist immer ein Programmfehler — laut loggen,
      // nach aussen aber ein generischer 500.
      options.errors.captureException(error, { requestId, route: request.routeOptions?.url });
      request.log.error({ err: error, issues: error.cause?.issues }, 'Antwort passt nicht zum Schema');
      metrics.increment('error.SERIALIZATION');
      return reply.status(500).send({
        error: {
          code: ErrorCode.INTERNAL,
          message: 'Response serialization failed',
          userMessage: errorPreset(ErrorCode.INTERNAL).userMessage,
          requestId,
        },
      });
    }

    // Nach den Typwächtern oben ist `error` für TypeScript wieder `unknown`;
    // hier wird es einmalig auf die Fastify-Fehlerform normalisiert.
    const fastifyError = error as { statusCode?: number; message?: string };
    const statusCode =
      typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;

    if (statusCode === 429) {
      metrics.increment('error.RATE_LIMITED');
      return reply.status(429).send({
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: 'Rate limit exceeded',
          userMessage: errorPreset(ErrorCode.RATE_LIMITED).userMessage,
          requestId,
        },
      });
    }

    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: statusCode === 404 ? ErrorCode.NOT_FOUND : ErrorCode.VALIDATION_FAILED,
          message: fastifyError.message ?? 'Request failed',
          userMessage: errorPreset(statusCode === 404 ? ErrorCode.NOT_FOUND : ErrorCode.VALIDATION_FAILED)
            .userMessage,
          requestId,
        },
      });
    }

    options.errors.captureException(error, {
      requestId,
      route: request.routeOptions?.url,
      userId: request.user?.id,
    });
    request.log.error({ err: error }, 'Unbehandelter Fehler');
    metrics.increment('error.INTERNAL');

    return reply.status(500).send({
      error: {
        code: ErrorCode.INTERNAL,
        message: 'Internal server error',
        userMessage: errorPreset(ErrorCode.INTERNAL).userMessage,
        requestId,
      },
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: `Route ${request.method} ${request.url} existiert nicht`,
        userMessage: errorPreset(ErrorCode.NOT_FOUND).userMessage,
        requestId: request.id,
      },
    });
  });
});
