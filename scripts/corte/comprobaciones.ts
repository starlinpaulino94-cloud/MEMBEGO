/**
 * LAS COMPROBACIONES DEL CORTE `membego.com` / `app.membego.com` (separación landing/app · F8).
 *
 * Es lo que el runbook de F7 pide mirar a mano, hecho código: dado el origen de la landing y el de la app, pregunta a un
 * despliegue REAL (staging o producción) y dice qué de lo prometido se cumple. Está separado del cliente HTTP para poder
 * probarlo: `pedir` es una función que recibe el origen, la ruta y las opciones, y devuelve estado, cabeceras y cuerpo.
 *
 * No sigue redirecciones (son lo que se mide), no necesita sesión (todo lo que mira es público) y no escribe nada: solo GET,
 * HEAD y un POST que debe NO desviarse.
 */

import { anfitrionDeRuta } from '../../src/lib/anfitriones'

export interface Respuesta {
  status: number
  headers: Record<string, string>
  setCookies: string[]
  body: string
}

export interface OpcionesDePeticion {
  method?: string
  headers?: Record<string, string>
}

export type Pedir = (origen: string, ruta: string, opciones?: OpcionesDePeticion) => Promise<Respuesta>

export interface Configuracion {
  landing: string
  app: string
  /** El dominio de la cookie de sesión (`.membego.com`). Sin él no se comprueban las cookies compartidas. */
  dominioCookie?: string
  /** Esperar 308 (corte estable) en vez de 307. */
  permanente?: boolean
}

export interface Comprobacion {
  grupo: string
  nombre: string
  ok: boolean
  detalle?: string
  /** `true` si no se pudo comprobar (falta un dato de configuración): no cuenta como fallo. */
  omitida?: boolean
}

const sinBarra = (origen: string) => origen.replace(/\/+$/, '')
const dominioSinPunto = (d: string) => d.replace(/^\./, '').toLowerCase()

/** ¿Una línea `Set-Cookie` fija el atributo `Domain` pedido? (el punto inicial es irrelevante) */
export function cookieConDominio(linea: string, dominio: string): boolean {
  const m = /;\s*domain=([^;]+)/i.exec(linea)
  return !!m && dominioSinPunto(m[1].trim()) === dominioSinPunto(dominio)
}

