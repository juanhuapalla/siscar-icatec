// SISCAR: Worker que sirve public/ y la API sobre Cloudflare D1.
//
// Sesión
// POST   /api/login                      {usuario, clave}
// POST   /api/logout
// GET    /api/sesion                     usuario actual y sus proyectos
// POST   /api/clave                      {actual, nueva} cambia la clave propia
//
// Proyectos (cada proyecto es un espacio aislado)
// GET    /api/proyectos                  proyectos visibles para el usuario
// POST   /api/proyectos                  {nombre}                     (general)
// PATCH  /api/proyectos/:pid             {nombre}                     (general)
// DELETE /api/proyectos/:pid             {confirmar: nombre}          (general)
//
// Dentro de un proyecto
// GET    /api/p/:pid/cartas                                            (admin, lector)
// PUT    /api/p/:pid/cartas/:id                                        (admin)
// DELETE /api/p/:pid/cartas/:id                                        (admin)
// GET    /api/p/:pid/config                                            (admin, lector)
// PUT    /api/p/:pid/config                                            (admin)
// GET    /api/p/:pid/miembros                                          (admin)
// POST   /api/p/:pid/miembros            {usuario, nombre, clave, rol} (admin: solo lectores)
// PATCH  /api/p/:pid/miembros/:uid       {rol?, clave?}                (admin: solo sus lectores)
// DELETE /api/p/:pid/miembros/:uid                                     (admin: solo lectores)
//
// Especialistas a los que se deriva una carta (catálogo común a todos los proyectos)
// GET    /api/especialistas                                            (todos)
// POST   /api/especialistas              {nombre}                     (general)
// PATCH  /api/especialistas/:id          {nombre?, activo?, mover?}   (general; mover: "arriba" | "abajo")
// DELETE /api/especialistas/:id                                        (general; solo si ninguna carta lo usa)
//
// Administradores generales
// GET    /api/usuarios                                                 (general)
// POST   /api/usuarios                   {usuario, nombre, clave}      (general)
// DELETE /api/usuarios/:uid                                            (general)
//
// Secrets: SESSION_SECRET (firma de sesión) y ADMIN_PASSWORD, que solo se usa
// para crear el primer administrador general (usuario "admin") si no hay usuarios.
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const vacio = () => new Response(null, { status: 204 });
const fallo = (status, error) => Object.assign(new Error(error), { status });

const COOKIE = "siscar_sesion";
const DURACION = 12 * 60 * 60; // segundos
const ITERACIONES = 100000;    // máximo de PBKDF2 en Workers

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent));
    } catch (err) {
      return json({ error: err.message }, err.status || 500);
    }
  },
};

