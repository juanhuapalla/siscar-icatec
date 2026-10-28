// SISCAR: Worker que sirve public/ y la API sobre Cloudflare D1.
// POST   /api/login         {clave} → abre sesión como admin o lector
// POST   /api/logout        cierra la sesión
// GET    /api/sesion        perfil de la sesión actual
// GET    /api/cartas        lista de cartas            (admin, lector)
// PUT    /api/cartas/:id    crea o reemplaza una carta (admin)
// DELETE /api/cartas/:id    elimina una carta          (admin)
// GET    /api/config        ajustes del proyecto       (admin, lector)
// PUT    /api/config        guarda los ajustes         (admin)
//
// Secrets requeridos: ADMIN_PASSWORD, LECTOR_PASSWORD, SESSION_SECRET.
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

const COOKIE = "siscar_sesion";
const DURACION = 12 * 60 * 60; // segundos

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url.pathname.slice(5).split("/").filter(Boolean));
    } catch (err) {
      return json({ error: err.message }, err.status || 500);
    }
  },
};

async function api(request, env, [recurso, id]) {
  const db = env.DB;
  const m = request.method;

  if (recurso === "login" && m === "POST") return login(request, env);
  if (recurso === "logout" && m === "POST") return json({}, 200, { "set-cookie": cookie("", 0) });

  const rol = await sesion(request, env);
  if (!rol) return json({ error: "Sesión no iniciada" }, 401);
  if (recurso === "sesion" && m === "GET") return json({ rol });
  if (m !== "GET") {
    if (rol !== "admin") return json({ error: "Tu perfil solo permite consultar" }, 403);
    if (!(request.headers.get("content-type") || "").startsWith("application/json") && m !== "DELETE")
      return json({ error: "Se esperaba JSON" }, 415);
  }

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

/* ---------- sesión ---------- */
function secretos(env) {
  if (!env.ADMIN_PASSWORD || !env.LECTOR_PASSWORD || !env.SESSION_SECRET)
    throw Object.assign(new Error("Faltan los secrets ADMIN_PASSWORD, LECTOR_PASSWORD o SESSION_SECRET"), { status: 500 });
  return env;
}

async function login(request, env) {
  const { ADMIN_PASSWORD, LECTOR_PASSWORD } = secretos(env);
  const { clave } = await request.json().catch(() => ({}));
  let rol = null;
  if (typeof clave === "string" && clave) {
    if (await iguales(clave, ADMIN_PASSWORD)) rol = "admin";
    else if (await iguales(clave, LECTOR_PASSWORD)) rol = "lector";
  }
  if (!rol) return json({ error: "Clave incorrecta" }, 401);
  const exp = Math.floor(Date.now() / 1000) + DURACION;
  const valor = `${rol}.${exp}`;
  return json({ rol }, 200, { "set-cookie": cookie(`${valor}.${await firmar(env, valor)}`, DURACION) });
}

async function sesion(request, env) {
  const c = (request.headers.get("cookie") || "").split(/;\s*/).find(s => s.startsWith(COOKIE + "="));
  if (!c) return null;
  const [rol, exp, firma] = c.slice(COOKIE.length + 1).split(".");
  if (!["admin", "lector"].includes(rol) || !(Number(exp) > Date.now() / 1000) || !firma) return null;
  const ok = await iguales(firma, await firmar(secretos(env), `${rol}.${exp}`));
  return ok ? rol : null;
}

const cookie = (valor, maxAge) =>
  `${COOKIE}=${valor}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function firmar(env, valor) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(valor));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// compara en tiempo constante (hash de ambos lados para igualar longitudes)
async function iguales(a, b) {
  const h = s => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return crypto.subtle.timingSafeEqual(await h(a), await h(b));
}
