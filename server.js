/**
 * Servidor local para "¿Dónde Curso? - UTN FRM"
 * Sirve la aplicación web estática y ofrece endpoints de sincronización y consulta en vivo
 * contra http://gt.frm.utn.edu.ar/reservas/ evitando bloqueos CORS del navegador.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { sincronizarDatos } = require('./actualizar-datos');

const PORT = process.env.PORT || 3000;
const BASE_URL = 'http://gt.frm.utn.edu.ar';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

// Caché en memoria para consultas por rango de fechas en vivo
const liveCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function consultarEventosEnVivo(start, end, resourceIds) {
  const cacheKey = `${start}|${end}`;
  const cached = liveCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const resultados = [];
  for (let i = 0; i < resourceIds.length; i += 10) {
    const lote = resourceIds.slice(i, i + 10);
    const promesas = lote.map(async id => {
      try {
        const res = await fetch(`${BASE_URL}/reservas/recurso/${id}/eventos/?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.map(ev => ({
          resourceId: String(ev.resourceId || id),
          start: ev.start,
          end: ev.end,
          title: (ev.title || '').replace(/\x02/g, ' / ').replace(/\s+/g, ' ').trim()
        }));
      } catch {
        return [];
      }
    });
    const r = await Promise.all(promesas);
    resultados.push(...r.flat());
  }

  liveCache.set(cacheKey, { ts: Date.now(), data: resultados });
  return resultados;
}

function obtenerIdsRecursosLocales() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'datos-reservas.js'), 'utf8');
    const jsonStr = raw.replace(/^[\s\S]*?window\.DATOS_RESERVAS_UTN\s*=\s*/, '').replace(/;\s*$/, '');
    const parsed = JSON.parse(jsonStr);
    return Object.keys(parsed.recursos || {});
  } catch {
    return [1,2,3,4,5,6,8,82,33,13,14,16,25,30,32,34,35,17,19,20,21,22,23,24,36,9,26,27,28,37,38,39,43,187,40,41,42,44,78,79,47,49,50,51,80,52,53,54,55,56,57,81,83,58,59,60,61,62,63,64,45,46].map(String);
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/eventos' && req.method === 'GET') {
    const start = parsedUrl.searchParams.get('start');
    const end = parsedUrl.searchParams.get('end');
    if (!start || !end) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Parámetros start y end requeridos (YYYY-MM-DD)' }));
      return;
    }
    try {
      const ids = obtenerIdsRecursosLocales();
      const eventos = await consultarEventosEnVivo(start, end, ids);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, start, end, total: eventos.length, eventos }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/sincronizar' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      liveCache.clear();
      const payload = await sincronizarDatos();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        actualizadoEn: payload.actualizadoEn,
        totalRecursos: payload.totalRecursos,
        totalEventos: payload.totalEventos
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // Archivos estáticos
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const absPath = path.join(__dirname, filePath);

  if (!absPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  fs.readFile(absPath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Archivo no encontrado' : 'Error interno del servidor');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor "¿Dónde Curso? - UTN FRM" activo en http://localhost:${PORT}`);
});
