// Planillas de Control UET 5 · API (Neon Function, sin dependencias).
// Usa el endpoint SQL-sobre-HTTP de Neon; un batch corre dentro de una transaccion.
const DB = process.env.DATABASE_URL as string;
const HOST = new URL(DB).hostname;
type Q = { query: string; params?: unknown[] };
async function http(body: unknown): Promise<any> {
  const r = await fetch(`https://${HOST}/sql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Neon-Connection-String': DB },
    body: JSON.stringify(body),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(j?.message || 'db error');
  return j;
}
const db = {
  q: async (query: string, params: unknown[] = []) => ((await http({ query, params })).rows as any[]),
  batch: async (qs: Q[]) => (await http({ queries: qs })).results as { rows: any[] }[],
};
const J = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-clave,x-email',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const lista = (v?: string) => (v || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
// Rol segun clave + email autorizado (listas en variables de entorno EMAILS_ING / EMAILS_CARGA).
function rol(req: Request): 'ing' | 'carga' | null {
  const k = req.headers.get('x-clave');
  let em = '';
  try { em = decodeURIComponent(req.headers.get('x-email') || '').trim().toLowerCase(); } catch { /* */ }
  if (!k || !em) return null;
  const ing = lista(process.env.EMAILS_ING);
  const todos = [...lista(process.env.EMAILS_CARGA), ...ing];
  if (process.env.CLAVE_ING && k === process.env.CLAVE_ING && ing.includes(em)) return 'ing';
  if (process.env.CLAVE_CARGA && k === process.env.CLAVE_CARGA && todos.includes(em)) return 'carga';
  return null;
}

async function bootstrap() {
  const [maquinas, categorias, causas, estandares, config] = await Promise.all([
    db.q('select id,nombre,codigo_std,estado_default,nota,orden,activa from maquinas order by orden'),
    db.q('select id,nombre,orden from categorias_parada order by orden'),
    db.q('select id,categoria_id,nombre from causas where activa order by categoria_id,id'),
    db.q(`select e.id, o.pieza_codigo codigo, o.op, o.nombre opn, p.descripcion comp, e.maquina_id,
              e.std_golpes_h std, e.std_alt, e.piezas_por_golpe, e.estado, e.validado, e.fuente,
              coalesce((select json_agg(m.nombre order by m.nombre) from modelo_pieza mp join modelos m on m.id=mp.modelo_id where mp.pieza_codigo=o.pieza_codigo),'[]'::json) modelos
       from estandares e join operaciones o on o.id=e.operacion_id join piezas p on p.codigo=o.pieza_codigo
       order by e.maquina_id,o.pieza_codigo,o.op`),
    db.q('select clave,valor from config'),
  ]);
  return {
    maquinas, categorias, causas,
    estandares: estandares.map((e: any) => ({ ...e, modelos: J(e.modelos) })),
    config: Object.fromEntries(config.map((c: any) => [c.clave, J(c.valor)])),
  };
}

async function getRegistros(url: URL) {
  const d = url.searchParams.get('desde') || '1900-01-01';
  const h = url.searchParams.get('hasta') || '2999-12-31';
  const [regs, tr, pa, tu] = await Promise.all([
    db.q(`select to_char(fecha,'YYYY-MM-DD') fecha, turno, maquina_id, estado, carga_min from registros where fecha between $1 and $2`, [d, h]),
    db.q(`select to_char(fecha,'YYYY-MM-DD') fecha, turno, maquina_id, estandar_id, std_snapshot, minutos, golpes, piezas_scrap, hora_ini, hora_fin, obs, pieza_manual, codigo_manual, op_manual from tramos_produccion where fecha between $1 and $2 order by id`, [d, h]),
    db.q(`select to_char(p.fecha,'YYYY-MM-DD') fecha, p.turno, p.maquina_id, p.categoria_id, c.nombre causa, p.minutos, p.nota, p.hora_ini, p.hora_fin from paradas p left join causas c on c.id=p.causa_id where p.fecha between $1 and $2 order by p.id`, [d, h]),
    db.q(`select to_char(fecha,'YYYY-MM-DD') fecha, turno, sup_leg, sup_nom, cerrado from turnos where fecha between $1 and $2`, [d, h]),
  ]);
  const key = (r: any) => `${r.fecha}|${r.turno}|${r.maquina_id}`;
  const map = new Map<string, any>();
  for (const r of regs) map.set(key(r), { ...r, tramos: [], paradas: [] });
  for (const t of tr) map.get(key(t))?.tramos.push(t);
  for (const p of pa) map.get(key(p))?.paradas.push(p);
  return { registros: [...map.values()], turnos: tu };
}

async function putRegistro(b: any) {
  const k = [b.fecha, b.turno, b.maquina_id];
  const qs: Q[] = [
    { query: `insert into registros(fecha,turno,maquina_id,estado,carga_min,actualizado) values($1,$2,$3,$4,$5,now())
       on conflict(fecha,turno,maquina_id) do update set estado=$4,carga_min=$5,actualizado=now()`, params: [...k, b.estado || 'OPERA', b.carga_min ?? null] },
    { query: 'delete from tramos_produccion where fecha=$1 and turno=$2 and maquina_id=$3', params: k },
    { query: 'delete from paradas where fecha=$1 and turno=$2 and maquina_id=$3', params: k },
  ];
  for (const t of b.tramos || [])
    qs.push({ query: `insert into tramos_produccion(fecha,turno,maquina_id,estandar_id,operacion_id,std_snapshot,minutos,golpes,piezas_scrap,hora_ini,hora_fin,obs,pieza_manual,codigo_manual,op_manual)
         values($1,$2,$3,$4,(select operacion_id from estandares where id=$4),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      params: [...k, t.estandar_id || null, t.std_snapshot || 0, t.minutos || 0, t.golpes || 0, t.piezas_scrap || 0, t.hora_ini || null, t.hora_fin || null, t.obs || null, t.pieza_manual || null, t.codigo_manual || null, t.op_manual || null] });
  for (const p of b.paradas || [])
    qs.push({ query: `insert into paradas(fecha,turno,maquina_id,categoria_id,causa_id,minutos,nota,hora_ini,hora_fin)
         values($1,$2,$3,$4,(select id from causas where categoria_id=$4 and nombre=$5 limit 1),$6,$7,$8,$9)`,
      params: [...k, p.categoria_id, p.causa || null, p.minutos || 0, p.nota || null, p.hora_ini || null, p.hora_fin || null] });
  await db.batch(qs);
}

