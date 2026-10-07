/**
 * GridGuide — Sentry Error Logging
 * 
 * Install: npm install @sentry/nextjs
 * Setup:   npx @sentry/wizard@latest -i nextjs
 * 
 * Wraps all API route handlers with error capture,
 * attaches user context, and provides structured logging.
 */
import * as Sentry from "@sentry/nextjs";

const IS_PROD = process.env.NODE_ENV === "production";
const DSN     = process.env.SENTRY_DSN;

// ─── Initialize (call once in instrumentation.js) ────────────────────────────
export function initSentry() {
  if (!DSN) {
    console.warn("[Sentry] SENTRY_DSN not set — error logging disabled");
    return;
  }
  Sentry.init({
    dsn:              DSN,
    environment:      process.env.NODE_ENV || "development",
    release:          process.env.NEXT_PUBLIC_VERSION || "0.0.1",
    tracesSampleRate: IS_PROD ? 0.1 : 1.0,  // 10% in prod, 100% in dev
    profilesSampleRate: IS_PROD ? 0.1 : 0,

    beforeSend(event) {
      // Scrub sensitive data before sending to Sentry
      if (event.request?.cookies) delete event.request.cookies;
      if (event.extra?.password)  delete event.extra.password;
      if (event.extra?.token)     delete event.extra.token;
      return event;
    },
  });
}

// ─── Attach user context to all Sentry events for that request ───────────────
export function setSentryUser(user) {
  Sentry.setUser({
    id:    user.id,
    email: user.email,
    role:  user.role,
  });
}

export function clearSentryUser() {
  Sentry.setUser(null);
}

// ─── Capture an error with context ────────────────────────────────────────────
export function captureError(error, context = {}) {
  if (!IS_PROD) {
    console.error("[Error]", error.message, context);
  }
  Sentry.withScope((scope) => {
    if (context.user)     scope.setUser(context.user);
    if (context.route)    scope.setTag("route", context.route);
    if (context.method)   scope.setTag("method", context.method);
    if (context.userId)   scope.setTag("userId", context.userId);
    if (context.extra)    scope.setExtras(context.extra);
    Sentry.captureException(error);
  });
}

// ─── Structured logger ────────────────────────────────────────────────────────
export const logger = {
  info:  (msg, ctx = {}) => { if (!IS_PROD) console.log(`[INFO]  ${msg}`, ctx); },
  warn:  (msg, ctx = {}) => { console.warn(`[WARN]  ${msg}`, ctx); Sentry.addBreadcrumb({ level: "warning", message: msg, data: ctx }); },
  error: (msg, ctx = {}) => { console.error(`[ERROR] ${msg}`, ctx); captureError(new Error(msg), ctx); },
  debug: (msg, ctx = {}) => { if (process.env.DEBUG) console.debug(`[DEBUG] ${msg}`, ctx); },
};

// ─── Route error wrapper ───────────────────────────────────────────────────────
/**
 * Wrap any API route handler with automatic error capture.
 * 
 * Usage:
 *   export const GET = withErrorCapture(async (request) => {
 *     // your handler
 *   }, "GET /api/products");
 */
export function withErrorCapture(handler, routeLabel = "unknown") {
  return async (request, context) => {
    const start = Date.now();

    try {
      const response = await handler(request, context);

      // Log slow requests (> 3 seconds)
      const duration = Date.now() - start;
      if (duration > 3000) {
        logger.warn(`Slow request: ${routeLabel}`, { duration });
      }

      return response;
    } catch (error) {
      const duration = Date.now() - start;

      captureError(error, {
        route:  routeLabel,
        method: request.method,
        extra:  {
          url:      request.url,
          duration,
          headers:  Object.fromEntries([...request.headers].filter(([k]) =>
            ["content-type", "x-user-id", "x-user-role"].includes(k)
          )),
        },
      });

      // Return a safe 500 response — never expose internal error details
      return Response.json(
        {
          ok:    false,
          error: "An internal error occurred. Our team has been notified.",
          ref:   Sentry.lastEventId(),
        },
        { status: 500 }
      );
    }
  };
}

// ─── Performance transaction ───────────────────────────────────────────────────
export function startTransaction(name, op = "http") {
  return Sentry.startSpan({ name, op }, (span) => span);
}

// ─── Alert on critical failures ───────────────────────────────────────────────
export async function alertCritical(message, data = {}) {
  logger.error(`CRITICAL: ${message}`, data);

  // In production, also page on-call via Sentry alerts
  Sentry.withScope((scope) => {
    scope.setLevel("fatal");
    scope.setExtras(data);
    Sentry.captureMessage(`CRITICAL: ${message}`);
  });
}
