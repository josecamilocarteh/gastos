import { get, put } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

// Todos los gastos viven en un único archivo JSON privado en Vercel Blob.
const RUTA = 'gastos/datos.json';

const CATS_INICIALES = [
  { id: 'supermercado', nombre: 'Supermercado', presupuesto: 0 },
  { id: 'comida-fuera', nombre: 'Comida fuera', presupuesto: 0 },
  { id: 'transporte', nombre: 'Transporte', presupuesto: 0 },
  { id: 'cuentas', nombre: 'Cuentas (luz, agua, internet)', presupuesto: 0 },
  { id: 'salud', nombre: 'Salud', presupuesto: 0 },
  { id: 'entretencion', nombre: 'Entretención', presupuesto: 0 },
  { id: 'ropa', nombre: 'Ropa', presupuesto: 0 },
  { id: 'otros', nombre: 'Otros', presupuesto: 0 },
];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function pinValido(req) {
  const esperado = process.env.APP_PIN || '';
  const recibido = req.headers.get('x-pin') || '';
  if (!esperado || recibido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function limpiarGasto(g) {
  if (!g || typeof g !== 'object') return null;
  const monto = Math.round(Number(g.monto));
  if (!ID.test(String(g.id)) || !FECHA.test(String(g.fecha)) || !ID.test(String(g.cat))) return null;
  if (!Number.isFinite(monto) || monto <= 0 || monto > 1e10) return null;
  return {
    id: String(g.id),
    fecha: String(g.fecha),
    monto,
    cat: String(g.cat),
    nota: typeof g.nota === 'string' ? g.nota.trim().slice(0, 120) : '',
    creado: Number.isFinite(Number(g.creado)) ? Number(g.creado) : Date.now(),
  };
}

function limpiarCats(cs) {
  if (!Array.isArray(cs) || cs.length === 0 || cs.length > 40) return null;
  const out = [];
  const ids = new Set();
  for (const c of cs) {
    const nombre = typeof c?.nombre === 'string' ? c.nombre.trim().slice(0, 40) : '';
    const presupuesto = Math.max(0, Math.round(Number(c?.presupuesto) || 0));
    if (!ID.test(String(c?.id)) || !nombre || ids.has(c.id)) return null;
    ids.add(c.id);
    out.push({ id: String(c.id), nombre, presupuesto });
  }
  return out;
}

async function leer() {
  const r = await get(RUTA, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return { categorias: CATS_INICIALES, gastos: [] };
  try {
    const d = JSON.parse(await new Response(r.stream).text());
    return {
      categorias: Array.isArray(d.categorias) && d.categorias.length ? d.categorias : CATS_INICIALES,
      gastos: Array.isArray(d.gastos) ? d.gastos : [],
    };
  } catch {
    return { categorias: CATS_INICIALES, gastos: [] };
  }
}

async function guardar(d) {
  await put(RUTA, JSON.stringify(d), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export async function GET(req) {
  if (!pinValido(req)) return json({ error: 'PIN incorrecto' }, 401);
  return json(await leer());
}

// Cada cambio llega como una operación y se aplica sobre la versión guardada,
// así dos dispositivos pueden registrar gastos sin borrarse lo del otro.
export async function POST(req) {
  if (!pinValido(req)) return json({ error: 'PIN incorrecto' }, 401);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  const d = await leer();

  if (body?.op === 'agregar') {
    const g = limpiarGasto(body.gasto);
    if (!g) return json({ error: 'Gasto inválido' }, 400);
    if (!d.categorias.some((c) => c.id === g.cat)) return json({ error: 'El item no existe' }, 400);
    d.gastos = d.gastos.filter((x) => x.id !== g.id);
    d.gastos.push(g);
  } else if (body?.op === 'eliminar') {
    d.gastos = d.gastos.filter((x) => x.id !== body.id);
  } else if (body?.op === 'items') {
    const cs = limpiarCats(body.categorias);
    if (!cs) return json({ error: 'Lista de items inválida' }, 400);
    const quedan = new Set(cs.map((c) => c.id));
    const enUso = d.gastos.find((g) => !quedan.has(g.cat));
    if (enUso) return json({ error: 'No se puede borrar un item que tiene gastos registrados' }, 400);
    d.categorias = cs;
  } else {
    return json({ error: 'Operación desconocida' }, 400);
  }

  await guardar(d);
  return json(d);
}
