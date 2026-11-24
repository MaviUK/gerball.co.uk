// Gerball prospective ingestion — fail-closed deployment.
// The endpoint cannot write predictions until an approved strategy,
// verified odds provenance and replay-safe database operation exist.
Deno.serve((request: Request) => {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, allow: "POST" } });
  return new Response(JSON.stringify({ error: "prospective_ingestion_inactive" }), { status: 503, headers });
});
