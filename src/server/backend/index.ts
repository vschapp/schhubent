// @ts-nocheck -- imported School Hub source, kept as-is
import { json, router } from '@/server/appdeploy-sdk';
import type { RouterMiddleware } from '@/server/appdeploy-sdk';
import { apiFailure, platformRoutes } from './platform';
import { enterpriseRoutes } from './enterprise';
import { validateRequestOrigin } from './request-security';
import { runWorkflowEscalations } from './governance';

const applicationRoutes: Record<string, RouterMiddleware[]> = {
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  ...platformRoutes,
  ...enterpriseRoutes,
};

function withRouteErrorBoundary(route: string, handler: RouterMiddleware): RouterMiddleware {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (cause) {
      return apiFailure(cause, 'The request could not be completed. Please retry.', {
        logLabel: `${route} failed`,
      });
    }
  };
}

// Guard every middleware stage, including origin validation and authentication.
// Explicit 401/403/validation responses pass through unchanged; only unexpected
// thrown exceptions are converted to the shared safe API failure contract.
const protectedRoutes: Record<string, RouterMiddleware[]> = Object.fromEntries(
  Object.entries(applicationRoutes).map(([route, middleware]) => [
    route,
    [
      withRouteErrorBoundary(`${route} request-origin`, validateRequestOrigin),
      ...middleware.map((handler, index) =>
        withRouteErrorBoundary(`${route} middleware ${index + 1}`, handler),
      ),
    ],
  ]),
);

export const handler = router(protectedRoutes);

export const workflowEscalationHandler = async (_event: { type: 'cron'; name: string; scheduledTime: string }) => {
  await runWorkflowEscalations();
  return { statusCode: 200 };
};
