import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarConector } from '@/modules/connect/bitacora'
import { eliminarCredencial } from '@/modules/connect/credenciales'
import { puedeTransicionar, type EstadoConexion } from '@/modules/connect/nucleo'

export { puedeTransicionar } from '@/modules/connect/nucleo'
export type { EstadoConector, EstadoConexion } from '@/modules/connect/nucleo'

/**
 * REGISTRO de conectores y conexiones de Membego Connect.
 *
 * Mismo reparto que la plataforma de satélites (`modules/plataforma`):
 * el CATÁLOGO (`conectores`) es global y lo administra el superadmin; la
 * CONEXIÓN (`conexiones_empresa`) es de una empresa. Compatibilidad y
 * concesión son cosas distintas.
 *
 * Estas funciones NO comprueban sesión: son la capa de módulo, y la
 * autorización vive en las server actions / rutas que las llaman (igual que
 * `sistemasDeEmpresa`). Lo que SÍ garantizan es el aislamiento: toda consulta
 * de empresa va dentro de `conEmpresa`, y el catálogo global declara su
 * cross-tenant con `sinEmpresa` y motivo.
 */

/**
 * Catálogo para el panel de una empresa: SOLO conectores ACTIVE. Los DRAFT no
 * existen para nadie más que el superadmin — enseñar un conector que no
 * funciona es un interruptor pintado.
 */
export async function catalogoParaEmpresas() {
  return sinEmpresa('connect: catálogo global de conectores (sin datos de empresa)', (tx) =>
    tx.conector.findMany({
      where: { estado: 'ACTIVE' },
      select: {
        id: true,
        slug: true,
        nombre: true,
        descripcion: true,
        categoria: true,
        icono: true,
        docsUrl: true,
        authTipo: true,
      },
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
    })
  )
}

/** Catálogo completo, estados incluidos — para el panel del superadmin. */
export async function catalogoCompleto() {
  return sinEmpresa('connect: catálogo completo para superadmin', (tx) =>
    tx.conector.findMany({
      orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
      include: { _count: { select: { conexiones: true } } },
    })
  )
}

/** Las conexiones de una empresa, con su conector, para el panel. */
export async function conexionesDeEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.conexionEmpresa.findMany({
      where: { companyId },
      include: {
        conector: {
          select: { slug: true, nombre: true, categoria: true, icono: true, authTipo: true, estado: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  )
}

export type ResultadoCrearConexion =
  | { ok: true; conexionId: string; reutilizada: boolean }
  | { ok: false; motivo: 'conector_no_disponible' | 'ya_conectada' }

/**
 * Inicia el alta de una conexión (queda PENDING; la credencial llega después,
 * por el flujo OAuth de la Fase 5 o a mano). Reutiliza una fila DISCONNECTED
 * si existe — el unique por (empresa, conector) es la garantía de no duplicar.
 */
export async function crearConexion(input: {
  companyId: string
  conectorSlug: string
  creadoPor?: string
}): Promise<ResultadoCrearConexion> {
  const conector = await sinEmpresa('connect: resolver conector del catálogo global', (tx) =>
    tx.conector.findFirst({
      where: { slug: input.conectorSlug, estado: 'ACTIVE' },
      select: { id: true },
    })
  )
  if (!conector) return { ok: false, motivo: 'conector_no_disponible' }

  const existente = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { companyId: input.companyId, conectorId: conector.id },
      select: { id: true, estado: true },
    })
  )

  if (existente) {
    if (existente.estado !== 'DISCONNECTED') return { ok: false, motivo: 'ya_conectada' }
    await conEmpresa(input.companyId, (tx) =>
      tx.conexionEmpresa.update({
        where: { id: existente.id },
        data: { estado: 'PENDING', ultimoError: null, creadoPor: input.creadoPor ?? null },
      })
    )
    await anotarConector({
      companyId: input.companyId,
      origen: 'CONEXION',
      origenId: existente.id,
      evento: 'conexion.reiniciada',
    })
    return { ok: true, conexionId: existente.id, reutilizada: true }
  }

  const creada = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.create({
      data: {
        companyId: input.companyId,
        conectorId: conector.id,
        estado: 'PENDING',
        creadoPor: input.creadoPor ?? null,
      },
      select: { id: true },
    })
  )
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: creada.id,
    evento: 'conexion.creada',
    detalle: { conector: input.conectorSlug },
  })
  return { ok: true, conexionId: creada.id, reutilizada: false }
}

/**
 * Apaga una conexión Y BORRA sus credenciales. Desconectar sin borrar el
 * secreto dejaría un token vivo de un servicio que la empresa cree apagado.
 * La fila y su historial se conservan (apagar, no borrar).
 */
export async function desconectarConexion(input: {
  companyId: string
  conexionId: string
}): Promise<{ ok: boolean }> {
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { id: input.conexionId, companyId: input.companyId },
      select: { id: true, estado: true },
    })
  )
  if (!fila || fila.estado === 'DISCONNECTED') return { ok: false }

  for (const tipo of ['OAUTH_TOKENS', 'API_KEY', 'SECRETO'] as const) {
    await eliminarCredencial({ companyId: input.companyId, conexionId: fila.id, tipo })
  }
  await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.update({ where: { id: fila.id }, data: { estado: 'DISCONNECTED' } })
  )
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: fila.id,
    evento: 'conexion.desconectada',
  })
  return { ok: true }
}

/**
 * Anota el resultado de un uso real de la conexión (lo llamarán los
 * conectores de la Fase 6 tras cada llamada al proveedor). Mantiene la salud
 * observable sin abrir credenciales, y mueve el estado solo por transiciones
 * legales — un éxito no resucita una conexión DISCONNECTED.
 */
export async function anotarSalud(input: {
  companyId: string
  conexionId: string
  resultado: { ok: true } | { ok: false; error: string }
}): Promise<void> {
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { id: input.conexionId, companyId: input.companyId },
      select: { estado: true },
    })
  )
  if (!fila) return
  const estadoActual = fila.estado as EstadoConexion

  if (input.resultado.ok) {
    const data: { ultimoOkAt: Date; estado?: EstadoConexion } = { ultimoOkAt: new Date() }
    if (estadoActual !== 'CONNECTED' && puedeTransicionar(estadoActual, 'CONNECTED')) {
      data.estado = 'CONNECTED'
    }
    await conEmpresa(input.companyId, (tx) =>
      tx.conexionEmpresa.update({ where: { id: input.conexionId }, data })
    )
    return
  }

  const data: { ultimoErrorAt: Date; ultimoError: string; estado?: EstadoConexion } = {
    ultimoErrorAt: new Date(),
    ultimoError: input.resultado.error.slice(0, 300),
  }
  if (estadoActual !== 'ERROR' && puedeTransicionar(estadoActual, 'ERROR')) {
    data.estado = 'ERROR'
  }
  await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.update({ where: { id: input.conexionId }, data })
  )
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    nivel: 'WARN',
    evento: 'conexion.fallo',
    detalle: { error: input.resultado.error.slice(0, 300) },
  })
}
