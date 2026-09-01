import 'server-only'
import { randomBytes } from 'node:crypto'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { hashearSecreto, secretoValido } from '@/modules/plataforma/credenciales'
import { PREFIJO_CLAVE, componerClave, partirClave } from '@/modules/connect/clavesApiNucleo'
import { dentroDelLimite } from '@/modules/connect/entitlements'
import { anotarConector } from '@/modules/connect/bitacora'

/**
 * CLAVES DE API POR EMPRESA (Membego Connect · Fase 3, decisión D4).
 *
 * El SEGUNDO principal de `/api/platform/v1`. La diferencia con la credencial
 * de un satélite no es técnica, es de alcance:
 *
 *   credencial de sistema   un satélite que atiende a MUCHAS empresas
 *   clave de empresa        un tercero que habla por UNA empresa y solo esa
 *
 * Por eso la empresa NO viaja como parámetro que haya que autorizar: viene
 * atada a la clave. Un tercero con la clave del car wash no puede ni nombrar
 * otra empresa — no hay comprobación que saltarse porque no hay elección.
 *
 * Del secreto solo se guarda su hash scrypt, con el mismo helper que las
 * credenciales de satélite. Se enseña UNA vez al crearla; si se pierde, se rota.
 */

export interface ClaveCreada {
  id: string
  /** La clave COMPLETA. Es la única vez en su vida que existe en claro. */
  clave: string
  prefijo: string
}

export type ResultadoCrearClave =
  | { ok: true; creada: ClaveCreada }
  | { ok: false; motivo: 'limite_alcanzado' }

/**
 * Crea una clave para una empresa. El límite sale de los entitlements
 * (`api_keys.max`), cuyo default es CERO: las claves de API se conceden empresa
 * a empresa, no se reparten con el alta.
 */
export async function crearClaveApi(input: {
  companyId: string
  nombre: string
  scopes: string[]
  creadoPor?: string | null
  expiresAt?: Date | null
}): Promise<ResultadoCrearClave> {
  const activas = await conEmpresa(input.companyId, (tx) =>
    tx.claveApiEmpresa.count({ where: { companyId: input.companyId, estado: 'ACTIVE' } })
  )
  if (!(await dentroDelLimite(input.companyId, 'api_keys.max', activas))) {
    return { ok: false, motivo: 'limite_alcanzado' }
  }

  const prefijo = `${PREFIJO_CLAVE}${randomBytes(6).toString('hex')}`
  const secreto = randomBytes(32).toString('base64url')

  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.claveApiEmpresa.create({
      data: {
        companyId: input.companyId,
        nombre: input.nombre.slice(0, 120),
        prefijo,
        secretoHash: hashearSecreto(secreto),
        scopes: input.scopes,
        creadoPor: input.creadoPor ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      select: { id: true },
    })
  )

  await anotarConector({
    companyId: input.companyId,
    origen: 'CLAVE_API',
    origenId: fila.id,
    evento: 'clave_api.creada',
    // El prefijo SÍ (es público e identifica la clave en el panel); el secreto
    // jamás — ni aquí ni en ningún registro.
    detalle: { prefijo, scopes: input.scopes.length },
  })

  return { ok: true, creada: { id: fila.id, clave: componerClave(prefijo, secreto), prefijo } }
}

/** Revoca una clave. Se comprueba en cada petición: cierra la puerta ya. */
export async function revocarClaveApi(companyId: string, id: string): Promise<{ ok: boolean }> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.claveApiEmpresa.updateMany({
      where: { id, companyId, estado: 'ACTIVE' },
      data: { estado: 'REVOKED' },
    })
  )
  if (r.count > 0) {
    await anotarConector({
      companyId,
      origen: 'CLAVE_API',
      origenId: id,
      evento: 'clave_api.revocada',
    })
  }
  return { ok: r.count > 0 }
}

/** Las claves de una empresa, para el panel. Nunca incluye secretos. */
export async function clavesDeEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.claveApiEmpresa.findMany({
      where: { companyId },
      select: {
        id: true,
        nombre: true,
        prefijo: true,
        scopes: true,
        estado: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  )
}

/** Clave viva y su empresa. `null` para cualquier motivo: no se detalla cuál. */
export interface ClaveViva {
  id: string
  prefijo: string
  companyId: string
  scopes: string[]
}

/**
 * Resuelve la clave presentada. Devuelve `null` si no existe, si está revocada,
 * si caducó o si el secreto no cuadra.
 *
 * NO se distingue entre esos casos hacia fuera: decirle a quien prueba «esa
 * clave existe pero el secreto está mal» le confirma la mitad del trabajo.
 *
 * `sinEmpresa` porque la empresa se descubre AQUÍ — es el resultado de
 * autenticar, no un dato previo. Ese es justo el motivo por el que la clave es
 * segura: la empresa no la elige quien llama.
 */
export async function resolverClaveApi(presentada: string | null | undefined): Promise<ClaveViva | null> {
  const partida = partirClave(presentada)
  if (!partida) return null

  try {
    const fila = await sinEmpresa(
      'connect: clave de API por su prefijo (la empresa se descubre al autenticar)',
      (tx) =>
        tx.claveApiEmpresa.findUnique({
          where: { prefijo: partida.prefijo },
          select: {
            id: true,
            prefijo: true,
            companyId: true,
            secretoHash: true,
            scopes: true,
            estado: true,
            expiresAt: true,
          },
        })
    )
    if (!fila || fila.estado !== 'ACTIVE') return null
    if (fila.expiresAt && fila.expiresAt.getTime() <= Date.now()) return null
    if (!secretoValido(partida.secreto, fila.secretoHash)) return null

    return {
      id: fila.id,
      prefijo: fila.prefijo,
      companyId: fila.companyId,
      scopes: fila.scopes,
    }
  } catch (e) {
    console.error('[connect] no se pudo resolver la clave de API:', e)
    return null
  }
}

/**
 * Sello de último uso. Best-effort y SIN await en el camino de la petición:
 * una escritura de telemetría no puede añadir latencia a cada llamada de la
 * API, ni tumbarla si falla.
 */
export function anotarUsoClave(id: string, companyId: string): void {
  void conEmpresa(companyId, (tx) =>
    tx.claveApiEmpresa.update({ where: { id }, data: { lastUsedAt: new Date() } })
  ).catch(anotarFallo('connect:clave-api:ultimo-uso', { id }))
}
