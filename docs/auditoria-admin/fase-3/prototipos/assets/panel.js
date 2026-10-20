/* PROTOTIPO · fase 3 de la auditoría del panel. HTML estático con DATOS DE EJEMPLO; no toca la aplicación.
   Pinta la carcasa (barra lateral de 21 entradas, barra superior), los diálogos, los avisos y el modo de prueba. */
;(function () {
  'use strict'

  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  const guardar = {
    leer(k) { try { return sessionStorage.getItem(k) } catch { return null } },
    poner(k, v) { try { sessionStorage.setItem(k, v) } catch { /* sin almacenamiento: el prototipo funciona igual */ } },
    leerL(k) { try { return localStorage.getItem(k) } catch { return null } },
    ponerL(k, v) { try { localStorage.setItem(k, v) } catch { /* ídem */ } },
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const ic = (nombre, extra = '') => `<i data-lucide="${nombre}" ${extra} aria-hidden="true"></i>`
  const iconos = () => { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons() }

  // ── Roles (C.3 de docs/auditoria-admin/03): quién ve qué entrada ───────────
  const ROLES = {
    administrador: { letra: 'A', nombre: 'Administrador', persona: 'Laura Martínez', iniciales: 'LM' },
    supervisor: { letra: 'S', nombre: 'Supervisor', persona: 'Carlos Peña', iniciales: 'CP' },
    marketing: { letra: 'M', nombre: 'Marketing', persona: 'Ana Rodríguez', iniciales: 'AR' },
  }
  function rolActual() {
    const p = new URLSearchParams(location.search).get('rol')
    if (p && ROLES[p]) { guardar.poner('mg-rol', p); return p }
    const g = guardar.leer('mg-rol')
    return g && ROLES[g] ? g : 'administrador'
  }
  const ROL = rolActual()

  // ── El menú propuesto: 8 grupos, 21 entradas. `href` solo si la pantalla existe en el prototipo. ──
  const MENU = [
    { grupo: 'Principal', items: [{ id: 'resumen', etq: 'Resumen', ic: 'layout-dashboard', href: 'resumen.html', r: 'ASM' }] },
    { grupo: 'App del cliente', items: [{ id: 'inicio', etq: 'Editor de inicio', ic: 'smartphone', r: 'A' }] },
    { grupo: 'Catálogo', items: [
      { id: 'planes', etq: 'Planes', ic: 'ticket', r: 'A' },
      { id: 'beneficios', etq: 'Beneficios', ic: 'gift', href: 'beneficios.html', r: 'AM' },
      { id: 'tours', etq: 'Parques y Tours', ic: 'tree-palm', r: 'A' },
    ] },
    { grupo: 'Operaciones', items: [
      { id: 'canjes', etq: 'Canjes y QR', ic: 'qr-code', r: 'AS' },
      { id: 'citas', etq: 'Citas', ic: 'calendar-days', r: 'AS' },
      { id: 'pagos', etq: 'Pagos', ic: 'wallet', href: 'pagos.html', r: 'AS', cuenta: 5 },
      { id: 'caja', etq: 'Caja', ic: 'landmark', r: 'A' },
    ] },
    { grupo: 'Clientes', items: [
      { id: 'clientes', etq: 'Clientes', ic: 'users', href: 'clientes.html', r: 'ASM' },
      { id: 'prospectos', etq: 'Prospectos', ic: 'user-plus', r: 'A' },
      { id: 'soporte', etq: 'Soporte', ic: 'life-buoy', r: 'A' },
    ] },
    { grupo: 'Marketing', items: [
      { id: 'comunicaciones', etq: 'Comunicaciones', ic: 'megaphone', r: 'AM' },
      { id: 'publicaciones', etq: 'Publicaciones', ic: 'newspaper', r: 'AM' },
      { id: 'fidelizacion', etq: 'Fidelización', ic: 'heart-handshake', r: 'AS' },
    ] },
    { grupo: 'Analítica', items: [
      { id: 'reportes', etq: 'Reportes', ic: 'chart-no-axes-combined', r: 'ASM' },
      { id: 'actividad', etq: 'Actividad', ic: 'history', r: 'AS' },
    ] },
    { grupo: 'Ajustes', items: [
      { id: 'empresa', etq: 'Empresa', ic: 'building-2', href: 'empresa.html', r: 'A' },
      { id: 'sucursales', etq: 'Sucursales', ic: 'map-pin', r: 'A' },
      { id: 'equipo', etq: 'Equipo', ic: 'shield-check', r: 'A' },
      { id: 'integraciones', etq: 'Integraciones', ic: 'plug', r: 'A' },
    ] },
  ]

  const conRol = (href) => {
    if (!/\.html(\?|#|$)/.test(href)) return href
    const [base, hash = ''] = href.split('#')
    const u = new URL(base, location.href)
    u.searchParams.set('rol', ROL)
    const rel = u.pathname.split('/').pop() + u.search
    return rel + (hash ? '#' + hash : '')
  }

  // ── Formatos: los mismos que usa el producto (es-DO, sin decimales) ──
  const rd = (n) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(n)
  const num = (n) => new Intl.NumberFormat('es-DO').format(n)

  // ── Avisos y diálogos ──────────────────────────────────────────────────────
  function contenedorAvisos() {
    let c = $('.toasts')
    if (!c) { c = document.createElement('div'); c.className = 'toasts'; c.setAttribute('role', 'status'); c.setAttribute('aria-live', 'polite'); document.body.appendChild(c) }
    return c
  }
  function aviso(texto, opts = {}) {
    const t = document.createElement('div')
    t.className = 'toast'
    t.innerHTML = `${ic(opts.error ? 'circle-alert' : 'circle-check')}<span>${esc(texto)}</span>`
    if (opts.deshacer) {
      const b = document.createElement('button')
      b.className = 'enlace-btn'; b.type = 'button'; b.textContent = 'Deshacer'
      b.addEventListener('click', () => { opts.deshacer(); t.remove() })
      t.appendChild(b)
    }
    contenedorAvisos().appendChild(t)
    iconos()
    setTimeout(() => t.remove(), opts.deshacer ? 7000 : 3800)
  }

  let ultimoFoco = null
  function abrirCapa(el) {
    ultimoFoco = document.activeElement
    let velo = $('.velo')
    if (!velo) { velo = document.createElement('div'); velo.className = 'velo'; document.body.appendChild(velo) }
    velo.dataset.abierto = 'true'
    el.dataset.abierto = 'true'
    velo.onclick = () => cerrarCapas()
    const foco = $('[data-foco], button, a, input, select, textarea', el)
    if (foco) setTimeout(() => foco.focus(), 0)
  }
  function cerrarCapas() {
    $$('[data-abierto="true"].dialogo, [data-abierto="true"].hoja').forEach((e) => { e.dataset.abierto = 'false' })
    const v = $('.velo'); if (v) v.dataset.abierto = 'false'
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus()
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarCapas()
    if (e.key === 'Tab') {
      const capa = $('[data-abierto="true"].dialogo, [data-abierto="true"].hoja')
      if (!capa) return
      const f = $$('button, a[href], input, select, textarea', capa).filter((x) => !x.disabled && x.offsetParent !== null)
      if (!f.length) return
      const p = f[0], u = f[f.length - 1]
      if (e.shiftKey && document.activeElement === p) { e.preventDefault(); u.focus() }
      else if (!e.shiftKey && document.activeElement === u) { e.preventDefault(); p.focus() }
    }
    if (e.key === '/' && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) {
      const b = $('.buscar input'); if (b) { e.preventDefault(); b.focus() }
    }
  })

  /** Confirmación solo para lo que lo merece (04 §3, regla 10). Devuelve una promesa de sí/no. */
  function confirmar({ titulo, descripcion, ok = 'Confirmar', cancelar = 'Cancelar', peligro = false }) {
    return new Promise((resolve) => {
      let d = $('#dlg-confirmar')
      if (!d) {
        d = document.createElement('div'); d.id = 'dlg-confirmar'; d.className = 'dialogo'
        d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'dlg-t'); d.setAttribute('aria-describedby', 'dlg-d')
        document.body.appendChild(d)
      }
      d.innerHTML = `<h2 class="t-tarjeta" id="dlg-t">${esc(titulo)}</h2><p class="t-sec" id="dlg-d">${esc(descripcion)}</p>
        <div class="botones"><button type="button" class="btn btn--borde" data-no>${esc(cancelar)}</button>
        <button type="button" class="btn ${peligro ? 'btn--peligro' : ''}" data-si data-foco>${esc(ok)}</button></div>`
      const fin = (v) => { cerrarCapas(); resolve(v) }
      $('[data-no]', d).onclick = () => fin(false)
      $('[data-si]', d).onclick = () => fin(true)
      abrirCapa(d)
    })
  }

  // ── Gráfica de barras con eje y valores, y su tabla alternativa (05 · D-13) ──
  function barras(contenedor, valores, etiquetas, { titulo = '', unidad = 'canjes' } = {}) {
    const W = 720, H = 220, mi = 36, md = 8, ms = 22, mb = 28
    const max = Math.max(...valores)
    const tope = Math.ceil(max / 5) * 5 || 5
    const bw = (W - mi - md) / valores.length
    const y = (v) => ms + (H - ms - mb) * (1 - v / tope)
    const iPico = valores.indexOf(max)
    let svg = `<svg class="grafica" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}: ${valores.map((v, i) => etiquetas[i] + ' ' + v).join(', ')}">`
    for (const t of [0, tope / 2, tope]) {
      svg += `<line class="eje" x1="${mi}" x2="${W - md}" y1="${y(t)}" y2="${y(t)}"/><text x="${mi - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`
    }
    valores.forEach((v, i) => {
      const x = mi + i * bw + bw * 0.18, w = bw * 0.64, top = y(v)
      svg += `<rect class="barra ${i === iPico ? 'barra--pico' : ''}" x="${x}" y="${top}" width="${w}" height="${Math.max(0, y(0) - top)}" rx="4"><title>${esc(etiquetas[i])}: ${v} ${unidad}</title></rect>`
      if (v === max) svg += `<text class="valor" x="${x + w / 2}" y="${top - 5}" text-anchor="middle">${v}</text>`
      if (i % 2 === 0 || valores.length <= 8) svg += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(etiquetas[i])}</text>`
    })
    svg += '</svg>'
    const filas = valores.map((v, i) => `<tr><th scope="row">${esc(etiquetas[i])}</th><td class="num">${v}</td></tr>`).join('')
    contenedor.innerHTML = svg + `<details class="tabla-alt"><summary>Ver como tabla</summary>
      <div class="tabla-caja" style="margin-top:8px"><table class="tabla"><caption class="solo-lector">${esc(titulo)}</caption>
      <thead><tr><th scope="col">Día</th><th scope="col" class="num">${esc(unidad)}</th></tr></thead><tbody>${filas}</tbody></table></div></details>`
  }

  // ── Carcasa ────────────────────────────────────────────────────────────────
  /** Pinta la carcasa. Devuelve `false` si el rol no puede abrir esta pantalla: entonces la página NO debe pintar su contenido. */
  function construir() {
    const main = $('#contenido')
    if (!main) return false
    const body = document.body
    const pagina = body.dataset.pagina || ''
    const titulo = body.dataset.titulo || document.title
    const rolesOk = (body.dataset.roles || 'ASM').includes(ROLES[ROL].letra)

    // Migas: la última es la pantalla actual. Las anteriores son enlaces.
    let migas = []
    try { migas = JSON.parse(body.dataset.migas || '[]') } catch { migas = [] }
    const migasHtml = [...migas.map(([t, h]) => `<a href="${esc(conRol(h))}">${esc(t)}</a>${ic('chevron-right')}`), `<span aria-current="page" title="${esc(titulo)}">${esc(titulo)}</span>`].join('')

    const visibles = MENU.map((g) => ({ ...g, items: g.items.filter((i) => i.r.includes(ROLES[ROL].letra)) })).filter((g) => g.items.length)
    const totalItems = visibles.reduce((n, g) => n + g.items.length, 0)
    const nav = visibles.map((g) => `<div class="nav-grupo" role="group" aria-label="${esc(g.grupo)}"><div class="t-rotulo">${esc(g.grupo)}</div>${g.items.map((i) => {
      const actual = i.id === pagina
      const cuenta = i.cuenta ? `<span class="cuenta" aria-label="${i.cuenta} pendientes">${i.cuenta}</span>` : ''
      return i.href
        ? `<a class="nav-item" href="${esc(conRol(i.href))}" ${actual ? 'aria-current="page"' : ''}>${ic(i.ic)}<span>${esc(i.etq)}</span>${cuenta}</a>`
        : `<button type="button" class="nav-item fuera-proto" data-fuera="${esc(i.etq)}">${ic(i.ic)}<span>${esc(i.etq)}</span></button>`
    }).join('')}</div>`).join('')

    const opcionesRol = Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === ROL ? 'selected' : ''}>${v.nombre}</option>`).join('')
    const puedeCanje = 'AS'.includes(ROLES[ROL].letra)

    const aviso0 = document.createElement('div')
    aviso0.className = 'aviso-proto'
    aviso0.innerHTML = `<strong>PROTOTIPO</strong><span>Datos de ejemplo · no es la aplicación · hoy es 20 de octubre de 2026</span><span>Menú propuesto: ${totalItems} entradas para el rol ${esc(ROLES[ROL].nombre)}</span>`

    const app = document.createElement('div')
    app.className = 'app'
    app.innerHTML = `
      <nav class="lateral" id="lateral" aria-label="Navegación principal">
        <div class="marca"><div class="marca-logo" aria-hidden="true">M</div><div><div class="marca-nombre">MEMBEGO</div><div class="marca-sub">Panel de empresa</div></div></div>
        <button type="button" class="empresa-card" data-fuera="Cambiar de empresa"><span class="av" aria-hidden="true">AC</span>
          <span class="txt"><span class="nom" title="Aventuras del Caribe Tours &amp; Parque Acuático">Aventuras del Caribe Tours &amp; Parque Acuático</span><span class="rol">${esc(ROLES[ROL].nombre)}</span></span>${ic('chevrons-up-down')}</button>
        ${nav}
        <div class="lateral-pie"><span class="av" aria-hidden="true">${ROLES[ROL].iniciales}</span><div><div class="nom">${esc(ROLES[ROL].persona)}</div><div class="rol">Salir</div></div></div>
      </nav>
      <div class="principal">
        <header class="superior">
          <button type="button" class="icono-btn menu-movil" id="abrir-menu" aria-label="Abrir el menú" aria-controls="lateral" aria-expanded="false">${ic('menu')}</button>
          <nav class="migas" aria-label="Migas de pan">${migasHtml}</nav>
          <div class="buscar" role="search">${ic('search')}<input type="text" placeholder="Buscar en el panel" aria-label="Buscar en el panel"><kbd>/</kbd></div>
          <label class="ver-como"><span>Ver como</span><select id="ver-como" aria-label="Ver el prototipo como">${opcionesRol}</select></label>
          ${puedeCanje ? `<button type="button" class="btn btn--sm" data-fuera="Canje rápido">${ic('scan-line')}<span>Canje rápido</span></button>` : ''}
          <button type="button" class="icono-btn" aria-label="Notificaciones: 3 sin leer" data-fuera="Notificaciones">${ic('bell')}<span class="punto"></span></button>
          <span class="av" aria-hidden="true">${ROLES[ROL].iniciales}</span>
        </header>
      </div>`
    body.insertBefore(aviso0, body.firstChild)
    body.insertBefore(app, aviso0.nextSibling)
    const principal = $('.principal', app)
    if (!rolesOk) {
      main.className = 'pagina pagina--formulario'
      main.innerHTML = `<div class="tarjeta tarjeta--pad vacio">${ic('lock')}<h1 class="t-seccion">No tienes acceso a esta sección</h1>
        <p>El rol <strong>${esc(ROLES[ROL].nombre)}</strong> no incluye «${esc(titulo)}». La entrada ni siquiera aparece en su menú: llegó por un enlace guardado.</p>
        <a class="btn btn--borde" href="${esc(conRol('resumen.html'))}">Volver al Resumen</a></div>`
    }
    principal.appendChild(main)

    // Interacciones de la carcasa
    $('#ver-como').addEventListener('change', (e) => { guardar.poner('mg-rol', e.target.value); const u = new URL(location.href); u.searchParams.set('rol', e.target.value); location.href = u.toString() })
    const abrir = $('#abrir-menu'), lat = $('#lateral')
    abrir.addEventListener('click', () => { const v = lat.dataset.abierto === 'true'; lat.dataset.abierto = String(!v); abrir.setAttribute('aria-expanded', String(!v)) })
    document.addEventListener('click', (e) => { if (lat.dataset.abierto === 'true' && !lat.contains(e.target) && !abrir.contains(e.target)) { lat.dataset.abierto = 'false'; abrir.setAttribute('aria-expanded', 'false') } })

    reenlazar(document)
    iconos()
    return rolesOk
  }

  /** Todo enlace interno conserva el rol, y todo lo que está fuera del prototipo avisa en vez de navegar.
      Cada página lo llama de nuevo después de pintar su contenido. */
  function reenlazar(raiz = document) {
    $$('a[href]', raiz).forEach((a) => {
      if (a.dataset.rolado) return
      const h = a.getAttribute('href')
      if (h && !h.startsWith('http') && !h.startsWith('#')) { a.setAttribute('href', conRol(h)); a.dataset.rolado = '1' }
    })
    $$('[data-fuera]', raiz).forEach((b) => {
      if (b.dataset.ligado) return
      b.dataset.ligado = '1'
      b.addEventListener('click', (e) => { e.preventDefault(); aviso(`«${b.dataset.fuera}» es parte del menú propuesto, pero no está en este prototipo.`) })
    })
  }

  // ── Modo de prueba: cuenta clics, pantallas y tiempo de una tarea ───────────
  const TAREAS = {
    t1: { rotulo: 'Aprobar una transferencia', texto: 'Aprueba la transferencia de «Inversiones Turísticas del Atlántico».', rol: 'administrador' },
    t2: { rotulo: 'Crear una promoción 2×1', texto: 'Crea y publica la promoción «Pasadía 2×1 entre semana».', rol: 'administrador' },
    t3: { rotulo: 'Saber cuánto se vendió este mes', texto: 'Di cuánto se vendió este mes y cuántas membresías se perdieron.', rol: 'administrador' },
  }
  const CLAVE = 'mg-prueba'
  const leerPrueba = () => { try { return JSON.parse(guardar.leer(CLAVE) || 'null') } catch { return null } }
  const ponerPrueba = (p) => guardar.poner(CLAVE, JSON.stringify(p))

  function panelPrueba() {
    const p = document.createElement('aside')
    p.className = 'prueba'; p.setAttribute('aria-label', 'Modo de prueba (observador)')
    document.body.appendChild(p)
    let timer = null
    const pintar = () => {
      const s = leerPrueba()
      // En pantallas pequeñas el panel de pruebas arranca plegado para no tapar lo que se está probando.
      const pref = guardar.leer('mg-prueba-min')
      const min = pref === null ? window.innerWidth < 768 : pref === '1'
      p.dataset.min = String(min)
      const cab = `<div class="prueba-cab"><span>Modo de prueba</span><button type="button" class="btn btn--sm" data-min>${min ? 'Abrir' : 'Ocultar'}</button></div>`
      const opciones = Object.entries(TAREAS).map(([k, t]) => `<option value="${k}" ${s && s.tarea === k ? 'selected' : ''}>${esc(t.rotulo)}</option>`).join('')
      if (!s || !s.activa) {
        p.innerHTML = cab + `<p>Elige la tarea, pulsa <b>Iniciar</b> (vuelve al Resumen) y deja que la persona la haga sola. Aquí se cuentan clics, pantallas y segundos.</p>
          <select id="p-tarea" aria-label="Tarea">${opciones}</select>
          <div class="btn-fila"><button type="button" class="btn btn--primario" data-iniciar>Iniciar</button><button type="button" class="btn" data-ver>Resultados</button></div>`
      } else {
        const t = TAREAS[s.tarea]
        p.innerHTML = cab + `<p><b>${esc(t.rotulo)}.</b> ${esc(t.texto)}</p>
          <div class="contadores"><div><b data-c>${s.clics}</b>clics</div><div><b data-p>${s.pantallas}</b>pantallas</div><div><b data-t>0</b>seg</div></div>
          <textarea id="p-nota" placeholder="Qué dijo, dónde dudó (opcional)" aria-label="Notas del observador"></textarea>
          <div class="btn-fila"><button type="button" class="btn btn--primario" data-fin>Terminé</button><button type="button" class="btn" data-cancelar>Cancelar</button></div>`
      }
      iconos()
    }
    const tic = () => {
      const s = leerPrueba(); if (!s || !s.activa) return
      const t = $('[data-t]', p); if (t) t.textContent = String(Math.round((Date.now() - s.t0) / 1000))
    }
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return
      const s = leerPrueba()
      if (b.hasAttribute('data-min')) { guardar.poner('mg-prueba-min', p.dataset.min === 'true' ? '0' : '1'); pintar(); return }
      if (b.hasAttribute('data-iniciar')) {
        const k = $('#p-tarea', p).value
        ponerPrueba({ activa: true, tarea: k, t0: Date.now(), clics: 0, pantallas: 1, ruta: 'resumen.html' })
        guardar.poner('mg-rol', TAREAS[k].rol)
        location.href = 'resumen.html?rol=' + TAREAS[k].rol
        return
      }
      if (b.hasAttribute('data-fin') && s) {
        const nota = ($('#p-nota', p) || {}).value || ''
        const fila = { tarea: TAREAS[s.tarea].rotulo, clics: s.clics, pantallas: s.pantallas, segundos: Math.round((Date.now() - s.t0) / 1000), nota }
        const todos = JSON.parse(guardar.leerL('mg-resultados') || '[]'); todos.push(fila); guardar.ponerL('mg-resultados', JSON.stringify(todos))
        ponerPrueba({ ...s, activa: false }); pintar()
        aviso(`Registrado: ${fila.clics} clics, ${fila.pantallas} pantallas, ${fila.segundos} s.`)
        return
      }
      if (b.hasAttribute('data-cancelar')) { ponerPrueba({ ...(s || {}), activa: false }); pintar(); return }
      if (b.hasAttribute('data-ver')) {
        const todos = JSON.parse(guardar.leerL('mg-resultados') || '[]')
        const csv = ['tarea;clics;pantallas;segundos;nota', ...todos.map((r) => [r.tarea, r.clics, r.pantallas, r.segundos, (r.nota || '').replace(/[;\n]/g, ' ')].join(';'))].join('\n')
        p.innerHTML = `<div class="prueba-cab"><span>Resultados (${todos.length})</span><button type="button" class="btn btn--sm" data-volver>Volver</button></div>
          <textarea readonly aria-label="Resultados en CSV" style="min-height:120px">${esc(csv)}</textarea>
          <div class="btn-fila"><button type="button" class="btn" data-copiar>Copiar</button><button type="button" class="btn" data-borrar>Borrar todo</button></div>`
        return
      }
      if (b.hasAttribute('data-volver')) { pintar(); return }
      if (b.hasAttribute('data-copiar')) { const ta = $('textarea', p); ta.select(); try { document.execCommand('copy'); aviso('Resultados copiados.') } catch { /* el observador puede copiar a mano */ } return }
      if (b.hasAttribute('data-borrar')) { guardar.ponerL('mg-resultados', '[]'); pintar(); return }
    })
    // Conteo: cada clic sobre algo interactivo cuenta; cada cambio de página (ruta) suma una pantalla.
    document.addEventListener('click', (e) => {
      const s = leerPrueba(); if (!s || !s.activa) return
      if (e.target.closest('.prueba')) return
      if (!e.target.closest('a[href], button, summary, [role="tab"], label.opcion, select, input[type="checkbox"], input[type="radio"], .filtro-chip')) return
      s.clics += 1; ponerPrueba(s)
      const c = $('[data-c]', p); if (c) c.textContent = String(s.clics)
    }, true)
    const s0 = leerPrueba()
    if (s0 && s0.activa) {
      const ruta = location.pathname.split('/').pop()
      if (ruta !== s0.ruta) { s0.pantallas += 1; s0.ruta = ruta; ponerPrueba(s0) }
    }
    pintar()
    timer = setInterval(tic, 500); tic()
    return timer
  }

  // ── Datos de ejemplo compartidos ───────────────────────────────────────────
  const datos = {
    pagos: [
      { id: 'p1', cola: 'sucursal', cliente: 'Luis Alberto Ramírez', cid: 'c2', concepto: 'Pase mensual Plus', metodo: 'Efectivo en sucursal Naco', monto: 1800, hace: 'hace 12 min', prio: 1 },
      { id: 'p2', cola: 'transferencias', cliente: 'María del Carmen Pérez de la Rosa', cid: 'c1', concepto: 'Renovación · Pase anual familiar', metodo: 'Transferencia Banreservas', monto: 14500, hace: 'hace 3 h', prio: 2, ref: 'REF-77310245' },
      { id: 'p3', cola: 'transferencias', cliente: 'Inversiones Turísticas del Atlántico, S.R.L.', cid: 'c3', concepto: 'Paquete corporativo · 20 entradas', metodo: 'Transferencia Banco Popular', monto: 32000, hace: 'hace 1 día', prio: 3, ref: 'REF-77298114' },
      { id: 'p4', cola: 'compras', cliente: 'Ana Sofía Jiménez', cid: 'c4', concepto: 'Compra · Combo Día de Playa 2×1', metodo: 'Transferencia Banreservas', monto: 2400, hace: 'hace 5 h', prio: 4 },
      { id: 'p5', cola: 'cambios', cliente: 'Pedro Julián Santana', cid: 'c5', concepto: 'Cambio de plan · Mensual → Anual', metodo: 'Diferencia a cobrar', monto: 9600, hace: 'hace 2 días', prio: 5 },
    ],
    colas: { sucursal: 'En sucursal', transferencias: 'Transferencias', compras: 'Compras', cambios: 'Cambios de plan', seguimiento: 'Sin completar' },
    clientes: [
      { id: 'c1', nombre: 'María del Carmen Pérez de la Rosa', plan: 'Pase anual familiar', estado: 'Activa', tono: 'exito', vence: '12 nov 2026', riesgo: 'bajo', tel: '+1 809 555 0142' },
      { id: 'c2', nombre: 'Luis Alberto Ramírez', plan: 'Pase mensual Plus', estado: 'Pendiente de pago', tono: 'aviso', vence: '—', riesgo: 'medio', tel: '+1 829 555 0178' },
      { id: 'c3', nombre: 'Inversiones Turísticas del Atlántico, S.R.L.', plan: 'Paquete corporativo', estado: 'Pendiente de pago', tono: 'aviso', vence: '—', riesgo: 'bajo', tel: '+1 809 555 0199' },
      { id: 'c4', nombre: 'Ana Sofía Jiménez', plan: 'Pase mensual Plus', estado: 'Vence pronto', tono: 'aviso', vence: '27 oct 2026', riesgo: 'alto', tel: '+1 849 555 0123' },
      { id: 'c5', nombre: 'Pedro Julián Santana', plan: 'Pase mensual Plus', estado: 'Vence pronto', tono: 'aviso', vence: '24 oct 2026', riesgo: 'alto', tel: '+1 809 555 0166' },
      // Con c4 y c5 son los 6 que vencen en 7 días: el Resumen y «En riesgo» deben decir lo mismo.
      { id: 'c6', nombre: 'Rafael Antonio Mejía Castillo', plan: 'Pase mensual Plus', estado: 'Vence pronto', tono: 'aviso', vence: '21 oct 2026', riesgo: 'alto', tel: '+1 809 555 0188' },
      { id: 'c7', nombre: 'Yamilet Altagracia Núñez', plan: 'Pase anual familiar', estado: 'Vence pronto', tono: 'aviso', vence: '22 oct 2026', riesgo: 'alto', tel: '+1 829 555 0134' },
      { id: 'c8', nombre: 'Hotel Boutique Las Terrenas', plan: 'Paquete corporativo', estado: 'Vence pronto', tono: 'aviso', vence: '23 oct 2026', riesgo: 'alto', tel: '+1 809 555 0111' },
      { id: 'c9', nombre: 'José Miguel Santos', plan: 'Pase mensual Plus', estado: 'Vence pronto', tono: 'aviso', vence: '26 oct 2026', riesgo: 'alto', tel: '+1 849 555 0150' },
    ],
  }

  window.MG = { $, $$, esc, ic, iconos, aviso, confirmar, abrirCapa, cerrarCapas, barras, rd, num, rol: ROL, ROLES, conRol, reenlazar, datos, guardar }

  document.addEventListener('DOMContentLoaded', () => {
    const conAcceso = construir()
    panelPrueba()
    // Sin acceso, la página no pinta nada: el aviso «No tienes acceso» es lo único que debe verse (como en el producto, 05 · D-07).
    if (conAcceso) document.dispatchEvent(new CustomEvent('mg:listo'))
    iconos()
  })
})()