async function api(request, env, ruta) {
  const db = env.DB;
  const m = request.method;
  const [recurso] = ruta;

  if (recurso === "login" && m === "POST") return login(request, env);
  if (recurso === "logout" && m === "POST") return json({}, 200, { "set-cookie": cookie("", 0) });

  const yo = await sesion(request, env);
  if (!yo) return json({ error: "Sesión no iniciada" }, 401);
  if (m !== "GET" && m !== "DELETE" && !(request.headers.get("content-type") || "").startsWith("application/json"))
    return json({ error: "Se esperaba JSON" }, 415);
  const cuerpo = () => request.json().catch(() => { throw fallo(400, "JSON inválido"); });

  if (recurso === "sesion" && m === "GET") return json(await perfil(db, yo));
  if (recurso === "clave" && m === "POST") {
    const { actual, nueva } = await cuerpo();
    if (!(await verificarClave(actual, yo.clave))) throw fallo(403, "La clave actual no es correcta");
    await db.prepare("UPDATE usuarios SET clave = ?1 WHERE id = ?2").bind(await hashClave(validarClave(nueva)), yo.id).run();
    return vacio(); // la sesión actual deja de valer: la firma incluye el hash de la clave
  }

  /* ---------- proyectos ---------- */
  if (recurso === "proyectos") {
    const [, pid] = ruta;
    if (!pid && m === "GET") return json((await perfil(db, yo)).proyectos);
    if (!yo.general) throw fallo(403, "Solo el administrador general gestiona proyectos");
    if (!pid && m === "POST") {
      const nombre = texto((await cuerpo()).nombre, "el nombre del proyecto", 120);
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO proyectos (id, nombre, creado) VALUES (?1, ?2, datetime('now'))").bind(id, nombre).run();
      return json({ id, nombre }, 201);
    }
    const p = await proyecto(db, pid);
    if (m === "PATCH") {
      const nombre = texto((await cuerpo()).nombre, "el nombre del proyecto", 120);
      await db.prepare("UPDATE proyectos SET nombre = ?1 WHERE id = ?2").bind(nombre, p.id).run();
      return vacio();
    }
    if (m === "DELETE") {
      if ((await cuerpo()).confirmar !== p.nombre) throw fallo(400, "Escribe el nombre exacto del proyecto para eliminarlo");
      await db.batch([
        db.prepare("DELETE FROM cartas WHERE proyecto_id = ?1").bind(p.id),
        db.prepare("DELETE FROM config WHERE proyecto_id = ?1").bind(p.id),
        db.prepare("DELETE FROM miembros WHERE proyecto_id = ?1").bind(p.id),
        db.prepare("DELETE FROM proyectos WHERE id = ?1").bind(p.id),
      ]);
      return vacio();
    }
  }

  /* ---------- dentro de un proyecto ---------- */
  if (recurso === "p") {
    const [, pid, sub, id] = ruta;
    const p = await proyecto(db, pid);
    const rol = yo.general ? "admin" : (await db.prepare("SELECT rol FROM miembros WHERE usuario_id = ?1 AND proyecto_id = ?2")
      .bind(yo.id, p.id).first())?.rol;
    if (!rol) throw fallo(404, "Proyecto no encontrado"); // no revela si existe
    if (m !== "GET" && rol !== "admin") throw fallo(403, "Tu perfil solo permite consultar");

    if (sub === "cartas" && !id && m === "GET") {
      const { results } = await db.prepare("SELECT id, data FROM cartas WHERE proyecto_id = ?1").bind(p.id).all();
      return json(results.map(r => ({ ...JSON.parse(r.data), id: r.id })));
    }
    if (sub === "cartas" && id && m === "PUT") {
      const body = await cuerpo();
      delete body.id;
      await db.prepare("INSERT INTO cartas (proyecto_id, id, data) VALUES (?1, ?2, ?3) ON CONFLICT(proyecto_id, id) DO UPDATE SET data = ?3")
        .bind(p.id, id, JSON.stringify(body)).run();
      return vacio();
    }
    if (sub === "cartas" && id && m === "DELETE") {
      await db.prepare("DELETE FROM cartas WHERE proyecto_id = ?1 AND id = ?2").bind(p.id, id).run();
      return vacio();
    }
    if (sub === "config" && m === "GET") {
      const row = await db.prepare("SELECT data FROM config WHERE proyecto_id = ?1").bind(p.id).first();
      return json(row ? JSON.parse(row.data) : {});
    }
    if (sub === "config" && m === "PUT") {
      await db.prepare("INSERT INTO config (proyecto_id, data) VALUES (?1, ?2) ON CONFLICT(proyecto_id) DO UPDATE SET data = ?2")
        .bind(p.id, JSON.stringify(await cuerpo())).run();
      return vacio();
    }
    if (sub === "miembros") return miembros(request, db, yo, p, rol, id, cuerpo);
  }

  /* ---------- especialistas ---------- */
  if (recurso === "especialistas") {
    const [, eid] = ruta;
    if (!eid && m === "GET") {
      const { results } = await db.prepare("SELECT id, nombre, orden, activo FROM especialistas ORDER BY orden, nombre").all();
      return json(results.map(e => ({ ...e, activo: !!e.activo })));
    }
    if (!yo.general) throw fallo(403, "Solo el administrador general edita la lista de especialistas");
    if (!eid && m === "POST") {
      const nombre = texto((await cuerpo()).nombre, "el nombre del especialista", 80);
      const id = crypto.randomUUID();
      const r = await db.prepare(`INSERT INTO especialistas (id, nombre, orden)
          VALUES (?1, ?2, (SELECT COALESCE(MAX(orden), 0) + 1 FROM especialistas)) ON CONFLICT(nombre) DO NOTHING`)
        .bind(id, nombre).run();
      if (!r.meta.changes) throw fallo(409, `“${nombre}” ya está en la lista`);
      return json({ id, nombre }, 201);
    }
    const e = await db.prepare("SELECT id, nombre, orden FROM especialistas WHERE id = ?1").bind(eid).first();
    if (!e) throw fallo(404, "Especialista no encontrado");
    if (m === "PATCH") {
      const b = await cuerpo();
      if (b.nombre !== undefined) {
        const nombre = texto(b.nombre, "el nombre del especialista", 80);
        const otro = await db.prepare("SELECT 1 FROM especialistas WHERE nombre = ?1 AND id <> ?2").bind(nombre, e.id).first();
        if (otro) throw fallo(409, `“${nombre}” ya está en la lista`);
        await db.prepare("UPDATE especialistas SET nombre = ?1 WHERE id = ?2").bind(nombre, e.id).run();
      }
      if (b.activo !== undefined)
        await db.prepare("UPDATE especialistas SET activo = ?1 WHERE id = ?2").bind(b.activo ? 1 : 0, e.id).run();
      if (b.mover === "arriba" || b.mover === "abajo") {
        const vecino = await db.prepare(b.mover === "arriba"
          ? "SELECT id, orden FROM especialistas WHERE orden < ?1 ORDER BY orden DESC LIMIT 1"
          : "SELECT id, orden FROM especialistas WHERE orden > ?1 ORDER BY orden LIMIT 1").bind(e.orden).first();
        if (vecino) await db.batch([
          db.prepare("UPDATE especialistas SET orden = ?1 WHERE id = ?2").bind(vecino.orden, e.id),
          db.prepare("UPDATE especialistas SET orden = ?1 WHERE id = ?2").bind(e.orden, vecino.id),
        ]);
      }
      return vacio();
    }
    if (m === "DELETE") {
      const uso = await db.prepare("SELECT COUNT(*) AS n FROM cartas WHERE json_extract(data, '$.derivadoA') = ?1").bind(e.id).first();
      if (uso.n) throw fallo(409, `“${e.nombre}” está asignado a ${uso.n} carta${uso.n === 1 ? "" : "s"}; desactívalo en lugar de eliminarlo`);
      await db.prepare("DELETE FROM especialistas WHERE id = ?1").bind(e.id).run();
      return vacio();
    }
  }

  /* ---------- administradores generales ---------- */
  if (recurso === "usuarios") {
    if (!yo.general) throw fallo(403, "Solo el administrador general gestiona administradores generales");
    const [, uid] = ruta;
    if (!uid && m === "GET") {
      const { results } = await db.prepare(`SELECT u.id, u.usuario, u.nombre, u.general,
          (SELECT json_group_array(json_object('proyecto', p.nombre, 'rol', m.rol)) FROM miembros m JOIN proyectos p ON p.id = m.proyecto_id WHERE m.usuario_id = u.id) AS proyectos
        FROM usuarios u ORDER BY u.general DESC, u.nombre`).all();
      return json(results.map(u => ({ ...u, general: !!u.general, proyectos: JSON.parse(u.proyectos) })));
    }
    if (!uid && m === "POST") {
      const b = await cuerpo();
      const u = await crearUsuario(db, b, true);
      return json(u, 201);
    }
    if (uid && m === "DELETE") {
      if (uid === yo.id) throw fallo(400, "No puedes eliminar tu propio usuario");
      await db.prepare("DELETE FROM usuarios WHERE id = ?1").bind(uid).run();
      return vacio();
    }
  }
  return json({ error: "Ruta no encontrada" }, 404);
}

