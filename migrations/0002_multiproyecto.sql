-- Varios proyectos con usuarios propios.
-- Las cartas y los ajustes pasan a pertenecer a un proyecto; si ya había datos,
-- se crea el proyecto "icatec" y todo lo existente queda en él.
CREATE TABLE proyectos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  creado TEXT NOT NULL
);
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  clave TEXT NOT NULL,              -- pbkdf2$iteraciones$sal$hash
  general INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL
);
CREATE TABLE miembros (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  proyecto_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'lector')),
  PRIMARY KEY (usuario_id, proyecto_id)
);

INSERT INTO proyectos (id, nombre, creado)
  SELECT 'icatec', 'ICATEC – CUI 2643810 GORE Ica', datetime('now')
  WHERE EXISTS (SELECT 1 FROM cartas) OR EXISTS (SELECT 1 FROM config);

-- la clave primaria incluye el proyecto: un id de otro proyecto nunca se pisa
CREATE TABLE cartas_nueva (
  proyecto_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (proyecto_id, id)
);
INSERT INTO cartas_nueva (proyecto_id, id, data) SELECT 'icatec', id, data FROM cartas;
DROP TABLE cartas;
ALTER TABLE cartas_nueva RENAME TO cartas;

CREATE TABLE config_nueva (
  proyecto_id TEXT PRIMARY KEY REFERENCES proyectos(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
INSERT INTO config_nueva (proyecto_id, data) SELECT 'icatec', data FROM config WHERE id = 'general';
DROP TABLE config;
ALTER TABLE config_nueva RENAME TO config;
