# PlanillasdeControlAPI

Backend de [PlanillasdeControl](../PlanillasdeControl) (control de la UET 5 · Escorial). **Estado: borrador.** Por ahora solo está el esquema de datos (`db/schema.sql`, PostgreSQL / Neon); el frontend v1 guarda en el navegador y todavía no consume esta API.

## Próximos pasos
1. Crear la base en Neon y aplicar `db/schema.sql`.
2. Worker (Cloudflare) con endpoints: `GET/PUT /estandares`, `GET/PUT /maquinas`, `GET/PUT /causas`, `PUT /cierres/{fecha}/{turno}/{maquina}`, `GET /informe?fecha=&turno=&maquina=`.
3. Importar historial de pérdidas (desde junio) con causas normalizadas al catálogo.

Desarrollado por Mgter. Diego Ortiz — Líder de Mejora Continua | Consultor ISO