/* ---------- personas de un proyecto ---------- */
async function miembros(request, db, yo, p, rol, uid, cuerpo) {
  const m = request.method;
  if (rol !== "admin") throw fallo(403, "Tu perfil solo permite consultar");
  if (!uid && m === "GET") {
    const { results } = await db.prepare(`SELECT u.id, u.usuario, u.nombre, m.rol FROM miembros m JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.proyecto_id = ?1 ORDER BY m.rol, u.nombre`).bind(p.id).all();
    return json(results);
  }
  if (!uid && m === "POST") {
    const b = await cuerpo();
    const nuevoRol = b.rol === "admin" ? "admin" : "lector";
    if (nuevoRol === "admin" && !yo.general) throw fallo(403, "Solo el administrador general nombra administradores de proyecto");
    const usuario = normalizarUsuario(b.usuario);
    let u = await db.prepare("SELECT id, usuario, nombre, general FROM usuarios WHERE usuario = ?1").bind(usuario).first();
    if (u?.general) throw fallo(400, "Ese usuario es administrador general y ya ve todos los proyectos");
    if (!u) u = await crearUsuario(db, b, false);
    const ya = await db.prepare("SELECT rol FROM miembros WHERE usuario_id = ?1 AND proyecto_id = ?2").bind(u.id, p.id).first();
    if (ya) throw fallo(409, `“${usuario}” ya pertenece a este proyecto`);
    await db.prepare("INSERT INTO miembros (usuario_id, proyecto_id, rol) VALUES (?1, ?2, ?3)").bind(u.id, p.id, nuevoRol).run();
    return json({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: nuevoRol }, 201);
  }
  const mm = await db.prepare("SELECT rol FROM miembros WHERE usuario_id = ?1 AND proyecto_id = ?2").bind(uid, p.id).first();
  if (!mm) throw fallo(404, "Esa persona no pertenece a este proyecto");
  if (!yo.general && mm.rol !== "lector") throw fallo(403, "Solo puedes gestionar a los lectores de tu proyecto");
  if (m === "PATCH") {
    const b = await cuerpo();
    if (b.rol !== undefined) {
      if (!yo.general) throw fallo(403, "Solo el administrador general cambia perfiles");
      if (!["admin", "lector"].includes(b.rol)) throw fallo(400, "Perfil inválido");
      await db.prepare("UPDATE miembros SET rol = ?1 WHERE usuario_id = ?2 AND proyecto_id = ?3").bind(b.rol, uid, p.id).run();
    }
    if (b.clave !== undefined) {
      // un admin de proyecto no puede cambiar la clave de alguien que también está en otros proyectos
      const otros = await db.prepare("SELECT COUNT(*) AS n FROM miembros WHERE usuario_id = ?1 AND proyecto_id <> ?2").bind(uid, p.id).first();
      if (!yo.general && otros.n > 0) throw fallo(403, "Esta persona está en otros proyectos; pide al administrador general que cambie su clave");
      await db.prepare("UPDATE usuarios SET clave = ?1 WHERE id = ?2").bind(await hashClave(validarClave(b.clave)), uid).run();
    }
    return vacio();
  }
  if (m === "DELETE") {
    await db.prepare("DELETE FROM miembros WHERE usuario_id = ?1 AND proyecto_id = ?2").bind(uid, p.id).run();
    // si ya no pertenece a ningún proyecto, se elimina su cuenta
    await db.prepare(`DELETE FROM usuarios WHERE id = ?1 AND general = 0
      AND NOT EXISTS (SELECT 1 FROM miembros WHERE usuario_id = ?1)`).bind(uid).run();
    return vacio();
  }
  return json({ error: "Ruta no encontrada" }, 404);
}

