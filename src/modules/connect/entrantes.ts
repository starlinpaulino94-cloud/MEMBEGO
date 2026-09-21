import 'server-only'
import { randomBytes } from 'node:crypto'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { hashearSecreto, secretoValido } from '@/modules/plataforma/credenciales'
import { dentroDelLimite } from '@/modules/connect/entitlements'
import { anotarConector } from '@/modules/connect/bitacora'
import {
  PREFIJO_ENTRANTE,
  componerToken,
  nombreDeEvento,
  partirToken,
  slugDeNombre,
} from '@/modules/connect/entrantesNucleo'

/**
 * WEBHOOKS ENTRANTES (hallazgo B-1): que algo de fuera avise hacia dentro.
 *
 * El hermano que faltaba de `webhooks.ts`. Aquel empuja eventos hacia la URL
 * que pone la empresa; éste recibe en una URL secreta lo que empuje su
 * herramienta, y lo mete en el bus como `entrante.<slug>`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ENTRA NO PUEDE HACERSE PASAR POR UN HECHO DEL NEGOCIO
 *
 * El evento SIEMPRE lleva el prefijo `entrante.` (ver `nombreDeEvento`), así
 * que un POST de fuera no puede inventar una visita ni una compra. Es la
 * decisión que sostiene todo lo demás: sin ella, una URL filtrada en la
 * configuración de una herramienta de terceros permitiría otorgar beneficios y
 * meter datos falsos en los satélites de otras empresas.
 */

/** Cuántas recepciones recientes se enseñan en el panel. */
export const MAX_RECEPCIONES = 20

export type ResultadoCrearEntrante =
  | { ok: true; id: string; url: string; evento: string }
  | { ok: false; motivo: 'limite_alcanzado' | 'nombre_repetido' }

/**
 * Crea un webhook entrante y devuelve su URL COMPLETA, una sola vez.
 *
 * `base` la pasa quien llama (`appUrl()`) en vez de leerla aquí: es el único
 * dueño de las URLs de la aplicación, y escribirla otra vez en este módulo
 * daría una URL que apunta al dominio equivocado el día que la app se mude.
 */
export async function crearEntrante(input: {
  companyId: string
  nombre: string
  base: string
  creadoPor?: string | null
}): Promise<ResultadoCrearEntrante> {
  const activos = await conEmpresa(input.companyId, (tx) =>
    tx.webhookEntrante.count({ where: { companyId: input.companyId } })
  )
  if (!(await dentroDelLimite(input.companyId, 'entrantes.max', activos))) {
    return { ok: false, motivo: 'limite_alcanzado' }
  }

  const nombre = input.nombre.trim().slice(0, 120)
  const slug = slugDeNombre(nombre)
  const prefijo = `${PREFIJO_ENTRANTE}${randomBytes(6).toString('hex')}`
  const secreto = randomBytes(32).toString('base64url')

  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.webhookEntrante.create({
      data: {
        companyId: input.companyId,
        nombre,
        slug,
        prefijo,
        secretoHash: hashearSecreto(secreto),
        creadoPor: input.creadoPor ?? null,
      },
      select: { id: true },
    })
  ).catch(() => null)

  // El choque del UNIQUE `[companyId, slug]` es el único error esperable aquí,
  // y tiene una explicación que la persona puede accionar: ya hay otro webhook
  // que se llama casi igual. Devolverlo como motivo propio evita el «no se pudo
  // crear» genérico, que obliga a adivinar.
  if (!fila) return { ok: false, motivo: 'nombre_repetido' }

  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: fila.id,
    evento: 'webhook_entrante.creado',
    // El prefijo SÍ (es público e identifica la fila); el secreto jamás.
    detalle: { prefijo, slug },
  })

  return {
    ok: true,
    id: fila.id,
    url: urlDeEntrante(input.base, componerToken(prefijo, secreto)),
    evento: nombreDeEvento(slug),
  }
}

/** La URL a la que la herramienta ajena hace POST. */
export function urlDeEntrante(base: string, token: string): string {
  return `${base.replace(/\/$/, '')}/api/connect/entrante/${token}`
}

/** Los webhooks entrantes de una empresa, para el panel. Sin secretos. */
export async function entrantesDeEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.webhookEntrante.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nombre: true,
        slug: true,
        prefijo: true,
        estado: true,
        recibidos: true,
        ultimoAt: true,
        createdAt: true,
      },
    })
  ).catch(() => [])
}