// vincula modelos ("A / B") a la pieza
function modeloQs(codigo: string, modelo: string | undefined, ppu: number): Q[] {
  const qs: Q[] = [];
  for (const mo of String(modelo || '').split('/').map((s) => s.trim()).filter(Boolean)) {
    qs.push({ query: 'insert into modelos(nombre) values($1) on conflict(nombre) do nothing', params: [mo] });
    qs.push({ query: 'insert into modelo_pieza(modelo_id,pieza_codigo,cantidad_por_unidad) values((select id from modelos where nombre=$1),$2,$3) on conflict do nothing', params: [mo, codigo, ppu || 1] });
  }
  return qs;
}
const opQs = (codigo: string, op: string, comp?: string, opn?: string): Q[] => [
  { query: "insert into piezas(codigo,descripcion) values($1,$2) on conflict(codigo) do update set descripcion=coalesce(nullif($2,''),piezas.descripcion)", params: [codigo, comp || ''] },
  { query: "insert into operaciones(pieza_codigo,op,nombre) values($1,$2,$3) on conflict(pieza_codigo,op) do update set nombre=coalesce(nullif($3,''),operaciones.nombre)", params: [codigo, op, opn || ''] },
];

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return json({ ok: true, servicio: 'planillas-control-uet5' });
    const r = rol(req);
    if (!r) return json({ error: 'clave invalida' }, 401);
    try {
      if (path === '/whoami') return json({ rol: r });
      if (path === '/bootstrap' && req.method === 'GET') return json(await bootstrap());
      if (path === '/registros' && req.method === 'GET') return json(await getRegistros(url));
      if (path === '/registros' && req.method === 'PUT') { await putRegistro(await req.json()); return json({ ok: true }); }
      if (path === '/turnos' && req.method === 'PUT') {
        const b: any = await req.json();
        await db.q(`insert into turnos(fecha,turno,sup_leg,sup_nom,cerrado,actualizado) values($1,$2,$3,$4,$5,now())
          on conflict(fecha,turno) do update set sup_leg=$3,sup_nom=$4,cerrado=$5,actualizado=now()`, [b.fecha, b.turno, b.sup_leg || '', b.sup_nom || '', !!b.cerrado]);
        return json({ ok: true });
      }
      if (r !== 'ing') return json({ error: 'requiere clave de ingenieria' }, 403);

      if (path === '/estandares' && req.method === 'POST') {
        const b: any = await req.json();
        const qs: Q[] = [
          ...opQs(b.codigo, b.op, b.comp, b.opn),
          ...modeloQs(b.codigo, b.modelo, b.ppu),
          { query: "insert into estandares(operacion_id,maquina_id,std_golpes_h,estado,fuente) values((select id from operaciones where pieza_codigo=$1 and op=$2),$3,$4,'nuevo','app') returning id", params: [b.codigo, b.op, b.maquina_id, b.std] },
        ];
        const res = await db.batch(qs);
        return json({ id: res[res.length - 1].rows[0].id });
      }
      const m = path.match(/^\/estandares\/(\d+)$/);
      if (m && req.method === 'PUT') {
        const b: any = await req.json();
        const qs: Q[] = [];
        if (b.codigo && b.op) {
          qs.push(...opQs(b.codigo, b.op, b.comp, b.opn), ...modeloQs(b.codigo, b.modelo, 1));
          qs.push({ query: 'update estandares set operacion_id=(select id from operaciones where pieza_codigo=$2 and op=$3) where id=$1', params: [m[1], b.codigo, b.op] });
        }
        qs.push({ query: `update estandares set std_golpes_h=coalesce($2,std_golpes_h), std_alt=$3, validado=coalesce($4,validado), estado=coalesce($5,estado), maquina_id=coalesce($6,maquina_id), actualizado=now() where id=$1`,
          params: [m[1], b.std ?? null, b.std_alt ?? null, b.validado ?? null, b.estado ?? null, b.maquina_id ?? null] });
        await db.batch(qs);
        return json({ ok: true });
      }
      if (m && req.method === 'DELETE') {
        try { await db.q('delete from estandares where id=$1', [m[1]]); }
        catch { return json({ error: 'El estandar tiene registros cargados y no se puede eliminar.' }, 409); }
        return json({ ok: true });
      }
      if (path === '/causas/sync' && req.method === 'PUT') {
        const b: any = await req.json();
        const names: string[] = (b.nombres || []).map((s: string) => String(s).trim()).filter(Boolean);
        const qs: Q[] = [{ query: 'update causas set activa=false where categoria_id=$1 and not (nombre = any($2::text[]))', params: [b.categoria_id, names] }];
        for (const n of names) qs.push({ query: 'insert into causas(categoria_id,nombre,activa) values($1,$2,true) on conflict(categoria_id,nombre) do update set activa=true', params: [b.categoria_id, n] });
        await db.batch(qs);
        return json({ ok: true });
      }
      const mq = path.match(/^\/maquinas\/([A-Za-z0-9]+)$/);
      if (mq && req.method === 'PUT') {
        const b: any = await req.json();
        await db.q('update maquinas set nombre=coalesce($2,nombre), codigo_std=coalesce($3,codigo_std), estado_default=coalesce($4,estado_default), nota=coalesce($5,nota) where id=$1',
          [mq[1], b.nombre ?? null, b.codigo_std ?? null, b.estado_default ?? null, b.nota ?? null]);
        return json({ ok: true });
      }
      const cf = path.match(/^\/config\/(\w+)$/);
      if (cf && req.method === 'PUT') {
        await db.q('insert into config(clave,valor) values($1,$2::jsonb) on conflict(clave) do update set valor=$2::jsonb, actualizado=now()', [cf[1], JSON.stringify(await req.json())]);
        return json({ ok: true });
      }
      return json({ error: 'no encontrado' }, 404);
    } catch (e: any) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};
