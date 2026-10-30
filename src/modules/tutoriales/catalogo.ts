/**
 * Tutoriales en video del panel de empresa: clips cortos, uno por tarea («Crear una oferta», «Validar un pago por
 * transferencia»…), con la voz del recorrido grabado. El catálogo (`catalogo.json`) lo genera el kit de grabación
 * (`grabacion/tutoriales/cortar.mts`); los videos y sus carteles viven en el bucket público `tutoriales` de Storage.
 *
 * Aquí no hay datos de ninguna empresa: los tutoriales son los mismos para todas, así que el módulo es puro y se
 * puede usar en el servidor y en el navegador.
 */
import catalogo from './catalogo.json'

export type Tutorial = {
  /** Identificador estable; es el nombre del archivo en Storage. */
  id: string
  titulo: string
  /** Entrada del menú lateral a la que pertenece («Catálogo», «Pagos»…). */
  modulo: string
  /** Prefijos de ruta del panel en los que el tutorial es pertinente. */
  rutas: string[]
  /** Palabras con las que la gente lo busca, además del título. */
  palabras: string[]
  duracionS: number
  /** Lo que dice la voz, para buscar y para leer sin sonido. */
  texto: string
}

export const BUCKET_TUTORIALES = 'tutoriales'
/** Carpeta del bucket con los clips del panel de empresa (los de plataforma irán en otra). */
const CARPETA_EMPRESA = 'empresa'

export const TUTORIALES: readonly Tutorial[] = catalogo as Tutorial[]

/** Los módulos en el orden del menú (el orden del catálogo). */
export const MODULOS_TUTORIALES: readonly string[] = [...new Set(TUTORIALES.map((t) => t.modulo))]

function urlPublica(ruta: string, base: string): string {
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET_TUTORIALES}/${ruta}`
}
/** Dirección pública del video de un tutorial. `base` es la URL de Supabase (por defecto la del entorno). */
export function urlVideo(id: string, base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string {
  return urlPublica(`${CARPETA_EMPRESA}/${id}.mp4`, base)
}
/** Dirección pública del cartel (fotograma) de un tutorial. */
export function urlCartel(id: string, base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string {
  return urlPublica(`${CARPETA_EMPRESA}/${id}.jpg`, base)
}

/** Sin acentos, en minúsculas y con los espacios normalizados: para comparar lo que escribe la gente. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Duración legible: 45 s → «0:45»; 92 s → «1:32». */
export function duracionLegible(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = Math.round(segundos % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Busca por título, módulo, palabras clave y, con menos peso, por lo que dice la voz. Cada palabra de la consulta
 * tiene que aparecer en algún campo; se ordena por relevancia y, a igualdad, por el orden del catálogo.
 */
export function buscarTutoriales(consulta: string, lista: readonly Tutorial[] = TUTORIALES): Tutorial[] {
  const palabras = normalizar(consulta).split(' ').filter(Boolean)
  if (palabras.length === 0) return [...lista]
  const puntuados = lista.map((t, i) => {
    const titulo = normalizar(t.titulo)
    const modulo = normalizar(t.modulo)
    const claves = normalizar(t.palabras.join(' '))
    const texto = normalizar(t.texto)
    let puntos = 0
    for (const p of palabras) {
      if (titulo.includes(p)) puntos += 10
      else if (claves.includes(p)) puntos += 6
      else if (modulo.includes(p)) puntos += 4
      else if (texto.includes(p)) puntos += 1
      else return { t, i, puntos: 0 }
    }
    if (titulo.startsWith(palabras[0])) puntos += 3
    return { t, i, puntos }
  })
  return puntuados
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.i - b.i)
    .map((x) => x.t)
}

/** Longitud del prefijo con el que una ruta del tutorial cubre el `pathname`, o 0 si no lo cubre. */
function cobertura(t: Tutorial, pathname: string): number {
  let mejor = 0
  for (const r of t.rutas) {
    if ((pathname === r || pathname.startsWith(r + '/')) && r.length > mejor) mejor = r.length
  }
  return mejor
}

/**
 * Los tutoriales pertinentes para una pantalla del panel: los que declaran un prefijo de esa ruta, primero los más
 * específicos (prefijo más largo) y, a igualdad, en el orden del catálogo. La consulta (`?x=y`) se ignora.
 */
export function tutorialesDeRuta(pathname: string, lista: readonly Tutorial[] = TUTORIALES): Tutorial[] {
  const ruta = pathname.split('?')[0].replace(/\/+$/, '') || '/'
  return lista
    .map((t, i) => ({ t, i, c: cobertura(t, ruta) }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map((x) => x.t)
}

/** Agrupa una lista por módulo conservando el orden del menú. */
export function agruparPorModulo(lista: readonly Tutorial[]): { modulo: string; tutoriales: Tutorial[] }[] {
  const grupos = new Map<string, Tutorial[]>()
  for (const t of lista) grupos.set(t.modulo, [...(grupos.get(t.modulo) ?? []), t])
  return MODULOS_TUTORIALES.filter((m) => grupos.has(m)).map((modulo) => ({ modulo, tutoriales: grupos.get(modulo)! }))
}