/** Pausa o reactiva. */
export async function cambiarEstadoEntrante(
  companyId: string,
  id: string,
  estado: 'ACTIVE' | 'PAUSED'
): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.webhookEntrante.updateMany({ where: { id, companyId }, data: { estado } })
  ).catch(anotarFallo('connect:entrante:estado', { id }))
  return { ok: (r?.count ?? 0) > 0 }
}

/**
 * Borra un webhook entrante. Su URL deja de valer en la siguiente llamada.
 *
 * Los eventos que ya emitió NO se tocan: son hechos que ocurrieron, y borrarlos
 * con el webhook dejaría huecos en el historial de las automatizaciones que los
 * procesaron.
 */
export async function eliminarEntrante(companyId: string, id: string): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.webhookEntrante.deleteMany({ where: { id, companyId } })
  ).catch(anotarFallo('connect:entrante:eliminar', { id }))

  if ((r?.count ?? 0) > 0) {
    await anotarConector({
      companyId,
      origen: 'CONEXION',
      origenId: id,
      evento: 'webhook_entrante.eliminado',
    })
  }
  return { ok: (r?.count ?? 0) > 0 }
}

/**
 * LO ÚLTIMO QUE NOS MANDARON por este webhook.
 *
 * Sale de `automation_events` y no de una tabla propia: lo recibido YA se
 * guarda ahí como evento, con su payload, su empresa y su hora. Una segunda
 * tabla con los mismos datos sería un sitio más que purgar y aislar, y dos
 * respuestas posibles a «qué nos mandaron el martes».
 *
 * Es la mitad del valor de esta pantalla: quien configura su herramienta
 * necesita ver el cuerpo que llegó para saber qué campos tiene antes de
 * construir nada encima. Es como funcionan las herramientas contra las que
 * esto se integra: mandas una prueba, miras la forma, y luego automatizas.
 */
export async function recepcionesDe(
  companyId: string,
  slug: string,
  limite = MAX_RECEPCIONES
): Promise<{ id: string; payload: unknown; occurredAt: Date }[]> {
  return conEmpresa(companyId, (tx) =>
    tx.domainEvent.findMany({
      where: { companyId, type: nombreDeEvento(slug) },
      orderBy: { occurredAt: 'desc' },
      take: limite,
      select: { id: true, payload: true, occurredAt: true },
    })
  ).catch(() => [])
}

export interface EntranteVivo {
  id: string
  companyId: string
  slug: string
  estado: string
}

/**
 * Resuelve el token de la URL. `null` por cualquier motivo: no se detalla cuál.
 *
 * `sinEmpresa` porque la empresa se descubre AQUÍ — es el resultado de
 * autenticar, no un dato previo. Es la misma razón por la que esto es seguro:
 * quien llama no elige de qué empresa habla, se lo dice su token.
 */
export async function resolverEntrante(token: string | null | undefined): Promise<EntranteVivo | null> {
  const partido = partirToken(token)
  if (!partido) return null

  try {
    const fila = await sinEmpresa(
      'connect: webhook entrante por su prefijo (la empresa se descubre al autenticar)',
      (tx) =>
        tx.webhookEntrante.findUnique({
          where: { prefijo: partido.prefijo },
          select: {
            id: true,
            companyId: true,
            slug: true,
            estado: true,
            secretoHash: true,
          },
        })
    )
    if (!fila) return null
    if (!secretoValido(partido.secreto, fila.secretoHash)) return null
    return { id: fila.id, companyId: fila.companyId, slug: fila.slug, estado: fila.estado }
  } catch (e) {
    console.error('[connect] no se pudo resolver el webhook entrante:', e)
    return null
  }
}

/**
 * Anota la recepción. Best-effort y SIN `await` en el camino de la petición:
 * un contador de telemetría no puede añadir latencia a cada aviso entrante ni
 * tumbarlo si falla. Mismo criterio que `anotarUsoClave`.
 */
export function anotarRecepcion(id: string, companyId: string): void {
  void conEmpresa(companyId, (tx) =>
    tx.webhookEntrante.update({
      where: { id },
      data: { recibidos: { increment: 1 }, ultimoAt: new Date() },
    })
  ).catch(anotarFallo('connect:entrante:contador', { id }))
}