/* ---------- datos ---------- */
async function proyecto(db, pid) {
  const p = pid && await db.prepare("SELECT id, nombre FROM proyectos WHERE id = ?1").bind(pid).first();
  if (!p) throw fallo(404, "Proyecto no encontrado");
  return p;
}

async function perfil(db, yo) {
  const { results } = yo.general
    ? await db.prepare("SELECT id, nombre, 'admin' AS rol FROM proyectos ORDER BY nombre").all()
    : await db.prepare(`SELECT p.id, p.nombre, m.rol FROM miembros m JOIN proyectos p ON p.id = m.proyecto_id
        WHERE m.usuario_id = ?1 ORDER BY p.nombre`).bind(yo.id).all();
  return { id: yo.id, usuario: yo.usuario, nombre: yo.nombre, general: !!yo.general, proyectos: results };
}

const texto = (v, que, max) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw fallo(400, `Falta ${que}`);
  if (s.length > max) throw fallo(400, `${que[0].toUpperCase() + que.slice(1)} es demasiado largo`);
  return s;
};
const normalizarUsuario = v => {
  const s = texto(v, "el usuario", 60).toLowerCase();
  if (!/^[a-z0-9._@-]{3,60}$/.test(s)) throw fallo(400, "El usuario solo puede tener letras, números y . _ @ - (mínimo 3)");
  return s;
};
const validarClave = v => {
  if (typeof v !== "string" || v.length < 8) throw fallo(400, "La clave debe tener al menos 8 caracteres");
  return v;
};

