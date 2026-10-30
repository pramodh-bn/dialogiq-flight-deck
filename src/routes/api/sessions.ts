import { createFileRoute } from "@tanstack/react-router";
import { scenarios } from "@/lib/scenarios";

export const Route = createFileRoute("/api/sessions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { scenarioId?: string };
        const s = scenarios.find((x) => x.id === body.scenarioId);
        if (!s) return Response.json({ error: "Unknown scenario" }, { status: 400 });
        return Response.json({
          sessionId: crypto.randomUUID(),
          scenarioId: s.id,
          persona: s.persona,
          opener: s.opener,
          startedAt: new Date().toISOString(),
        });
      },
    },
  },
});
