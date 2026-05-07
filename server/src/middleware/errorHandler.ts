import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ---------------------------------------------------------------------------
// AppError — typed, intentional application error
// Use this for all predictable failure modes: validation, not found, etc.
// Unexpected errors (agent failures, DB bugs) bubble up as-is and become 500.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// asyncHandler — wraps async route handlers so unhandled rejections reach
// the error middleware. Express 4 does NOT catch async throws automatically;
// without this wrapper, a thrown error in an async route silently hangs.
// ---------------------------------------------------------------------------

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// ---------------------------------------------------------------------------
// errorMiddleware — single place where all errors become HTTP responses.
// Register last in index.ts: app.use(errorMiddleware)
//
// Response format: { error: string, code: string, details?: unknown }
//   - error: human-readable message (backward-compat — clients read data.error)
//   - code:  machine-readable (VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR, …)
//   - details: optional structured data (Zod field errors, etc.)
// ---------------------------------------------------------------------------

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      console.error(`[${err.code}]`, err.message, err.details ?? '');
    }
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // Unhandled / unexpected error — always log with stack for debuggability
  console.error('[UNHANDLED_ERROR]', err);
  res.status(500).json({
    error: (err as Error).message ?? 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
