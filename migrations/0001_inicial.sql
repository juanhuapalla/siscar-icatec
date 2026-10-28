-- Esquema original (un solo proyecto). Ya existe en producción; IF NOT EXISTS lo hace inocuo.
CREATE TABLE IF NOT EXISTS cartas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, data TEXT NOT NULL);
