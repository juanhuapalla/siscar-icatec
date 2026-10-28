# siscar-icatec
Sistema de control documental de cartas

Aplicación de una sola página (`index.html`) para llevar la trazabilidad de las cartas de un proyecto. Los documentos se guardan en Drive; la app solo registra metadatos y enlaces.

- Registro de cartas: N°, fecha, remitente, destinatario, asunto, enlace a Drive y carta a la que responde.
- Fecha límite de respuesta en días hábiles (sin sábados, domingos ni feriados de Perú) o calendario.
- Alertas de cartas por vencer y vencidas.
- Cálculo de días de penalidad del ejecutor y monto, si se configura la penalidad diaria.
- Cadena de trazabilidad carta → respuesta.
- Expedientes: agrupan cartas de un mismo tema aunque estén en cadenas distintas; filtro y vista con línea de tiempo, cartas abiertas y penalidad del expediente.
- Derivación a especialista (Seg. de la Inf., Sanitario, Estructuras, etc.), con filtro en la tabla. La lista es común a todos los proyectos y solo el admin general la mantiene: agregar, renombrar, ordenar, desactivar o eliminar (solo si ninguna carta lo usa).
- Efecto de cada respuesta: cierra el plazo de la carta a la que responde, es parcial (el plazo sigue) u otorga una ampliación de N días que mueve la fecha límite.

## Arquitectura
- `public/index.html`: la aplicación.
- `src/worker.js`: Cloudflare Worker que sirve la página y la API sobre D1.
- `migrations/`: esquema de D1 (se aplica con `npx wrangler d1 migrations apply siscar-icatec --remote`).

## Despliegue
El Worker está conectado a este repo en Cloudflare: cada push a `main` se despliega solo (`npx wrangler deploy`).
Si el cambio trae una migración nueva, aplícala en producción justo antes del push.

## Proyectos y perfiles
Cada proyecto es un espacio aislado: sus cartas, ajustes y personas no se ven desde otro proyecto (la API responde 404 a quien no pertenece).
Cada persona ingresa con su propio usuario y clave, y tiene un perfil por proyecto:
- **Admin general**: crea, renombra y elimina proyectos; mantiene la lista de especialistas; nombra admins de proyecto y otros admins generales; ve todos los proyectos.
- **Admin del proyecto**: registra, edita y elimina cartas, cambia los ajustes y da de alta o de baja a los lectores de su proyecto.
- **Lector**: solo consulta su proyecto.

Una persona puede estar en varios proyectos. Al quitarla de su último proyecto se elimina su cuenta.
Las claves se guardan con PBKDF2; cambiar la clave cierra las sesiones abiertas con la clave anterior. La sesión dura 12 horas.

Secrets del Worker:
- `SESSION_SECRET`: firma de sesión, un valor aleatorio largo (`openssl rand -base64 32`). Cambiarlo cierra todas las sesiones.
- `ADMIN_PASSWORD`: solo sirve para el primer ingreso. Mientras no exista ningún usuario, entrar con el usuario `admin` y esta clave crea el administrador general. Después se puede borrar.

Prueba local: crea `.dev.vars` con `ADMIN_PASSWORD=…` y `SESSION_SECRET=…`, ejecuta `npx wrangler d1 migrations apply siscar-icatec --local` y luego `npx wrangler dev`.
