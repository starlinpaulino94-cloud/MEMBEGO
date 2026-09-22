/**
 * QUÉ CIFRAS VE CADA QUIEN EN EL ÍNDICE DE REPORTES — núcleo puro.
 *
 * El resumen ejecutivo enseña las mismas cinco cifras a todo el mundo. A quien
 * lleva el mostrador, «cobros de membresías» no le dice nada el lunes por la
 * mañana; a quien lleva las cuentas, «entregas sin cobro» es ruido. Cinco
 * tarjetas donde dos sobran hacen que las tres que importan se lean peor.
 *
 * Esto vive aparte de la pantalla, sin Prisma ni React, por la misma razón que
 * `insights.ts`: son reglas que hay que poder probar sin base de datos. Lo que
 * se guarda es un sobre con versión —igual que `User.permisos`— para que el día
 * que la forma cambie, lo viejo se pueda leer en vez de romperse.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LA DECISIÓN QUE MÁS IMPORTA: SE GUARDA LO OCULTO, NO LO VISIBLE
 *
 * Parece lo mismo y no lo es. Si se guardara la lista de las que SÍ se ven,
 * la cifra que se añada mañana no estaría en ninguna preferencia guardada — y
 * quedaría escondida para todo el que hubiera personalizado alguna vez, sin
 * que nada fallara. Una métrica nueva que nadie ve es peor que no añadirla.
 *
 * Guardando lo oculto, lo que no se nombra se enseña. Una tarjeta nueva
 * aparece sola para todos, y quien no quiera verla la quita.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Y EL PERMISO NO SE NEGOCIA
 *
 * Una preferencia elige entre lo que ya se puede ver. Sin `ver_financieros`,
 * las cifras de dinero no aparecen aunque la preferencia diga lo contrario:
 * quien guarda el sobre es la persona, y lo que puede ver lo decide el
 * permiso, que se comprueba en el servidor en cada carga.
 */

/** Una cifra del resumen ejecutivo. El orden de esta lista es el de fábrica. */
export interface CifraResumen {
  clave: string
  label: string
  /** Exige `ver_financieros`. Sin el permiso no se enseña ni se ofrece. */
  financiera?: boolean
}

export const CIFRAS_RESUMEN: readonly CifraResumen[] = [
  { clave: 'ingresosCaja', label: 'Ingresos de caja', financiera: true },
  { clave: 'cobrosMembresias', label: 'Cobros de membresías', financiera: true },
  { clave: 'ventas', label: 'Ventas' },
  { clave: 'entregas', label: 'Entregas sin cobro' },
  { clave: 'clientesNuevos', label: 'Clientes nuevos' },
]

export interface PreferenciasReportes {
  v: 1
  /** Las que esta persona quitó. Lo que no está aquí, se enseña. */
  ocultas: string[]
  /** El orden elegido. Lo que no esté, va detrás en el orden de fábrica. */
  orden: string[]
}

export const PREFERENCIAS_VACIAS: PreferenciasReportes = { v: 1, ocultas: [], orden: [] }

const CLAVES = new Set(CIFRAS_RESUMEN.map((c) => c.clave))

/**
 * Lee el sobre guardado. NUNCA lanza.
 *
 * Lo que hay en la columna lo escribió una versión anterior de este código, y
 * una pantalla de reportes no puede caerse porque un sobre venga raro: se cae
 * a «sin preferencias», que es exactamente lo que ve alguien que nunca tocó
 * nada. Las claves que ya no existen se descartan aquí —una tarjeta retirada
 * deja su nombre suelto en los sobres de todo el mundo— y así el resto del
 * código puede dar por bueno lo que recibe.
 */
export function leerPreferencias(json: unknown): PreferenciasReportes {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return PREFERENCIAS_VACIAS
  const o = json as Record<string, unknown>
  if (o.v !== 1) return PREFERENCIAS_VACIAS
  const lista = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && CLAVES.has(x)))] : []
  return { v: 1, ocultas: lista(o.ocultas), orden: lista(o.orden) }
}

/**
 * Las cifras que de verdad se pintan, en su orden.
 *
 * El permiso recorta primero: una cifra financiera sin `ver_financieros` no
 * entra ni en la lista ni en el panel de personalización.
 *
 * Y hay un suelo: **nunca se devuelve una lista vacía**. Esconder las cinco
 * deja un encabezado con una caja vacía debajo, que se lee como un fallo y no
 * como una elección. Si el sobre las oculta todas, se enseña la primera que el
 * permiso permita — y `alternarCifra` no deja llegar ahí de todos modos.
 */
export function resolverCifras(
  pref: PreferenciasReportes,
  opciones: { verFinancieros: boolean }
): CifraResumen[] {
  const permitidas = CIFRAS_RESUMEN.filter((c) => opciones.verFinancieros || !c.financiera)
  const visibles = permitidas.filter((c) => !pref.ocultas.includes(c.clave))
  const elegidas = visibles.length > 0 ? visibles : permitidas.slice(0, 1)

  // El orden guardado manda; lo que no nombra conserva el de fábrica, detrás.
  const puesto = (clave: string) => {
    const i = pref.orden.indexOf(clave)
    return i === -1 ? pref.orden.length + CIFRAS_RESUMEN.findIndex((c) => c.clave === clave) : i
  }
  return [...elegidas].sort((a, b) => puesto(a.clave) - puesto(b.clave))
}

/**
 * Enseña u oculta una cifra.
 *
 * No deja quitar la última: un resumen ejecutivo sin cifras no es una
 * preferencia, es una pantalla rota. Quien lo intente recibe el sobre sin
 * cambios y la pantalla lo dice.
 */
export function alternarCifra(
  pref: PreferenciasReportes,
  clave: string,
  visible: boolean,
  opciones: { verFinancieros: boolean }
): PreferenciasReportes {
  if (!CLAVES.has(clave)) return pref
  if (visible) return { ...pref, ocultas: pref.ocultas.filter((c) => c !== clave) }
  if (pref.ocultas.includes(clave)) return pref
  const quedan = resolverCifras(pref, opciones).filter((c) => c.clave !== clave)
  if (quedan.length === 0) return pref
  return { ...pref, ocultas: [...pref.ocultas, clave] }
}

/**
 * Sube o baja una cifra un puesto.
 *
 * El orden se guarda COMPLETO, no como un par de posiciones sueltas: así una
 * cifra nueva no se cuela en medio de un orden elegido a mano.
 */
export function moverCifra(
  pref: PreferenciasReportes,
  clave: string,
  direccion: 'arriba' | 'abajo',
  opciones: { verFinancieros: boolean }
): PreferenciasReportes {
  const actual = resolverCifras(pref, opciones).map((c) => c.clave)
  const i = actual.indexOf(clave)
  const j = direccion === 'arriba' ? i - 1 : i + 1
  if (i === -1 || j < 0 || j >= actual.length) return pref
  const orden = [...actual]
  ;[orden[i], orden[j]] = [orden[j], orden[i]]
  return { ...pref, orden }
}

/** ¿Hay algo guardado, o esta persona nunca tocó nada? */
export function hayPreferencias(pref: PreferenciasReportes): boolean {
  return pref.ocultas.length > 0 || pref.orden.length > 0
}
