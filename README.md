# siscar-icatec
Sistema de control documental de cartas

Aplicación de una sola página (`index.html`) para llevar la trazabilidad de las cartas de un proyecto. Los documentos se guardan en Drive; la app solo registra metadatos y enlaces.

- Registro de cartas: N°, fecha, remitente, destinatario, asunto, enlace a Drive y carta a la que responde.
- Fecha límite de respuesta en días hábiles (sin sábados, domingos ni feriados de Perú) o calendario.
- Alertas de cartas por vencer y vencidas.
- Cálculo de días de penalidad del ejecutor y monto, si se configura la penalidad diaria.
- Cadena de trazabilidad carta → respuesta.
- Expedientes: agrupan cartas de un mismo tema aunque estén en cadenas distintas; filtro y vista con línea de tiempo, cartas abiertas y penalidad del expediente.
- Efecto de cada respuesta: cierra el plazo de la carta a la que responde, es parcial (el plazo sigue) u otorga una ampliación de N días que mueve la fecha límite.

## Arquitectura
- `public/index.html`: la aplicación.
- `src/worker.js`: Cloudflare Worker que sirve la página y la API sobre D1.
- `schema.sql`: tablas de D1.

## Despliegue
El Worker está conectado a este repo en Cloudflare: cada push a `main` se despliega solo (`npx wrangler deploy`).

## Perfiles de acceso
Todos ingresan con una clave; sin sesión la API responde 401.
- **admin**: registra, edita y elimina cartas, y cambia los ajustes.
- **lector**: solo consulta (la API rechaza con 403 cualquier escritura).

Las claves y la firma de sesión son secrets del Worker (antes de desplegar esta versión):
```
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put LECTOR_PASSWORD
npx wrangler secret put SESSION_SECRET
```
`SESSION_SECRET` debe ser un valor aleatorio largo (por ejemplo `openssl rand -base64 32`). Cambiarlo cierra todas las sesiones abiertas. La sesión dura 12 horas.

Prueba local: crea `.dev.vars` con `ADMIN_PASSWORD=…`, `LECTOR_PASSWORD=…` y `SESSION_SECRET=…`, ejecuta `npx wrangler d1 execute siscar-icatec --local --file=schema.sql` y luego `npx wrangler dev`.
