-- Catálogo de especialistas a los que se deriva una carta. Es común a todos los
-- proyectos y solo lo edita el administrador general.
CREATE TABLE especialistas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  orden INTEGER NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);
INSERT INTO especialistas (id, nombre, orden) VALUES
  ('seg-informacion', 'Seg. de la Inf.', 1),
  ('sanitario', 'Sanitario', 2),
  ('estructuras', 'Estructuras', 3),
  ('electricista', 'Electricista', 4),
  ('calidad', 'Calidad', 5),
  ('arquitectura', 'Arquitectura', 6),
  ('representante-comun', 'Representante Común', 7),
  ('jefe-supervision', 'Jefe de Supervisión', 8);
