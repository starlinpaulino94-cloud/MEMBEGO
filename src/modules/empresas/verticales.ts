import 'server-only'
import { sinEmpresa } from '@/lib/tenant'

/**
 * LOS VERTICALES QUE PUEDE ELEGIR EL SUPERADMIN — desde la tabla, no desde una
 * lista escrita a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ÚLTIMO TECHO DE LA FASE 7
 *
 * La Fase 1b convirtió los tipos de negocio en tabla y la Fase 7 añadió
 * `companies.tipoNegocioCodigo`, de modo que el vertical de una empresa puede
 * ser cualquier código de `tipos_negocio` —incluido uno que un manifiesto
 * acabe de crear— sin tocar código.
 *
 * Pero el formulario del superadmin seguía ofreciendo cinco `<SelectItem>`
 * escritos a mano. Se podía registrar el sistema de un hotel por manifiesto, y
 * luego no había forma de decirle a una empresa que era un hotel: había que
 * volver al script. La arquitectura estaba abierta y la puerta de la interfaz,
 * cerrada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY RESPALDO
 *
 * `tipos_negocio` puede no existir todavía en una base sin migrar. Si esta
 * consulta fallara sin red, el superadmin se quedaría sin poder crear ninguna
 * empresa — una regresión mucho peor que el techo que viene a quitar. Con el
 * respaldo, en el peor caso se ofrecen los de siempre.
 *
 * Es la misma decisión que ya tomó `registro.ts` con esta columna: sin ella,
 * «se resuelve como antes»; nunca «esto no funciona».
 */

export interface VerticalElegible {
  /** Código estable. Es el que se guarda y el que viaja en el manifiesto. */
  codigo: string
  nombre: string
}

/**
 * Lo que se ofrecía antes de que esto leyera la tabla. Solo se usa si la
 * consulta falla; con la tabla presente, manda la tabla.
 *
 * Los códigos son los valores legacy de `Company.type` para que una base sin
 * migrar siga clasificando igual que ayer.
 */
const RESPALDO: VerticalElegible[] = [
  { codigo: 'carwash', nombre: 'Car Wash' },
  { codigo: 'restaurante', nombre: 'Restaurante' },
  { codigo: 'gimnasio', nombre: 'Gimnasio' },
  { codigo: 'salon', nombre: 'Salón de Belleza' },
  { codigo: 'excursiones', nombre: 'Excursiones / Tours' },
  { codigo: 'otro', nombre: 'Otro' },
]

/**
 * Verticales activos, en el orden que declara la tabla (`orden`) — el mismo
 * campo cuyo comentario en el esquema dice, desde la Fase 1b, «orden de
 * presentación en los selectores del panel». Este es el selector.
 */
export async function verticalesElegibles(): Promise<VerticalElegible[]> {
  try {
    const filas = await sinEmpresa('superadmin: tipos de negocio para el selector', (tx) =>
      tx.tipoNegocio.findMany({
        where: { activo: true },
        select: { codigo: true, nombre: true },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      })
    )
    // Una tabla vacía no es una respuesta útil: dejaría el selector sin
    // opciones y sin forma de crear una empresa.
    return filas.length > 0 ? filas : RESPALDO
  } catch (e) {
    console.error('[verticales] no se pudo leer tipos_negocio, se usa el respaldo:', e)
    return RESPALDO
  }
}

/**
 * Valida que un código enviado por el formulario exista de verdad.
 *
 * El `<Select>` ya solo ofrece códigos válidos, pero un formulario se puede
 * enviar a mano. Sin esta comprobación, `tipoNegocioCodigo` aceptaría cualquier
 * cadena y la empresa quedaría apuntando a un vertical inexistente: no tendría
 * acceso a ningún sistema y nada diría por qué.
 */
export async function verticalValido(codigo: string | null | undefined): Promise<string | null> {
  const limpio = codigo?.trim()
  if (!limpio) return null
  const disponibles = await verticalesElegibles()
  return disponibles.some((v) => v.codigo === limpio) ? limpio : null
}
