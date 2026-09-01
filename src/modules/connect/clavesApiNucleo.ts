/**
 * NÚCLEO PURO de las claves de API por empresa (Membego Connect · Fase 3).
 *
 * Sin Prisma, sin red, sin `server-only`: el formato de la clave y su lectura
 * se prueban aquí, que es donde importa. Un fallo en este archivo es una clave
 * que no autentica a quien debe, o —peor— una que autentica a quien no debe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA FORMA DE LA CLAVE
 *
 *     mbk_a1b2c3d4e5f6.RANDOM_DE_32_BYTES_EN_BASE64URL
 *     └──── prefijo ────┘└──────────── secreto ────────────┘
 *
 * Las dos mitades viajan JUNTAS y cumplen papeles distintos:
 *
 *   · El PREFIJO es público e indexado. Localiza la fila con un índice único,
 *     sin probar hashes contra la tabla entera. Comparar scrypt contra cada
 *     fila sería, además de lento, un modo cómodo de tumbar el servidor.
 *   · El SECRETO no se guarda: solo su hash scrypt. Un volcado de la tabla no
 *     autentica a nadie.
 *
 * El prefijo `mbk_` al principio hace que la clave sea RECONOCIBLE a simple
 * vista — para nosotros al leer la cabecera, y para los escáneres de secretos
 * de GitHub, que es donde estas claves acaban filtrándose de verdad.
 */

/** Marca de agua de una clave de MembeGo. */
export const PREFIJO_CLAVE = 'mbk_'

/** Caracteres del prefijo DESPUÉS de `mbk_`. */
const LARGO_PREFIJO = 12

/** Mínimo del secreto para que la clave se considere siquiera plausible. */
const LARGO_MINIMO_SECRETO = 32

export interface ClavePartida {
  /** `mbk_a1b2c3d4e5f6` — la mitad pública, la que localiza la fila. */
  prefijo: string
  /** La mitad que se compara contra el hash. Nunca se guarda ni se registra. */
  secreto: string
}

/**
 * Parte una clave presentada en sus dos mitades. Devuelve `null` si no tiene la
 * forma esperada — y eso corta el paso ANTES de tocar la base: una cabecera con
 * basura no debe costar una consulta.
 */
export function partirClave(bruto: string | null | undefined): ClavePartida | null {
  const v = (bruto ?? '').trim()
  if (!v.startsWith(PREFIJO_CLAVE)) return null

  const punto = v.indexOf('.')
  if (punto <= 0) return null

  const prefijo = v.slice(0, punto)
  const secreto = v.slice(punto + 1)

  // El prefijo tiene largo FIJO: `mbk_` + 12. Aceptar largos variables
  // permitiría que dos claves distintas compartieran prefijo por casualidad.
  if (prefijo.length !== PREFIJO_CLAVE.length + LARGO_PREFIJO) return null
  if (!/^[a-z0-9]+$/.test(prefijo.slice(PREFIJO_CLAVE.length))) return null
  if (secreto.length < LARGO_MINIMO_SECRETO) return null

  return { prefijo, secreto }
}

/** ¿La cabecera trae una clave de empresa (y no un token OAuth de satélite)? */
export function pareceClaveEmpresa(bruto: string | null | undefined): boolean {
  return (bruto ?? '').trim().startsWith(PREFIJO_CLAVE)
}

/**
 * Lo que se le enseña a la persona UNA vez, al crear la clave. Se compone aquí
 * para que las dos mitades no puedan separarse por accidente en la interfaz:
 * media clave es una clave que no funciona y una llamada de soporte.
 */
export function componerClave(prefijo: string, secreto: string): string {
  return `${prefijo}.${secreto}`
}
