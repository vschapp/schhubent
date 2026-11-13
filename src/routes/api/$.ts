import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const { handler } = await import("@/server/backend/index");
  return handler(request);
}

export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: handle, POST: handle, PUT: handle, DELETE: handle, PATCH: handle } },
});
