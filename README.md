# siscar-icatec
Sistema de control documental de cartas

Aplicación de una sola página (`index.html`) para llevar la trazabilidad de las cartas de un proyecto. Los documentos se guardan en Drive; la app solo registra metadatos y enlaces.

- Registro de cartas: N°, fecha, remitente, destinatario, asunto, enlace a Drive y carta a la que responde.
- Fecha límite de respuesta en días hábiles (sin sábados, domingos ni feriados de Perú) o calendario.
- Alertas de cartas por vencer y vencidas.
- Cálculo de días de penalidad del ejecutor y monto, si se configura la penalidad diaria.
- Cadena de trazabilidad carta → respuesta.

## Arquitectura
- `public/index.html`: la aplicación (Cloudflare Pages).
- `functions/api/[[path]].js`: API (Pages Functions) sobre Cloudflare D1.
- `schema.sql`: tablas de D1.

## Despliegue en Cloudflare
Requiere Node.js y una cuenta de Cloudflare.

```bash
npm i -g wrangler
wrangler login
wrangler d1 create siscar-icatec          # copia el database_id que muestra
# pega ese id en wrangler.toml (database_id)
wrangler d1 execute siscar-icatec --remote --file=schema.sql
wrangler pages deploy
```

La app queda en `https://siscar-icatec.pages.dev`. Para restringir el acceso, activa Cloudflare Access (Zero Trust) sobre ese dominio.

Prueba local: `wrangler d1 execute siscar-icatec --local --file=schema.sql` y luego `wrangler pages dev`.
