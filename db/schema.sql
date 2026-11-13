-- PlanillasdeControl · esquema PostgreSQL (Neon). Borrador v1, todavía sin conectar al frontend.
CREATE TABLE maquinas (
  id text PRIMARY KEY,            -- EP04, EP24, ... (código de la planilla de pérdidas)
  nombre text NOT NULL,
  codigo_std text NOT NULL,       -- código en el maestro de estándares (E-P04, LC-06+LC-08, ...)
  estado_default text NOT NULL DEFAULT 'OPERA' CHECK (estado_default IN ('OPERA','FS')),
  nota text
);
CREATE TABLE estandares (
  id serial PRIMARY KEY,
  modelo text NOT NULL, codigo text NOT NULL, componente text NOT NULL,
  cod_operacion text NOT NULL, nombre_operacion text,
  maquina_std text NOT NULL,
  piezas_por_unidad numeric,
  std_golpes_h numeric NOT NULL,
  std_alternativo numeric,        -- valor de la otra planilla cuando había conflicto
  estado text NOT NULL DEFAULT 'unica' CHECK (estado IN ('ok','conflicto','unica','nuevo')),
  validado boolean NOT NULL DEFAULT false,
  fecha_toma_tiempos date,
  modificado_por text, modificado_en timestamptz DEFAULT now(),
  UNIQUE (modelo, codigo, cod_operacion, maquina_std)
);
CREATE TABLE categorias_parada (id text PRIMARY KEY, nombre text NOT NULL, color text);
CREATE TABLE causas (id serial PRIMARY KEY, categoria_id text REFERENCES categorias_parada(id), nombre text NOT NULL, activa boolean DEFAULT true);
CREATE TABLE turnos (            -- cabecera del cierre: fecha + turno
  fecha date NOT NULL, turno text NOT NULL CHECK (turno IN ('MAÑANA','TARDE','NOCHE')),
  supervisor_legajo text NOT NULL, supervisor_nombre text NOT NULL,
  cerrado boolean NOT NULL DEFAULT false, cerrado_en timestamptz,
  PRIMARY KEY (fecha, turno)
);
CREATE TABLE registros (         -- una fila por fecha + turno + máquina
  id serial PRIMARY KEY,
  fecha date NOT NULL, turno text NOT NULL,
  maquina_id text NOT NULL REFERENCES maquinas(id),
  estado text NOT NULL DEFAULT 'OPERA' CHECK (estado IN ('OPERA','NOPROG','FS')),
  carga_min int NOT NULL DEFAULT 485,
  FOREIGN KEY (fecha, turno) REFERENCES turnos(fecha, turno),
  UNIQUE (fecha, turno, maquina_id)
);
CREATE TABLE tramos_produccion (
  id serial PRIMARY KEY, registro_id int NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
  estandar_id int REFERENCES estandares(id),
  pieza text, std_golpes_h numeric,   -- snapshot del estándar al momento de cargar
  hora_inicio time, hora_fin time, minutos int NOT NULL,
  golpes int NOT NULL, piezas_malas int NOT NULL DEFAULT 0, obs text
);
CREATE TABLE paradas (
  id serial PRIMARY KEY, registro_id int NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
  categoria_id text NOT NULL REFERENCES categorias_parada(id), causa_id int REFERENCES causas(id),
  hora_inicio time, hora_fin time, minutos int NOT NULL, detalle text
);