export async function comprobarCorte(cfg: Configuracion, pedir: Pedir): Promise<Comprobacion[]> {
  const landing = sinBarra(cfg.landing)
  const app = sinBarra(cfg.app)
  const esperado = cfg.permanente ? 308 : 307
  const resultados: Comprobacion[] = []

  const registrar = (grupo: string, nombre: string, ok: boolean, detalle?: string, omitida = false) => {
    resultados.push({ grupo, nombre, ok: ok || omitida, detalle: ok || omitida ? undefined : detalle, omitida: omitida || undefined })
  }
  const intentar = async (grupo: string, nombre: string, f: () => Promise<{ ok: boolean; detalle?: string; omitida?: boolean }>) => {
    try {
      const r = await f()
      registrar(grupo, nombre, r.ok, r.detalle, r.omitida)
    } catch (e) {
      registrar(grupo, nombre, false, `no se pudo pedir: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const redirige = (r: Respuesta, destino: string) =>
    r.status === esperado && r.headers.location === destino
      ? { ok: true }
      : { ok: false, detalle: `esperaba ${esperado} → ${destino}; llegó ${r.status}${r.headers.location ? ` → ${r.headers.location}` : ''}` }

  // ── Enrutado por host ────────────────────────────────────────────────────────────────────────────────────────────
  await intentar('Enrutado', 'la landing sirve su portada sin redirigir', async () => {
    const r = await pedir(landing, '/')
    return { ok: r.status === 200, detalle: `/ respondió ${r.status}` }
  })
  for (const [ruta, destino] of [
    ['/login', '/login'],
    ['/login?redirect=%2Fcliente%2Finicio', '/login?redirect=%2Fcliente%2Finicio'],
    ['/registro/cuenta?ref=ABC', '/registro/cuenta?ref=ABC'],
    ['/cliente/explorar?ver=ofertas', '/cliente/explorar?ver=ofertas'],
    ['/admin/dashboard', '/admin/dashboard'],
  ]) {
    await intentar('Enrutado', `landing${ruta} va a la app con ruta y consulta intactas`, async () => redirige(await pedir(landing, ruta), `${app}${destino}`))
  }
  await intentar('Enrutado', 'la portada de la app va al acceso', async () => redirige(await pedir(app, '/'), `${app}/login`))
  for (const ruta of ['/promociones', '/empresas?q=spa', '/e/algo', '/r/ABC123', '/i/XYZ']) {
    await intentar('Enrutado', `app${ruta} va a la landing`, async () => redirige(await pedir(app, ruta), `${landing}${ruta}`))
  }
  await intentar('Enrutado', 'la app sirve su acceso sin redirigir', async () => {
    const r = await pedir(app, '/login')
    return { ok: r.status === 200, detalle: `/login respondió ${r.status}` }
  })
  await intentar('Enrutado', 'un POST al host equivocado no se desvía', async () => {
    const r = await pedir(landing, '/login', { method: 'POST' })
    return { ok: r.status !== 307 && r.status !== 308, detalle: `POST /login respondió ${r.status}` }
  })
  await intentar('Enrutado', 'el Host reenviado no decide el destino (sin redirección abierta)', async () => {
    const r = await pedir(landing, '/login', { headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } })
    const destino = r.headers.location ?? ''
    return { ok: destino === `${app}/login` && !destino.includes('evil.example'), detalle: `Location: ${destino || '(ninguna)'}` }
  })

  // ── API ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const [nombre, origen] of [['la landing', landing], ['la app', app]] as const) {
    await intentar('API', `/api responde en ${nombre} sin redirigir`, async () => {
      const salud = await pedir(origen, '/api/health/live')
      const sesion = await pedir(origen, '/api/v1/auth/sesion')
      return {
        ok: salud.status === 200 && sesion.status === 200 && /no-store/.test(sesion.headers['cache-control'] ?? ''),
        detalle: `health ${salud.status}, sesion ${sesion.status}, cache-control «${sesion.headers['cache-control'] ?? ''}»`,
      }
    })
  }

  // ── SEO ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  await intentar('SEO', 'la app no se indexa (X-Robots-Tag y robots.txt)', async () => {
    const login = await pedir(app, '/login')
    const robots = await pedir(app, '/robots.txt')
    const cabecera = /noindex/i.test(login.headers['x-robots-tag'] ?? '')
    const regla = /Disallow:\s*\/\s*$/m.test(robots.body)
    return { ok: cabecera && regla, detalle: `X-Robots-Tag «${login.headers['x-robots-tag'] ?? ''}», robots.txt ${regla ? 'con' : 'SIN'} «Disallow: /»` }
  })
  await intentar('SEO', 'la landing sí se indexa y su robots enlaza su propio sitemap', async () => {
    const portada = await pedir(landing, '/')
    const robots = await pedir(landing, '/robots.txt')
    return {
      ok: !/noindex/i.test(portada.headers['x-robots-tag'] ?? '') && !/Disallow:\s*\/\s*$/m.test(robots.body) && robots.body.includes(`${landing}/sitemap.xml`),
      detalle: `X-Robots-Tag «${portada.headers['x-robots-tag'] ?? ''}»; robots.txt ${robots.body.includes(`${landing}/sitemap.xml`) ? 'enlaza' : 'NO enlaza'} ${landing}/sitemap.xml`,
    }
  })
  await intentar('SEO', 'el canónico de la landing es el de la landing', async () => {
    const portada = await pedir(landing, '/')
    return { ok: portada.body.includes(`rel="canonical" href="${landing}`), detalle: 'no se encontró <link rel="canonical"> con el origen de la landing' }
  })
  await intentar('SEO', 'el sitemap solo lista páginas de la landing, con su origen', async () => {
    const mapa = await pedir(landing, '/sitemap.xml')
    const locs = [...mapa.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const malos = locs.filter((l) => !l.startsWith(landing) || anfitrionDeRuta(l.slice(landing.length) || '/') === 'app')
    return { ok: locs.length > 0 && malos.length === 0, detalle: locs.length === 0 ? 'el sitemap no trae ninguna URL' : `fuera de la landing: ${malos.slice(0, 3).join(', ')}` }
  })

  // ── Cookies ──────────────────────────────────────────────────────────────────────────────────────────────────────
  await intentar('Cookies', 'una landing anónima no responde con cookies (sigue siendo cacheable)', async () => {
    const r = await pedir(landing, '/')
    return { ok: r.setCookies.length === 0, detalle: `Set-Cookie: ${r.setCookies.join(' | ')}` }
  })
  await intentar('Cookies', 'la cookie de canal se siembra en el dominio compartido', async () => {
    if (!cfg.dominioCookie) return { ok: true, omitida: true }
    const r = await pedir(landing, '/?src=verificacion')
    const canal = r.setCookies.find((c) => c.startsWith('mg_canal='))
    return { ok: !!canal && cookieConDominio(canal, cfg.dominioCookie), detalle: canal ? `«${canal}» no lleva Domain=${cfg.dominioCookie}` : 'no se sembró mg_canal' }
  })
  await intentar('Cookies', 'la sesión heredada (host-only) se borra una vez y deja marcador', async () => {
    if (!cfg.dominioCookie) return { ok: true, omitida: true }
    const nombre = 'sb-verificacion-auth-token'
    const primera = await pedir(landing, '/', { headers: { cookie: `${nombre}=heredada` } })
    const borra = primera.setCookies.some((c) => c.startsWith(`${nombre}=;`) && /max-age=0/i.test(c) && !/domain=/i.test(c))
    const marca = primera.setCookies.some((c) => c.startsWith('mg_cd=1'))
    const segunda = await pedir(landing, '/', { headers: { cookie: `${nombre}=heredada; mg_cd=1` } })
    return {
      ok: borra && marca && segunda.setCookies.length === 0,
      detalle: `primera: ${borra ? 'borra' : 'NO borra'}, ${marca ? 'marca' : 'NO marca'}; segunda: ${segunda.setCookies.length} cookies`,
    }
  })

  return resultados
}

/** El resumen que imprime el CLI: una línea por comprobación y el balance. */
export function resumir(resultados: readonly Comprobacion[]): { texto: string; fallos: number } {
  let grupo = ''
  const lineas: string[] = []
  for (const r of resultados) {
    if (r.grupo !== grupo) {
      grupo = r.grupo
      lineas.push(`\n${grupo}`)
    }
    const marca = r.omitida ? '–' : r.ok ? '✓' : '✗'
    lineas.push(`  ${marca} ${r.nombre}${r.omitida ? '  (omitida: falta --cookie-domain)' : ''}${r.detalle ? `\n      ${r.detalle}` : ''}`)
  }
  const fallos = resultados.filter((r) => !r.ok).length
  const omitidas = resultados.filter((r) => r.omitida).length
  lineas.push(`\n${resultados.length - fallos - omitidas} bien, ${fallos} mal${omitidas ? `, ${omitidas} omitidas` : ''}.`)
  return { texto: lineas.join('\n'), fallos }
}