async function crearUsuario(db, b, general) {
  const usuario = normalizarUsuario(b.usuario);
  const nombre = texto(b.nombre, "el nombre de la persona", 120);
  const clave = await hashClave(validarClave(b.clave));
  const id = crypto.randomUUID();
  const r = await db.prepare(`INSERT INTO usuarios (id, usuario, nombre, clave, general, creado)
      VALUES (?1, ?2, ?3, ?4, ?5, datetime('now')) ON CONFLICT(usuario) DO NOTHING`)
    .bind(id, usuario, nombre, clave, general ? 1 : 0).run();
  if (!r.meta.changes) throw fallo(409, `El usuario “${usuario}” ya existe`);
  return { id, usuario, nombre, general };
}

/* ---------- sesión ---------- */
async function login(request, env) {
  if (!env.SESSION_SECRET) throw fallo(500, "Falta el secret SESSION_SECRET");
  const db = env.DB;
  const { usuario, clave } = await request.json().catch(() => ({}));
  if (typeof usuario !== "string" || typeof clave !== "string" || !usuario || !clave) return json({ error: "Usuario o clave incorrectos" }, 401);
  const nombre = usuario.trim().toLowerCase();
  let u = await db.prepare("SELECT id, clave FROM usuarios WHERE usuario = ?1").bind(nombre).first();

  // primer ingreso: sin usuarios, "admin" + ADMIN_PASSWORD crea el administrador general
  if (!u && nombre === "admin" && env.ADMIN_PASSWORD && await iguales(clave, env.ADMIN_PASSWORD)) {
    const hay = await db.prepare("SELECT 1 FROM usuarios LIMIT 1").first();
    if (!hay) {
      await crearUsuario(db, { usuario: "admin", nombre: "Administrador general", clave }, true);
      u = await db.prepare("SELECT id, clave FROM usuarios WHERE usuario = 'admin'").first();
    }
  }
  // se calcula el hash aunque el usuario no exista para no revelar cuáles existen
  const ok = await verificarClave(clave, u?.clave || "pbkdf2$" + ITERACIONES + "$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!u || !ok) return json({ error: "Usuario o clave incorrectos" }, 401);
  const exp = Math.floor(Date.now() / 1000) + DURACION;
  const firma = await firmar(env, `${u.id}.${exp}.${u.clave}`);
  return json({}, 200, { "set-cookie": cookie(`${u.id}.${exp}.${firma}`, DURACION) });
}

async function sesion(request, env) {
  const c = (request.headers.get("cookie") || "").split(/;\s*/).find(s => s.startsWith(COOKIE + "="));
  if (!c) return null;
  const [id, exp, firma] = c.slice(COOKIE.length + 1).split(".");
  if (!id || !(Number(exp) > Date.now() / 1000) || !firma) return null;
  if (!env.SESSION_SECRET) throw fallo(500, "Falta el secret SESSION_SECRET");
  const u = await env.DB.prepare("SELECT id, usuario, nombre, clave, general FROM usuarios WHERE id = ?1").bind(id).first();
  if (!u) return null;
  return (await iguales(firma, await firmar(env, `${u.id}.${exp}.${u.clave}`))) ? u : null;
}

const cookie = (valor, maxAge) =>
  `${COOKIE}=${valor}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

async function firmar(env, valor) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(valor)));
}

async function pbkdf2(clave, sal, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iter }, key, 256);
}
async function hashClave(clave) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACIONES}$${b64(sal)}$${b64(await pbkdf2(clave, sal, ITERACIONES))}`;
}
async function verificarClave(clave, guardado) {
  const [alg, iter, sal, hash] = String(guardado).split("$");
  if (alg !== "pbkdf2" || typeof clave !== "string") return false;
  const calc = new Uint8Array(await pbkdf2(clave, unb64(sal), Number(iter)));
  const esperado = unb64(hash);
  return calc.length === esperado.length && crypto.subtle.timingSafeEqual(calc, esperado);
}

// compara en tiempo constante (hash de ambos lados para igualar longitudes)
async function iguales(a, b) {
  const h = s => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return crypto.subtle.timingSafeEqual(await h(a), await h(b));
}
