import { get, put } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

// Todos los datos viven en un único archivo JSON privado en Vercel Blob.
const RUTA = 'gastos/datos.json';

// Porcentajes sugeridos del sueldo (se pueden cambiar en la app).
const CATS_INICIALES = [
  { id: 'vivienda', nombre: 'Vivienda (arriendo o dividendo)', porcentaje: 25 },
  { id: 'supermercado', nombre: 'Supermercado', porcentaje: 15 },
  { id: 'cuentas', nombre: 'Cuentas (luz, agua, internet)', porcentaje: 10 },
  { id: 'transporte', nombre: 'Transporte', porcentaje: 8 },
  { id: 'comida-fuera', nombre: 'Comida fuera', porcentaje: 5 },
  { id: 'salud', nombre: 'Salud', porcentaje: 5 },
  { id: 'entretencion', nombre: 'Entretención', porcentaje: 5 },
  { id: 'ropa', nombre: 'Ropa', porcentaje: 3 },
  { id: 'otros', nombre: 'Otros', porcentaje: 4 },
];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

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

function monto(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 1e10 ? n : null;
}

function limpiarMovimiento(g, conItem) {
  if (!g || typeof g !== 'object') return null;
  const m = monto(g.monto);
  if (!m || !ID.test(String(g.id)) || !FECHA.test(String(g.fecha))) return null;
  if (conItem && !ID.test(String(g.cat))) return null;
  const out = {
    id: String(g.id),
    fecha: String(g.fecha),
    monto: m,
    nota: typeof g.nota === 'string' ? g.nota.trim().slice(0, 120) : '',
    creado: Number.isFinite(Number(g.creado)) ? Number(g.creado) : Date.now(),
  };
  if (conItem) out.cat = String(g.cat);
  return out;
}

function limpiarCats(cs) {
  if (!Array.isArray(cs) || cs.length === 0 || cs.length > 40) return null;
  const out = [];
  const ids = new Set();
  for (const c of cs) {
    const nombre = typeof c?.nombre === 'string' ? c.nombre.trim().slice(0, 40) : '';
    const p = Math.min(100, Math.max(0, Number(c?.porcentaje) || 0));
    if (!ID.test(String(c?.id)) || !nombre || ids.has(c.id)) return null;
    ids.add(c.id);
    out.push({ id: String(c.id), nombre, porcentaje: Math.round(p * 10) / 10 });
  }
  return out;
}

function normalizar(d) {
  const cats = Array.isArray(d?.categorias) && d.categorias.length ? d.categorias : CATS_INICIALES;
  return {
    categorias: cats.map((c) => ({ id: c.id, nombre: c.nombre, porcentaje: Number(c.porcentaje) || 0 })),
    gastos: Array.isArray(d?.gastos) ? d.gastos : [],
    ingresos: Array.isArray(d?.ingresos) ? d.ingresos : [],
    sueldos: d?.sueldos && typeof d.sueldos === 'object' ? d.sueldos : {},
  };
}

async function leer() {
  const r = await get(RUTA, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return normalizar({});
  try {
    return normalizar(JSON.parse(await new Response(r.stream).text()));
  } catch {
    return normalizar({});
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

// Explica en palabras simples qué falla al usar el almacenamiento.
function errorAlmacen(e) {
  const tieneBlob = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
  const detalle = String(e?.message || e).slice(0, 200);
  console.error('Blob:', detalle);
  const error = tieneBlob
    ? `El almacenamiento respondió con un error: ${detalle}`
    : 'Este proyecto no tiene un almacenamiento Blob conectado. Conéctalo en Storage y vuelve a desplegar.';
  return json({ error }, 500);
}

export async function GET(req) {
  if (!pinValido(req)) return json({ error: 'PIN incorrecto' }, 401);
  try {
    return json(await leer());
  } catch (e) {
    return errorAlmacen(e);
  }
}

// Cada cambio llega como una operación y se aplica sobre la versión guardada,
// así dos dispositivos pueden registrar movimientos sin borrarse lo del otro.
export async function POST(req) {
  if (!pinValido(req)) return json({ error: 'PIN incorrecto' }, 401);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  let d;
  try {
    d = await leer();
  } catch (e) {
    return errorAlmacen(e);
  }

  switch (body?.op) {
    case 'agregar': {
      const g = limpiarMovimiento(body.gasto, true);
      if (!g) return json({ error: 'Gasto inválido' }, 400);
      if (!d.categorias.some((c) => c.id === g.cat)) return json({ error: 'El item no existe' }, 400);
      d.gastos = d.gastos.filter((x) => x.id !== g.id).concat(g);
      break;
    }
    case 'eliminar':
      d.gastos = d.gastos.filter((x) => x.id !== body.id);
      break;
    case 'agregarIngreso': {
      const i = limpiarMovimiento(body.ingreso, false);
      if (!i) return json({ error: 'Ingreso inválido' }, 400);
      d.ingresos = d.ingresos.filter((x) => x.id !== i.id).concat(i);
      break;
    }
    case 'eliminarIngreso':
      d.ingresos = d.ingresos.filter((x) => x.id !== body.id);
      break;
    case 'sueldo': {
      if (!MES.test(String(body.mes))) return json({ error: 'Mes inválido' }, 400);
      const m = monto(body.monto);
      if (m) d.sueldos[body.mes] = m;
      else delete d.sueldos[body.mes];
      break;
    }
    case 'items': {
      const cs = limpiarCats(body.categorias);
      if (!cs) return json({ error: 'Lista de items inválida' }, 400);
      const quedan = new Set(cs.map((c) => c.id));
      if (d.gastos.some((g) => !quedan.has(g.cat))) {
        return json({ error: 'No se puede borrar un item que tiene gastos registrados' }, 400);
      }
      d.categorias = cs;
      break;
    }
    default:
      return json({ error: 'Operación desconocida' }, 400);
  }

  try {
    await guardar(d);
  } catch (e) {
    return errorAlmacen(e);
  }
  return json(d);
}
