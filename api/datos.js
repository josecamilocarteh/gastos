import { get, put } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

// Versión simple: un catálogo de gastos (botones) y, por cada mes, el dinero disponible y los gastos marcados.
// Usa un archivo nuevo para no tocar los datos de la versión anterior.
const RUTA = 'gastos/simple.json';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MES = /^\d{4}-\d{2}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;

const FIJOS_INICIALES = [
  { id: 'bip', nombre: 'Tarjeta Bip', monto: 6000, color: '#1C70CF' },
  { id: 'almuerzo', nombre: 'Almuerzo', monto: 7000, color: '#0FBA82' },
  { id: 'cafe', nombre: 'Café', monto: 2500, color: '#801C1C' },
  { id: 'super', nombre: 'Supermercado', monto: 30000, color: '#7D3BED' },
];

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

const monto = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 1e10 ? n : null;
};
const nombre = (v) => (typeof v === 'string' ? v.trim().slice(0, 40) : '');

function normalizar(d) {
  return {
    fijos: Array.isArray(d?.fijos) ? d.fijos : FIJOS_INICIALES,
    meses: d?.meses && typeof d.meses === 'object' ? d.meses : {},
  };
}
function mesDe(d, m) {
  if (!d.meses[m]) d.meses[m] = { ingresos: [], gastos: [] };
  return d.meses[m];
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
// así el celular y el computador pueden registrar sin borrarse lo del otro.
export async function POST(req) {
  if (!pinValido(req)) return json({ error: 'PIN incorrecto' }, 401);
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  let d;
  try {
    d = await leer();
  } catch (e) {
    return errorAlmacen(e);
  }
  const malo = (msg) => json({ error: msg }, 400);
  const mesOk = MES.test(String(b?.mes));

  switch (b?.op) {
    case 'ingreso': {
      const i = b.ingreso || {};
      if (!mesOk || !ID.test(String(i.id)) || !nombre(i.nombre) || !monto(i.monto)) return malo('Ingreso inválido');
      const M = mesDe(d, b.mes);
      M.ingresos = M.ingresos.filter((x) => x.id !== i.id).concat({ id: i.id, nombre: nombre(i.nombre), monto: monto(i.monto) });
      break;
    }
    case 'eliminarIngreso':
      if (!mesOk) return malo('Mes inválido');
      mesDe(d, b.mes).ingresos = mesDe(d, b.mes).ingresos.filter((x) => x.id !== b.id);
      break;
    case 'gasto': {
      const g = b.gasto || {};
      if (!mesOk || !ID.test(String(g.id)) || !nombre(g.nombre) || !monto(g.monto) || !FECHA.test(String(g.fecha))) return malo('Gasto inválido');
      const M = mesDe(d, b.mes);
      M.gastos = M.gastos.filter((x) => x.id !== g.id).concat({
        id: g.id,
        fijoId: ID.test(String(g.fijoId)) ? g.fijoId : null,
        nombre: nombre(g.nombre),
        monto: monto(g.monto),
        color: COLOR.test(String(g.color)) ? g.color : '',
        fecha: g.fecha,
        creado: Number(g.creado) || Date.now(),
      });
      break;
    }
    case 'eliminarGasto':
      if (!mesOk) return malo('Mes inválido');
      mesDe(d, b.mes).gastos = mesDe(d, b.mes).gastos.filter((x) => x.id !== b.id);
      break;
    case 'fijo': {
      const f = b.fijo || {};
      if (!ID.test(String(f.id)) || !nombre(f.nombre) || !monto(f.monto)) return malo('Gasto fijo inválido');
      const nuevo = { id: f.id, nombre: nombre(f.nombre), monto: monto(f.monto), color: COLOR.test(String(f.color)) ? f.color : '#1C70CF' };
      const i = d.fijos.findIndex((x) => x.id === f.id);
      if (i >= 0) d.fijos[i] = nuevo;
      else if (d.fijos.length < 60) d.fijos.push(nuevo);
      else return malo('Llegaste al máximo de 60 gastos');
      break;
    }
    case 'eliminarFijo':
      d.fijos = d.fijos.filter((x) => x.id !== b.id);
      break;
    case 'ordenFijos': {
      if (!Array.isArray(b.ids)) return malo('Orden inválido');
      const pos = new Map(b.ids.map((id, i) => [id, i]));
      d.fijos.sort((x, y) => (pos.get(x.id) ?? 999) - (pos.get(y.id) ?? 999));
      break;
    }
    default:
      return malo('Operación desconocida');
  }

  try {
    await guardar(d);
  } catch (e) {
    return errorAlmacen(e);
  }
  return json(d);
}
