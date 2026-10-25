/**
 * Script de extracción y sincronización de datos desde http://gt.frm.utn.edu.ar/reservas/
 * Extrae:
 *  1. Todos los cuerpos, niveles, áreas, aulas y laboratorios informáticos (con capacidad y plano PDF).
 *  2. Todos los eventos/reservas de cursado del ciclo lectivo desde los endpoints de FullCalendar.
 * Genera `datos-reservas.js` para uso directo en el navegador (incluso vía file://) y desde `server.js`.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://gt.frm.utn.edu.ar';

const CUERPOS = [
  { id: '1', nombre: 'Cuerpo 1', descripcion: 'Edificio Central', url: '/reservas/cuerpo/1/' },
  { id: '3', nombre: 'Cuerpo 3', descripcion: 'Ingeniería Civil', url: '/reservas/cuerpo/3/' },
  { id: '5', nombre: 'Cuerpo 5', descripcion: 'Ingeniería Química / Básicas', url: '/reservas/cuerpo/5/' },
  { id: '6', nombre: 'Cuerpo 6', descripcion: 'Electrónica / SeTIC', url: '/reservas/cuerpo/6/' },
  { id: '9', nombre: 'Cuerpo 9', descripcion: 'Posgrado', url: '/reservas/cuerpo/9/' },
  { id: '20', nombre: 'Cuerpo 20', descripcion: 'Anexo Rivadavia', url: '/reservas/cuerpo/20/' }
];

const AREAS = [
  { slug: 'sistemas', nombre: 'Sistemas', url: '/reservas/area/sistemas/' },
  { slug: 'electromecanica', nombre: 'Electromecánica', url: '/reservas/area/electromecanica/' },
  { slug: 'civil', nombre: 'Civil', url: '/reservas/area/civil/' },
  { slug: 'quimica', nombre: 'Química', url: '/reservas/area/quimica/' },
  { slug: 'tecnologias_electronicas', nombre: 'Tecnologías Electrónicas', url: '/reservas/area/tecnologias_electronicas/' },
  { slug: 'basicas', nombre: 'Básicas', url: '/reservas/area/basicas/' },
  { slug: 'SeTIC', nombre: 'SeTIC', url: '/reservas/area/SeTIC/' },
  { slug: 'posgrado', nombre: 'Posgrado', url: '/reservas/area/posgrado/' },
  { slug: 'extension', nombre: 'Extensión Universitaria', url: '/reservas/area/extension/' },
  { slug: 'rivadavia', nombre: 'Rivadavia', url: '/reservas/area/rivadavia/' }
];

function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\x02/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return await res.json();
}

async function sincronizarDatos() {
  console.log('1/4 Consultando distribución física (Cuerpos 1 a 20)...');
  const recursos = {};

  for (const c of CUERPOS) {
    const html = await fetchText(BASE_URL + c.url);

    // Extraer recursos del bloque FullCalendar
    const resRegex = /\{\s*id:\s*'(\d+)',\s*nivel:\s*'([^']+)',\s*title:\s*'([^']+)',?\s*\}/g;
    let match;
    while ((match = resRegex.exec(html)) !== null) {
      const [, id, nivel, rawTitle] = match;
      const nombre = decodeHtml(rawTitle);
      const esLab = /\(LI[A-Za-z0-9]+\)/.test(nombre);
      recursos[id] = {
        id,
        nombre,
        cuerpoId: c.id,
        cuerpo: c.nombre,
        cuerpoDescripcion: c.descripcion,
        nivel: decodeHtml(nivel),
        area: esLab ? 'Laboratorio Informático' : '',
        capacidad: null,
        esLaboratorio: esLab,
        ubicacionPdf: null,
        detalleUrl: `${BASE_URL}/reservas/aula/${id}/`
      };
    }

    // Extraer filas de tablas (capacidad, área, PDF de ubicación, URL de detalle)
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let rm;
    while ((rm = rowRegex.exec(html)) !== null) {
      const row = rm[1];
      const aulaMatch = row.match(/href="(\/reservas\/aula\/(\d+)\/)"/);
      if (aulaMatch) {
        const [, href, id] = aulaMatch;
        if (recursos[id]) {
          recursos[id].detalleUrl = BASE_URL + href;
          const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m =>
            decodeHtml(m[1].replace(/<[^>]+>/g, ''))
          );
          if (tds.length >= 2) {
            const cap = parseInt(tds[1], 10);
            if (!isNaN(cap)) recursos[id].capacidad = cap;
          }
          if (tds.length >= 3 && tds[2] && !tds[2].includes('Detalles')) {
            recursos[id].area = tds[2];
          }
          const pdfMatch = row.match(/href="(\/reservas\/media\/[^"]+\.pdf)"/);
          if (pdfMatch) {
            recursos[id].ubicacionPdf = BASE_URL + pdfMatch[1];
          }
        }
      }
    }
  }

  console.log('2/4 Consultando laboratorios informáticos...');
  try {
    const labHtml = await fetchText(`${BASE_URL}/reservas/laboratorios/informatica/`);
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let rm;
    while ((rm = rowRegex.exec(labHtml)) !== null) {
      const row = rm[1];
      const labHrefMatch = row.match(/href="(\/reservas\/laboratorio\/informatica\/([^"\/]+)\/)"/);
      if (labHrefMatch) {
        const [, href, labCode] = labHrefMatch;
        const target = Object.values(recursos).find(r => r.nombre.includes(`(${labCode})`));
        if (target) {
          target.detalleUrl = BASE_URL + href;
          target.esLaboratorio = true;
          target.area = 'Laboratorio Informático';
          const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m =>
            decodeHtml(m[1].replace(/<[^>]+>/g, ''))
          );
          if (tds.length >= 2) {
            const cap = parseInt(tds[1], 10);
            if (!isNaN(cap)) target.capacidad = cap;
          }
          const pdfMatch = row.match(/href="(\/reservas\/media\/[^"]+\.pdf)"/);
          if (pdfMatch) {
            target.ubicacionPdf = BASE_URL + pdfMatch[1];
          }
        }
      }
    }
  } catch (err) {
    console.warn('Aviso al consultar laboratorios:', err.message);
  }

  console.log('3/4 Consultando áreas académicas para completar metadatos...');
  for (const area of AREAS) {
    try {
      const html = await fetchText(BASE_URL + area.url);
      const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
      let rm;
      while ((rm = rowRegex.exec(html)) !== null) {
        const row = rm[1];
        const aulaMatch = row.match(/href="\/reservas\/aula\/(\d+)\/"/);
        if (aulaMatch) {
          const id = aulaMatch[1];
          if (recursos[id]) {
            if (!recursos[id].area) recursos[id].area = area.nombre;
            const pdfMatch = row.match(/href="(\/reservas\/media\/[^"]+\.pdf)"/);
            if (pdfMatch && !recursos[id].ubicacionPdf) {
              recursos[id].ubicacionPdf = BASE_URL + pdfMatch[1];
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Aviso en área ${area.nombre}:`, err.message);
    }
  }

  const ids = Object.keys(recursos).sort((a, b) => Number(a) - Number(b));
  console.log(`4/4 Descargando reservas 2026 de ${ids.length} recursos...`);

  const grupos = new Map();
  let totalEventos = 0;

  for (let i = 0; i < ids.length; i += 8) {
    const lote = ids.slice(i, i + 8);
    const promesas = lote.map(async id => {
      try {
        const url = `${BASE_URL}/reservas/recurso/${id}/eventos/?start=2026-01-01&end=2026-12-31`;
        const eventos = await fetchJson(url);
        return { id, eventos };
      } catch (e) {
        return { id, eventos: [] };
      }
    });
    const resultados = await Promise.all(promesas);
    for (const { id, eventos } of resultados) {
      for (const ev of eventos) {
        if (!ev.start || !ev.end || !ev.title) continue;
        totalEventos++;
        const fecha = ev.start.slice(0, 10);
        const inicio = ev.start.slice(11, 16);
        const fin = ev.end.slice(11, 16);
        const titulo = decodeHtml(ev.title);
        const clave = `${id}|${inicio}|${fin}|${titulo}`;
        if (!grupos.has(clave)) {
          grupos.set(clave, {
            r: id,
            s: inicio,
            e: fin,
            t: titulo,
            d: []
          });
        }
        grupos.get(clave).d.push(fecha);
      }
    }
  }

  // Ordenar fechas dentro de cada grupo y eliminar duplicados
  const patrones = [...grupos.values()].map(g => ({
    ...g,
    d: [...new Set(g.d)].sort()
  }));

  const payload = {
    fuente: 'http://gt.frm.utn.edu.ar/reservas/',
    actualizadoEn: new Date().toISOString(),
    totalRecursos: ids.length,
    totalEventos,
    totalPatrones: patrones.length,
    cuerpos: CUERPOS,
    recursos,
    patrones
  };

  const jsContent = `// Datos extraídos automáticamente desde http://gt.frm.utn.edu.ar/reservas/\nwindow.DATOS_RESERVAS_UTN = ${JSON.stringify(payload)};\n`;
  const outPath = path.join(__dirname, 'datos-reservas.js');
  fs.writeFileSync(outPath, jsContent, 'utf8');

  console.log(`Listo: ${ids.length} recursos, ${totalEventos} eventos (${patrones.length} bloques horarios) guardados en datos-reservas.js`);
  return payload;
}

if (require.main === module) {
  sincronizarDatos().catch(err => {
    console.error('Error al sincronizar:', err);
    process.exit(1);
  });
}

module.exports = { sincronizarDatos };
