// Test-site maintenance entry point; no production route is added.
export async function handleMaintenanceProof(context, next, { development, runMaintenance }) {
  if (context.url.pathname !== "/__proof/maintenance") return next();
  if (!development || !["localhost", "127.0.0.1", "[::1]"].includes(context.url.hostname)) {
    return new Response("Local development proof only", { status: 403 });
  }
  if (context.request.method !== "POST") {
    return new Response("POST required", { status: 405, headers: { Allow: "POST" } });
  }
  if (!context.locals?.emdash?.db) return new Response("Host runtime unavailable", { status: 503 });
  try {
    const result = await runMaintenance();
    if (!Array.isArray(result?.published) || result.published.length !== 0) {
      return new Response("Expected an empty fixture publishing queue", { status: 503 });
    }
    return Response.json({ published: result.published });
  } catch {
    return new Response("Fixture maintenance failed", { status: 503 });
  }
}
