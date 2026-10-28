# siscar-icatec
Sistema de control documental de cartas

Aplicación de una sola página (`index.html`) para llevar la trazabilidad de las cartas de un proyecto. Los documentos se guardan en Drive; la app solo registra metadatos y enlaces.

- Registro de cartas: N°, fecha, remitente, destinatario, asunto, enlace a Drive y carta a la que responde.
- Fecha límite de respuesta en días hábiles (sin sábados, domingos ni feriados de Perú) o calendario.
- Alertas de cartas por vencer y vencidas.
- Cálculo de días de penalidad del ejecutor y monto, si se configura la penalidad diaria.
- Cadena de trazabilidad carta → respuesta.

## Arquitectura
- `public/index.html`: la aplicación.
- `src/worker.js`: Cloudflare Worker que sirve la página y la API sobre D1.
- `schema.sql`: tablas de D1.

## Despliegue
El Worker está conectado a este repo en Cloudflare: cada push a `main` se despliega solo (`npx wrangler deploy`).

Para restringir el acceso, activa Cloudflare Access (Zero Trust) sobre el dominio del Worker.

Prueba local: `npx wrangler d1 execute siscar-icatec --local --file=schema.sql` y luego `npx wrangler dev`.
