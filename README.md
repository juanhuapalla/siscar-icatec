# siscar-icatec
Sistema de control documental de cartas

Aplicación de una sola página (`index.html`) para llevar la trazabilidad de las cartas de un proyecto. Los documentos se guardan en Drive; la app solo registra metadatos y enlaces.

- Registro de cartas: N°, fecha, remitente, destinatario, asunto, enlace a Drive y carta a la que responde.
- Fecha límite de respuesta en días hábiles (sin sábados, domingos ni feriados de Perú) o calendario.
- Alertas de cartas por vencer y vencidas.
- Cálculo de días de penalidad del ejecutor y monto, si se configura la penalidad diaria.
- Cadena de trazabilidad carta → respuesta.

## Almacenamiento
Los datos se guardan en la base de datos de un Artifact de Claude (`claude.use("db")`). Abierta fuera de Claude, la página carga pero no puede leer ni guardar cartas.
