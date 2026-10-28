// SISCAR: Worker que sirve public/ y la API sobre Cloudflare D1.
// GET    /api/cartas        lista de cartas
// PUT    /api/cartas/:id    crea o reemplaza una carta
// DELETE /api/cartas/:id    elimina una carta
// GET    /api/config        ajustes del proyecto
// PUT    /api/config        guarda los ajustes
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return api(request, env, url.pathname.slice(5).split("/").filter(Boolean));
  },
};

async function api(request, env, [recurso, id]) {
  const db = env.DB;
  const m = request.method;

  if (recurso === "cartas" && !id && m === "GET") {
    const { results } = await db.prepare("SELECT id, data FROM cartas").all();
    return json(results.map(r => ({ ...JSON.parse(r.data), id: r.id })));
  }
  if (recurso === "cartas" && id && m === "PUT") {
    const body = await request.json();
    delete body.id;
    await db.prepare("INSERT INTO cartas (id, data) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data = ?2")
      .bind(id, JSON.stringify(body)).run();
    return new Response(null, { status: 204 });
  }
  if (recurso === "cartas" && id && m === "DELETE") {
    await db.prepare("DELETE FROM cartas WHERE id = ?1").bind(id).run();
    return new Response(null, { status: 204 });
  }
  if (recurso === "config" && m === "GET") {
    const row = await db.prepare("SELECT data FROM config WHERE id = 'general'").first();
    return json(row ? JSON.parse(row.data) : {});
  }
  if (recurso === "config" && m === "PUT") {
    const body = await request.json();
    await db.prepare("INSERT INTO config (id, data) VALUES ('general', ?1) ON CONFLICT(id) DO UPDATE SET data = ?1")
      .bind(JSON.stringify(body)).run();
    return new Response(null, { status: 204 });
  }
  return json({ error: "Ruta no encontrada" }, 404);
}
