'use server'

import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { puedeFuncion, requireSection } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import {
  alternarCifra,
  leerPreferencias,
  moverCifra,
  PREFERENCIAS_VACIAS,
  type PreferenciasReportes,
} from '@/modules/reportes/preferencias'

/**
 * GUARDAR QUÉ CIFRAS VE CADA QUIEN.
 *
 * La preferencia es de la PERSONA y vive en su fila de `users`, junto a
 * `permisos`, que es el mismo caso: un ajuste pequeño que siempre se lee con
 * el usuario. Por eso `sinEmpresa`: la fila del usuario no pertenece a ninguna
 * empresa, y la razón queda escrita en la llamada para la bitácora.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EL PERMISO SE COMPRUEBA AQUÍ, NO EN EL BOTÓN
 *
 * Una server action se despacha por su id desde cualquier ruta que el usuario
 * tenga permitida: esconder el formulario no la protege. Así que cada acción
 * vuelve a preguntar por `reportes/ver` —quien no puede abrir los reportes no
 * personaliza su resumen— y por `ver_financieros`, que es lo que decide si las
 * cifras de dinero entran siquiera en la lista.
 *
 * Y el cálculo no se hace con lo que llega del formulario: llega una clave y
 * una dirección, y el sobre nuevo lo arma el núcleo puro a partir del sobre
 * guardado. Un formulario manipulado no puede escribir una lista arbitraria.
 */

/**
 * El sobre de quien está mirando, y si la columna está disponible.
 *
 * Nunca lanza. `disponible: false` cubre el hueco que `docs/MIGRACIONES.md`
 * describe como el fallo recurrente de este proyecto: las migraciones se
 * aplican A MANO en Supabase, así que entre el despliegue del código y el
 * momento en que alguien pega el SQL, `preferenciasReportes` no existe.
 *
 * La LECTURA ya se caía a «de fábrica» —eso solo— pero la escritura habría
 * reventado con un P2022 al primer clic. Así que en esa ventana el panel de
 * personalización ni se ofrece: es mejor que la opción no esté a que esté y
 * falle. Cuando la migración corre, aparece sola.
 */
export async function misPreferenciasReportes(): Promise<{
  pref: PreferenciasReportes
  disponible: boolean
}> {
  const user = await getUser()
  const id = user?.metadata?.dbUserId
  if (!id) return { pref: PREFERENCIAS_VACIAS, disponible: false }

  const fila = await sinEmpresa('reportes: preferencias del usuario', (tx) =>
    tx.user
      .findUnique({ where: { id }, select: { preferenciasReportes: true } })
      .catch(() => FALLO)
  )
  if (typeof fila === 'symbol') return { pref: PREFERENCIAS_VACIAS, disponible: false }
  return { pref: leerPreferencias(fila?.preferenciasReportes), disponible: true }
}

/** Centinela: distingue «la consulta falló» de «el usuario no tiene nada». */
const FALLO = Symbol('preferencias-no-disponibles')

async function guardar(
  cambiar: (
    pref: PreferenciasReportes,
    opciones: { verFinancieros: boolean }
  ) => PreferenciasReportes
): Promise<void> {
  if (!(await requireSection('reportes', 'ver'))) return
  const user = await getUser()
  const id = user?.metadata?.dbUserId
  if (!id) return

  const verFinancieros = await puedeFuncion('reportes', 'ver_financieros')
  const { pref: actual, disponible } = await misPreferenciasReportes()
  // Sin columna no hay dónde guardar. No se intenta y no se rompe: el panel
  // tampoco se está pintando, así que esto solo cubre una acción despachada
  // por su id desde fuera.
  if (!disponible) return
  const nuevo = cambiar(actual, { verFinancieros })
  // Sin cambio, sin escritura: pulsar «subir» en la primera no tiene por qué
  // tocar la base ni invalidar la caché de la pantalla.
  if (JSON.stringify(nuevo) === JSON.stringify(actual)) return

  await sinEmpresa('reportes: guardar preferencias del usuario', (tx) =>
    // El `as` es solo para el tipo de columna JSON de Prisma, que exige una
    // firma de índice. El objeto lo arma el núcleo puro, no el formulario.
    tx.user.update({
      where: { id },
      data: { preferenciasReportes: { ...nuevo } as unknown as Prisma.InputJsonObject },
    })
  )
  revalidatePath('/admin/reportes')
}

export async function alternarCifraResumen(datos: FormData): Promise<void> {
  const clave = String(datos.get('clave') ?? '')
  const visible = String(datos.get('visible') ?? '') === '1'
  await guardar((pref, opciones) => alternarCifra(pref, clave, visible, opciones))
}

export async function moverCifraResumen(datos: FormData): Promise<void> {
  const clave = String(datos.get('clave') ?? '')
  const pedida = String(datos.get('direccion') ?? '')
  if (pedida !== 'arriba' && pedida !== 'abajo') return
  await guardar((pref, opciones) => moverCifra(pref, clave, pedida, opciones))
}

/** Volver a lo de fábrica. Una personalización sin vuelta atrás es una trampa. */
export async function restablecerCifrasResumen(): Promise<void> {
  await guardar(() => PREFERENCIAS_VACIAS)
}
