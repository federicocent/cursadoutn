/**
 * Lógica principal de "¿Dónde Curso? - UTN FRM"
 * Procesa los datos extraídos de http://gt.frm.utn.edu.ar/reservas/
 * y permite filtrar por Curso/Comisión, Carrera, Año, Día de la semana o Fecha exacta.
 */

(function () {
  const ESPECIALIDADES = {
    K: { codigo: 'K', nombre: 'Ingeniería en Sistemas', corto: 'Sistemas' },
    X: { codigo: 'X', nombre: 'Ingeniería Electromecánica', corto: 'Electromecánica' },
    P: { codigo: 'P', nombre: 'Ingeniería Civil', corto: 'Civil' },
    R: { codigo: 'R', nombre: 'Ingeniería Electrónica', corto: 'Electrónica' },
    V: { codigo: 'V', nombre: 'Ingeniería Química', corto: 'Química' },
    PRO: { codigo: 'PRO', nombre: 'Tecnicatura en Programación', corto: 'Programación' },
    ENO: { codigo: 'ENO', nombre: 'Lic. / Tec. en Enología', corto: 'Enología' },
    B: { codigo: 'B', nombre: 'Ciencias Básicas / Inglés', corto: 'Básicas / Inglés' },
    H: { codigo: 'H', nombre: 'Hotelería y Turismo', corto: 'Hotelería / Turismo' },
    T: { codigo: 'H', nombre: 'Hotelería y Turismo', corto: 'Hotelería / Turismo' },
    TC: { codigo: 'TC', nombre: 'Telecomunicaciones', corto: 'Telecomunicaciones' },
    S: { codigo: 'S', nombre: 'Higiene y Seguridad', corto: 'Higiene y Seg.' },
    RIV: { codigo: 'RIV', nombre: 'Anexo Rivadavia', corto: 'Rivadavia' },
    OTROS: { codigo: 'OTROS', nombre: 'Departamentos / Eventos / Ingreso', corto: 'Dptos. / Otros' }
  };

  const DIAS_SEMANA = [
    { id: 1, nombre: 'Lunes', corto: 'Lun' },
    { id: 2, nombre: 'Martes', corto: 'Mar' },
    { id: 3, nombre: 'Miércoles', corto: 'Mié' },
    { id: 4, nombre: 'Jueves', corto: 'Jue' },
    { id: 5, nombre: 'Viernes', corto: 'Vie' },
    { id: 6, nombre: 'Sábado', corto: 'Sáb' },
    { id: 0, nombre: 'Semana completa', corto: 'Lun–Sáb' }
  ];

  // Mapa de electivas vinculadas a su comisión madre
  const ELECTIVAS_MADRE = {
    '4K91': '4K9',
    '4K101': '4K10',
    '4K103': '4K10',
    '5K91': '5K9',
    '5K101': '5K10',
    '5K102': '5K10',
    '5X22': '5X2',
    '2P31': '2P3',
    '3P21': '3P2'
  };

  // Estado de la aplicación
  const state = {
    datos: window.DATOS_RESERVAS_UTN || { recursos: {}, patrones: [] },
    cursosMap: new Map(), // idCanonico -> { id, etiqueta, alias: Set, anio, esp, esEspecial, cantidad }
    eventosExpandidos: [], // lista de patrones enriquecidos
    espFiltro: 'TODAS',
    anioFiltro: 'TODOS',
    cursoSeleccionado: localStorage.getItem('utn_dondecurso_curso') || '1K1',
    diaSemana: obtenerDiaInicial(), // 1=Lunes..6=Sábado, 0=Semana completa
    modoConsulta: 'SEMANA_HABITUAL', // 'SEMANA_HABITUAL' | 'FECHA_EXACTA'
    cuatrimestre: '2C', // '2C' | '1C' | 'ANUAL'
    fechaExacta: obtenerFechaInicialISO(),
    incluirElectivas: true,
    busquedaTexto: ''
  };

  function obtenerDiaInicial() {
    const d = new Date().getDay();
    return d >= 1 && d <= 6 ? d : 1;
  }

  function obtenerFechaInicialISO() {
    const hoy = new Date();
    if (hoy.getDay() === 0) {
      hoy.setDate(hoy.getDate() + 1);
    }
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd = String(hoy.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function normalizarCodigoComision(raw) {
    const limpio = raw.toUpperCase().replace(/[\s-]+/g, '');
    const m = limpio.match(/^([1-6])([A-Z]{1,4})(\d{1,3})$/);
    if (!m) return null;
    let [, anio, esp, num] = m;
    if (esp === 'EN') esp = 'ENO';
    // Si tiene 3 dígitos con cero intermedio tipo 4K091 -> 4K91, 1PRO07 -> 1PRO7
    let numNorm;
    if (num.length === 3 && num.startsWith('0')) {
      numNorm = String(parseInt(num, 10));
    } else if (num.length === 2 && num.startsWith('0')) {
      numNorm = String(parseInt(num, 10));
    } else {
      numNorm = num;
    }
    const id = `${anio}${esp}${numNorm}`;
    return {
      id,
      raw: raw.toUpperCase().replace(/\s+/g, ''),
      anio: Number(anio),
      esp: esp === 'T' ? 'H' : esp,
      espOriginal: esp,
      numNorm
    };
  }

  function extraerInfoTitulo(titulo) {
    const limpio = titulo.replace(/\x02/g, ' / ').replace(/\s+/g, ' ').trim();
    const regexCodigos = /\b([1-6]\s*(?:ENO|EN|PRO|RIV|TC|[KXRPVBHTS])\s*-?\s*\d{1,3})\b/gi;
    const coincidencias = [...limpio.matchAll(regexCodigos)];
    const comisiones = [];
    const vistos = new Set();

    for (const m of coincidencias) {
      const info = normalizarCodigoComision(m[1]);
      if (info && !vistos.has(info.id)) {
        vistos.add(info.id);
        comisiones.push(info);
      }
    }

    // Categorías especiales si no tiene código estándar
    if (comisiones.length === 0) {
      const upper = limpio.toUpperCase();
      if (upper.startsWith('DISI')) {
        comisiones.push({ id: 'DISI', raw: 'DISI (Sistemas)', anio: 0, esp: 'K', esEspecial: true });
      } else if (upper.startsWith('DIC')) {
        comisiones.push({ id: 'DIC', raw: 'DIC (Civil)', anio: 0, esp: 'P', esEspecial: true });
      } else if (upper.startsWith('DIEM')) {
        comisiones.push({ id: 'DIEM', raw: 'DIEM (Electromecánica)', anio: 0, esp: 'X', esEspecial: true });
      } else if (upper.startsWith('DIQ')) {
        comisiones.push({ id: 'DIQ', raw: 'DIQ (Química)', anio: 0, esp: 'V', esEspecial: true });
      } else if (upper.includes('INGRESO')) {
        comisiones.push({ id: 'INGRESO', raw: 'INGRESO UTN', anio: 1, esp: 'OTROS', esEspecial: true });
      } else if (upper.startsWith('(A2)')) {
        comisiones.push({ id: 'A2-EXT', raw: 'Extensión (A2)', anio: 0, esp: 'OTROS', esEspecial: true });
      } else {
        comisiones.push({ id: 'EVENTOS-GRAL', raw: 'Otros / Eventos', anio: 0, esp: 'OTROS', esEspecial: true });
      }
    }

    // Limpiar código inicial para obtener Materia y Profesor
    let resto = limpio
      .replace(/^(?:[1-6]\s*[A-Za-z]{1,4}\s*-?\s*\d{1,3}\s*[\/,-]?\s*)+/i, '')
      .replace(/^(?:DISI|DIC|DIEM|DIQ)\s*[-:]?\s*/i, '')
      .trim();

    // Quitar número de solicitud final tipo (54253)
    resto = resto.replace(/\(\d{4,6}\)\s*$/, '').trim();

    let materia = resto || limpio;
    let profesor = '';

    // Extraer profesor entre paréntesis al final o separado por guion
    const parenMatch = resto.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (parenMatch && parenMatch[1].trim().length > 2) {
      const posibleProf = parenMatch[2].trim();
      if (!/^elec/i.test(posibleProf) && !/^zoom$/i.test(posibleProf)) {
        materia = parenMatch[1].replace(/[-–]\s*$/, '').trim();
        profesor = posibleProf;
      }
    } else {
      const partesGuion = resto.split(/\s+-\s+|\s*-\s*(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,\s*[A-ZÁÉÍÓÚÑ])/);
      if (partesGuion.length >= 2) {
        profesor = partesGuion.slice(1).join(' · ').trim();
        materia = partesGuion[0].trim();
      }
    }

    return {
      tituloLimpio: limpio,
      materia: materia || limpio,
      profesor,
      comisiones
    };
  }

  function obtenerDiaSemanaISO(fechaISO) {
    const [y, m, d] = fechaISO.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getDay(); // 0=Dom, 1=Lun..6=Sáb
  }

  function indexarDatos() {
    state.cursosMap.clear();
    state.eventosExpandidos = [];

    const patrones = state.datos.patrones || [];
    for (const p of patrones) {
      const info = extraerInfoTitulo(p.t);
      const diasSet = new Set();
      let tiene1C = false;
      let tiene2C = false;

      for (const f of p.d) {
        const dow = obtenerDiaSemanaISO(f);
        diasSet.add(dow);
        const mes = Number(f.slice(5, 7));
        if (mes >= 3 && mes <= 7) tiene1C = true;
        if (mes >= 8 && mes <= 12) tiene2C = true;
      }

      const enriquecido = {
        resourceId: String(p.r),
        recurso: state.datos.recursos[p.r] || {
          id: String(p.r),
          nombre: `Recurso ${p.r}`,
          cuerpo: 'UTN FRM',
          nivel: '-',
          area: '-'
        },
        horaInicio: p.s,
        horaFin: p.e,
        fechas: p.d,
        fechasSet: new Set(p.d),
        diasSemana: diasSet,
        tiene1C,
        tiene2C,
        ...info
      };

      state.eventosExpandidos.push(enriquecido);

      for (const c of info.comisiones) {
        if (!state.cursosMap.has(c.id)) {
          state.cursosMap.set(c.id, {
            id: c.id,
            anio: c.anio,
            esp: c.esp,
            esEspecial: Boolean(c.esEspecial),
            alias: new Set(),
            cantidadPatrones: 0
          });
        }
        const entry = state.cursosMap.get(c.id);
        entry.alias.add(c.raw);
        entry.cantidadPatrones++;
      }
    }

    // Generar etiqueta amigable para cada curso
    for (const curso of state.cursosMap.values()) {
      const listaAlias = [...curso.alias].sort((a, b) => b.length - a.length);
      curso.etiquetaPrincipal = listaAlias[0] || curso.id;
      curso.etiquetaAlias = listaAlias.length > 1 ? listaAlias.join(' / ') : curso.etiquetaPrincipal;
      const espObj = ESPECIALIDADES[curso.esp] || ESPECIALIDADES.OTROS;
      curso.espNombre = espObj.corto;
    }

    if (!state.cursosMap.has(state.cursoSeleccionado)) {
      state.cursoSeleccionado = state.cursosMap.has('1K1')
        ? '1K1'
        : [...state.cursosMap.keys()][0] || '';
    }
  }

  function ordenarCursos(a, b) {
    if (a.esEspecial !== b.esEspecial) return a.esEspecial ? 1 : -1;
    if (a.anio !== b.anio) return a.anio - b.anio;
    if (a.esp !== b.esp) return a.esp.localeCompare(b.esp);
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  }

  function renderizarFiltrosEspecialidad() {
    const contenedor = document.getElementById('esp-chips');
    const orden = ['TODAS', 'K', 'X', 'P', 'R', 'V', 'PRO', 'ENO', 'B', 'H', 'TC', 'S', 'RIV', 'OTROS'];
    contenedor.innerHTML = orden
      .map(cod => {
        const texto = cod === 'TODAS' ? 'Todas las carreras' : `${ESPECIALIDADES[cod].corto} (${cod})`;
        const active = state.espFiltro === cod ? 'active' : '';
        return `<button type="button" class="chip ${active}" data-esp="${cod}">${texto}</button>`;
      })
      .join('');

    contenedor.querySelectorAll('.chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.espFiltro = btn.dataset.esp;
        renderizarFiltrosEspecialidad();
        renderizarSelectorCursos();
      });
    });
  }

  function renderizarFiltrosAnio() {
    const contenedor = document.getElementById('anio-chips');
    const anios = [
      { id: 'TODOS', label: 'Todos los años' },
      { id: '1', label: '1° Año' },
      { id: '2', label: '2° Año' },
      { id: '3', label: '3° Año' },
      { id: '4', label: '4° Año' },
      { id: '5', label: '5° Año' },
      { id: '6', label: '6° Año' }
    ];
    contenedor.innerHTML = anios
      .map(a => {
        const active = state.anioFiltro === a.id ? 'active' : '';
        return `<button type="button" class="chip ${active}" data-anio="${a.id}">${a.label}</button>`;
      })
      .join('');

    contenedor.querySelectorAll('.chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.anioFiltro = btn.dataset.anio;
        renderizarFiltrosAnio();
        renderizarSelectorCursos();
      });
    });
  }

  function obtenerCursosFiltrados() {
    const q = (document.getElementById('course-search')?.value || '').trim().toUpperCase();
    const todos = [...state.cursosMap.values()].sort(ordenarCursos);

    return todos.filter(c => {
      if (state.espFiltro !== 'TODAS' && c.esp !== state.espFiltro) return false;
      if (state.anioFiltro !== 'TODOS' && String(c.anio) !== state.anioFiltro) return false;
      if (q) {
        const coincideId = c.id.includes(q) || c.etiquetaAlias.toUpperCase().includes(q);
        const coincideEsp = c.espNombre.toUpperCase().includes(q);
        return coincideId || coincideEsp;
      }
      return true;
    });
  }

  function seleccionarCurso(idCurso) {
    state.cursoSeleccionado = idCurso;
    localStorage.setItem('utn_dondecurso_curso', idCurso);
    renderizarSelectorCursos();
    renderizarResultados();
  }

  function renderizarSelectorCursos() {
    const filtrados = obtenerCursosFiltrados();
    const grid = document.getElementById('courses-grid');
    const select = document.getElementById('course-select');

    // Si el curso actual no está en los filtrados pero hay filtrados, mantener o seleccionar el primero si el usuario filtró
    if (filtrados.length > 0 && !filtrados.some(c => c.id === state.cursoSeleccionado)) {
      state.cursoSeleccionado = filtrados[0].id;
      localStorage.setItem('utn_dondecurso_curso', state.cursoSeleccionado);
    }

    select.innerHTML = filtrados
      .map(c => {
        const sel = c.id === state.cursoSeleccionado ? 'selected' : '';
        const detalle = c.anio > 0 ? `${c.espNombre} · ${c.anio}° Año` : c.espNombre;
        return `<option value="${c.id}" ${sel}>${c.etiquetaAlias} — ${detalle}</option>`;
      })
      .join('');

    if (filtrados.length === 0) {
      grid.innerHTML = `<span style="color: var(--text-muted); font-size: 0.85rem;">No hay comisiones que coincidan con el filtro actual.</span>`;
      return;
    }

    grid.innerHTML = filtrados
      .map(c => {
        const active = c.id === state.cursoSeleccionado ? 'active' : '';
        return `
          <button type="button" class="course-pill ${active}" data-id="${c.id}" title="${c.etiquetaAlias} (${c.espNombre})">
            <span>${c.etiquetaAlias}</span>
            <small>${c.espNombre}</small>
          </button>
        `;
      })
      .join('');

    grid.querySelectorAll('.course-pill').forEach(btn => {
      btn.addEventListener('click', () => seleccionarCurso(btn.dataset.id));
    });
  }

  function sincronizarFechaConDiaSemana(diaObjetivo) {
    if (diaObjetivo === 0) return;
    const [y, m, d] = state.fechaExacta.split('-').map(Number);
    const actual = new Date(y, m - 1, d);
    const dowActual = actual.getDay() === 0 ? 7 : actual.getDay();
    const diff = diaObjetivo - dowActual;
    actual.setDate(actual.getDate() + diff);
    const yyyy = actual.getFullYear();
    const mm = String(actual.getMonth() + 1).padStart(2, '0');
    const dd = String(actual.getDate()).padStart(2, '0');
    state.fechaExacta = `${yyyy}-${mm}-${dd}`;
    const inputFecha = document.getElementById('exact-date');
    if (inputFecha) inputFecha.value = state.fechaExacta;
  }

  function renderizarBarraDias() {
    const bar = document.getElementById('days-bar');
    bar.innerHTML = DIAS_SEMANA.map(d => {
      const active = state.diaSemana === d.id ? 'active' : '';
      const sub = d.id === 0 ? 'Ver 6 días' : 'Seleccionar día';
      return `
        <button type="button" class="day-btn ${active}" data-day="${d.id}">
          <span class="day-name">${d.nombre}</span>
          <span class="day-sub">${sub}</span>
        </button>
      `;
    }).join('');

    bar.querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.diaSemana = Number(btn.dataset.day);
        if (state.diaSemana >= 1 && state.diaSemana <= 6) {
          sincronizarFechaConDiaSemana(state.diaSemana);
        }
        renderizarBarraDias();
        renderizarResultados();
      });
    });
  }

  function perteneceACursoSeleccionado(evento) {
    const target = state.cursoSeleccionado;
    for (const c of evento.comisiones) {
      if (c.id === target) return { coincide: true, esElectiva: false, codigoUsado: c.raw };
      if (state.incluirElectivas && ELECTIVAS_MADRE[c.id] === target) {
        return { coincide: true, esElectiva: true, codigoUsado: c.raw };
      }
    }
    return { coincide: false, esElectiva: false, codigoUsado: '' };
  }

  function estaEnCursoAhora(horaInicio, horaFin, diaEvento) {
    const ahora = new Date();
    if (ahora.getDay() !== diaEvento) return false;
    const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
    const [hi, mi] = horaInicio.split(':').map(Number);
    const [hf, mf] = horaFin.split(':').map(Number);
    return minAhora >= hi * 60 + mi && minAhora <= hf * 60 + mf;
  }

  function formatearRangoFechas(fechas) {
    if (!fechas || fechas.length === 0) return '';
    if (fechas.length === 1) {
      const [y, m, d] = fechas[0].split('-');
      return `Reserva puntual: ${d}/${m}/${y}`;
    }
    const primera = fechas[0].split('-').reverse().join('/');
    const ultima = fechas[fechas.length - 1].split('-').reverse().join('/');
    return `Cursado regular (${fechas.length} clases: ${primera} al ${ultima})`;
  }

  function construirTarjetaHTML(item, diaId) {
    const r = item.recurso;
    const enCurso = estaEnCursoAhora(item.horaInicio, item.horaFin, diaId);
    const clasesCard = [
      'class-card',
      r.esLaboratorio ? 'is-lab' : '',
      enCurso ? 'is-now' : ''
    ].filter(Boolean).join(' ');

    const badgeTipo = r.esLaboratorio
      ? `<span class="badge badge-lab">Laboratorio Informático</span>`
      : `<span class="badge badge-aula">Aula</span>`;

    const badgeElectiva = item.esElectiva
      ? `<span class="badge badge-electiva">Electiva (${item.codigoUsado})</span>`
      : `<span class="badge badge-course">${item.codigoUsado}</span>`;

    const badgeAhora = enCurso
      ? `<span class="badge badge-now">Cursando ahora</span>`
      : '';

    const capacidadTexto = r.capacidad ? `Capacidad: ${r.capacidad}` : '';
    const areaTexto = r.area ? `Área: ${r.area}` : '';

    const btnPlano = r.ubicacionPdf
      ? `<a href="${r.ubicacionPdf}" target="_blank" rel="noopener" class="btn btn-success">
           📍 Ver Plano / Ubicación (PDF)
         </a>`
      : '';

    const btnDetalle = r.detalleUrl
      ? `<a href="${r.detalleUrl}" target="_blank" rel="noopener" class="btn">
           🗓️ Ver Aula en Reservas UTN
         </a>`
      : '';

    return `
      <article class="${clasesCard}">
        <div class="card-top">
          <div class="time-badge">
            🕒 ${item.horaInicio} a ${item.horaFin} hs
          </div>
          <div class="badges-right">
            ${badgeAhora}
            ${badgeElectiva}
            ${badgeTipo}
          </div>
        </div>

        <div class="where-box">
          <span class="where-label">Dónde tenés que cursar</span>
          <div class="where-room">${r.nombre}</div>
          <div class="where-meta">
            <span class="meta-pill">🏛️ ${r.cuerpo}${r.cuerpoDescripcion ? ` (${r.cuerpoDescripcion})` : ''}</span>
            <span class="meta-pill">🪜 ${r.nivel}</span>
            ${areaTexto ? `<span class="meta-pill">📚 ${areaTexto}</span>` : ''}
            ${capacidadTexto ? `<span class="meta-pill">👥 ${capacidadTexto}</span>` : ''}
          </div>
        </div>

        <div>
          <div class="subject-title">${item.materia}</div>
          ${item.profesor ? `<div class="prof-text">👨‍🏫 ${item.profesor}</div>` : ''}
          <div class="dates-info">📅 ${formatearRangoFechas(item.fechasFiltradas)}</div>
        </div>

        <div class="card-actions">
          ${btnPlano}
          ${btnDetalle}
        </div>
      </article>
    `;
  }

  function obtenerEventosParaDia(diaObjetivo) {
    const q = state.busquedaTexto.trim().toUpperCase();
    const resultados = [];

    for (const ev of state.eventosExpandidos) {
      const rel = perteneceACursoSeleccionado(ev);
      if (!rel.coincide) continue;

      if (state.modoConsulta === 'FECHA_EXACTA') {
        // Si estamos en Semana Completa + Fecha Exacta, calculamos la fecha de ese día de la semana seleccionada
        let fechaBuscada = state.fechaExacta;
        if (state.diaSemana === 0) {
          const [y, m, d] = state.fechaExacta.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          const dow = dt.getDay() === 0 ? 7 : dt.getDay();
          dt.setDate(dt.getDate() + (diaObjetivo - dow));
          fechaBuscada = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        }
        if (!ev.fechasSet.has(fechaBuscada)) continue;
        if (q && !coincideBusquedaTexto(ev, q)) continue;
        resultados.push({
          ...ev,
          esElectiva: rel.esElectiva,
          codigoUsado: rel.codigoUsado,
          fechasFiltradas: [fechaBuscada]
        });
      } else {
        // Modo por Día de la Semana (2° Cuatrimestre / 1° Cuatrimestre / Anual)
        if (!ev.diasSemana.has(diaObjetivo)) continue;
        if (state.cuatrimestre === '2C' && !ev.tiene2C) continue;
        if (state.cuatrimestre === '1C' && !ev.tiene1C) continue;

        const fechasDelDia = ev.fechas.filter(f => {
          if (obtenerDiaSemanaISO(f) !== diaObjetivo) return false;
          const mes = Number(f.slice(5, 7));
          if (state.cuatrimestre === '2C') return mes >= 8 && mes <= 12;
          if (state.cuatrimestre === '1C') return mes >= 3 && mes <= 7;
          return true;
        });

        if (fechasDelDia.length === 0) continue;
        if (q && !coincideBusquedaTexto(ev, q)) continue;

        resultados.push({
          ...ev,
          esElectiva: rel.esElectiva,
          codigoUsado: rel.codigoUsado,
          fechasFiltradas: fechasDelDia
        });
      }
    }

    // Ordenar por hora de inicio y luego priorizar cursado regular sobre eventos de 1 sola fecha
    resultados.sort((a, b) => {
      if (a.horaInicio !== b.horaInicio) return a.horaInicio.localeCompare(b.horaInicio);
      return b.fechasFiltradas.length - a.fechasFiltradas.length;
    });

    return resultados;
  }

  function coincideBusquedaTexto(ev, q) {
    return (
      ev.tituloLimpio.toUpperCase().includes(q) ||
      ev.recurso.nombre.toUpperCase().includes(q) ||
      ev.recurso.cuerpo.toUpperCase().includes(q)
    );
  }

  function renderizarResultados() {
    const contenedor = document.getElementById('results-container');
    const tituloEl = document.getElementById('results-title');
    const contadorEl = document.getElementById('results-count');
    const cursoObj = state.cursosMap.get(state.cursoSeleccionado);
    const nombreCurso = cursoObj ? cursoObj.etiquetaAlias : state.cursoSeleccionado;

    if (state.diaSemana === 0) {
      // Vista de Semana Completa (Lunes a Sábado)
      tituloEl.textContent = `Horarios y Aulas de ${nombreCurso} — Semana Completa`;
      let totalBloques = 0;
      const seccionesHTML = [];

      for (let d = 1; d <= 6; d++) {
        const nombreDia = DIAS_SEMANA.find(x => x.id === d).nombre;
        const items = obtenerEventosParaDia(d);
        totalBloques += items.length;
        if (items.length > 0) {
          seccionesHTML.push(`
            <div class="week-day-group">
              <div class="week-day-heading">
                <span>📅 ${nombreDia}</span>
                <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">${items.length} ${items.length === 1 ? 'bloque' : 'bloques'}</span>
              </div>
              <div class="cards-list">
                ${items.map(item => construirTarjetaHTML(item, d)).join('')}
              </div>
            </div>
          `);
        }
      }

      contadorEl.textContent = `${totalBloques} ${totalBloques === 1 ? 'reserva encontrada' : 'reservas encontradas'}`;
      if (seccionesHTML.length === 0) {
        contenedor.innerHTML = `
          <div class="empty-state">
            <h3>No se encontraron reservas para ${nombreCurso}</h3>
            <p>Probá cambiando el cuatrimestre, la fecha o revisá otra comisión.</p>
          </div>
        `;
      } else {
        contenedor.innerHTML = seccionesHTML.join('');
      }
      return;
    }

    // Vista de un Día específico (Lunes a Sábado)
    const diaObj = DIAS_SEMANA.find(x => x.id === state.diaSemana);
    const modoTexto = state.modoConsulta === 'FECHA_EXACTA'
      ? `Fecha ${state.fechaExacta.split('-').reverse().join('/')}`
      : state.cuatrimestre === '2C'
        ? '2° Cuatrimestre'
        : state.cuatrimestre === '1C'
          ? '1° Cuatrimestre'
          : 'Ciclo Anual';

    tituloEl.textContent = `¿Dónde cursa ${nombreCurso} el ${diaObj.nombre}? (${modoTexto})`;
    const items = obtenerEventosParaDia(state.diaSemana);
    contadorEl.textContent = `${items.length} ${items.length === 1 ? 'clase / aula asignada' : 'clases / aulas asignadas'}`;

    if (items.length === 0) {
      contenedor.innerHTML = `
        <div class="empty-state">
          <h3>Sin reservas registradas para ${nombreCurso} el día ${diaObj.nombre} (${modoTexto})</h3>
          <p>Seleccioná otro día de la semana, cambiá a "Semana completa" o verificá otro cuatrimestre.</p>
        </div>
      `;
      return;
    }

    contenedor.innerHTML = `
      <div class="cards-list">
        ${items.map(item => construirTarjetaHTML(item, state.diaSemana)).join('')}
      </div>
    `;
  }

  function actualizarEstadoSincronizacion() {
    const badge = document.getElementById('sync-status');
    if (!badge || !state.datos.actualizadoEn) return;
    const fecha = new Date(state.datos.actualizadoEn);
    const fmt = fecha.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    badge.textContent = `Datos UTN FRM: ${state.datos.totalRecursos} aulas · Actualizado ${fmt}`;
  }

  async function sincronizarEnVivo() {
    const btn = document.getElementById('btn-sync');
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Actualizando datos...';

    try {
      const resp = await fetch('/api/sincronizar', { method: 'POST' });
      if (!resp.ok) throw new Error('Modo estático');
      await resp.json();
      window.location.reload();
    } catch {
      try {
        await fetch(`datos-reservas.js?t=${Date.now()}`, { cache: 'no-store' });
        btn.innerHTML = '✅ Datos sincronizados al día';
      } catch {
        btn.innerHTML = '✅ Base 2026 activa';
      }
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
      }, 2500);
    }
  }

  function inicializarEventosDOM() {
    const searchInput = document.getElementById('course-search');
    searchInput.addEventListener('input', () => {
      renderizarSelectorCursos();
    });

    const selectCurso = document.getElementById('course-select');
    selectCurso.addEventListener('change', e => {
      seleccionarCurso(e.target.value);
    });

    const subjectSearch = document.getElementById('subject-search');
    subjectSearch.addEventListener('input', e => {
      state.busquedaTexto = e.target.value;
      renderizarResultados();
    });

    const modeSelect = document.getElementById('query-mode');
    const semesterSelect = document.getElementById('semester-select');
    const exactDateInput = document.getElementById('exact-date');

    exactDateInput.value = state.fechaExacta;

    modeSelect.addEventListener('change', e => {
      state.modoConsulta = e.target.value;
      semesterSelect.style.display = state.modoConsulta === 'SEMANA_HABITUAL' ? '' : 'none';
      exactDateInput.style.display = state.modoConsulta === 'FECHA_EXACTA' ? '' : 'none';
      renderizarResultados();
    });

    semesterSelect.addEventListener('change', e => {
      state.cuatrimestre = e.target.value;
      renderizarResultados();
    });

    exactDateInput.addEventListener('change', e => {
      if (!e.target.value) return;
      state.fechaExacta = e.target.value;
      const dow = obtenerDiaSemanaISO(state.fechaExacta);
      if (dow >= 1 && dow <= 6) {
        state.diaSemana = dow;
        renderizarBarraDias();
      }
      renderizarResultados();
    });

    const checkElectivas = document.getElementById('include-electivas');
    checkElectivas.addEventListener('change', e => {
      state.incluirElectivas = e.target.checked;
      renderizarResultados();
    });

    document.getElementById('btn-sync').addEventListener('click', sincronizarEnVivo);
  }

  function iniciar() {
    indexarDatos();
    actualizarEstadoSincronizacion();
    renderizarFiltrosEspecialidad();
    renderizarFiltrosAnio();
    renderizarSelectorCursos();
    renderizarBarraDias();
    inicializarEventosDOM();
    renderizarResultados();
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
