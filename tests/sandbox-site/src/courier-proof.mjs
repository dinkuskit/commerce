// Test-site courier entry point; no production route is added. It makes the one call the store's courier makes
// (dinkuskit/courier src/index.js): EmDash's own route dispatch, from the store's code, with nobody signed in.
export async function handleCourierProof(context, next, { development, withRuntime }) {
  if (context.url.pathname !== "/__proof/courier-outbox") return next();
  if (!development || !["localhost", "127.0.0.1", "[::1]"].includes(context.url.hostname)) {
    return new Response("Local development proof only", { status: 403 });
  }
  if (context.request.method !== "POST") return new Response("POST required", { status: 405, headers: { Allow: "POST" } });
  const { after = null, limit = 50 } = await context.request.json().catch(() => ({}));
  const answer = await withRuntime((runtime) => runtime.handlePluginApiRoute("dinkus-commerce", "POST", "courier/outbox",
    new Request("http://store.internal/_emdash/api/plugins/dinkus-commerce/courier/outbox", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courier: 1, op: "since", topic: "order.shipped", after, limit }) })));
  return Response.json(answer);
}
