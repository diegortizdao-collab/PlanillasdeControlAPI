# PlanillasdeControlAPI

API de **Planillas de Control · UET 5 (Escorial)**. Corre como *Neon Function* (`plancontrol`) sobre el proyecto Neon `planillas-control-uet5` (aws-us-east-1) — sin dependencias: usa el endpoint SQL-sobre-HTTP de Neon (cada `batch` es una transacción).

- Código: `functions/api/index.ts` · Esquema: `db/schema.sql`
- Auth: header `x-clave`. Dos claves (variables de entorno de la función): `CLAVE_CARGA` (cargar cierres y turnos, ver todo) y `CLAVE_ING` (además edita estándares, máquinas, causas y configuración).
- CORS abierto. `GET /` sin clave responde el estado.

| Método | Ruta | Rol |
|---|---|---|
| GET | `/whoami`, `/bootstrap`, `/registros?desde=&hasta=` | carga / ing |
| PUT | `/registros`, `/turnos` | carga / ing |
| POST/PUT/DELETE | `/estandares`, `/estandares/:id` | ing |
| PUT | `/causas/sync`, `/maquinas/:id`, `/config/:clave` | ing |

## Modelo por piezas
`piezas` → `operaciones` (ítem de stock/WIP: pieza + op) → `estandares` (por máquina). `modelo_pieza` es un BOM liviano (cantidad por unidad de producto). Cada tramo de producción guarda el estándar con el que se registró (`std_snapshot`). La vista `v_produccion_pieza` ya entrega piezas buenas por pieza/operación/día: es la base del control de stock.

## Desplegar
```
npm install
npx esbuild functions/api/index.ts --bundle --minify --platform=node --target=node24 --format=esm --outfile=dist/index.mjs
zip -j function.zip dist/index.mjs   # y subir como deployment de la función (slug: plancontrol)
```
