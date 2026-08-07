import 'server-only'
import { conEmpresa, type Tx } from '@/lib/tenant'
import type { Prisma, SegmentoEstado } from '@prisma/client'
import {
  normalizarRaiz,
  nodoARaiz,
  resolverRadios,
  type Nodo,
  type SegmentoRaiz,
  esRaizVacia,
} from './arbol'

/**
 * SegmentoServicio (docs/GEOLOCALIZACION.md §10): CRUD de `SavedSegment` con su
 * árbol AND/OR/NOT.
 *
 * Guardrails (§10.3): todo vive dentro del `companyId` del admin (conEmpresa) y
 * los valores de cada condición se validan contra catálogos reales (ciudad,
 * sector, tipo de vehículo) y contra las sucursales propias (radio). No hay
 * valores inventados.
 */

export interface GuardarSegmentoInput {
  nombre: string
  descripcion?: string | null
  raiz: SegmentoRaiz
}

const LIMITE_NOMBRE = 80
const LIMITE_DESCRIPCION = 300

/**
 * Valida que los valores de las condiciones existan en los catálogos reales y
 * que los radios apunten a sucursales propias con ubicación verificada.
 * NO resuelve el árbol: los radios se recalculan al estimar (docs §24).
 */
async function validarValores(tx: Tx, companyId: string, nodo: Nodo): Promise<void> {
  const idsCiudad = new Set<string>()
  const idsSector = new Set<string>()
  const idsTipoVehiculo = new Set<string>()
  const idsSucursal = new Set<string>()

  recorrer(nodo, (campo, valor) => {
    const lista = Array.isArray(valor) ? valor : [valor]
    if (campo === 'cliente.cityId') lista.forEach((v) => typeof v === 'string' && idsCiudad.add(v))
    if (campo === 'cliente.sectorId') lista.forEach((v) => typeof v === 'string' && idsSector.add(v))
    if (campo === 'cliente.vehiculo.tipoVehiculoId') {
      lista.forEach((v) => typeof v === 'string' && idsTipoVehiculo.add(v))
    }
    if (campo === 'cliente.distanciaSucursalKm') {
      const r = valor as { sucursalId?: string }
      if (r?.sucursalId) idsSucursal.add(r.sucursalId)
    }
  })

  if (idsCiudad.size > 0) {
    const n = await tx.city.count({ where: { id: { in: [...idsCiudad] } } })
    if (n !== idsCiudad.size) throw new Error('Alguna ciudad elegida no existe en el catálogo.')
  }
  if (idsSector.size > 0) {
    const n = await tx.sector.count({ where: { id: { in: [...idsSector] } } })
    if (n !== idsSector.size) throw new Error('Algún sector elegido no existe en el catálogo.')
  }
    if (idsTipoVehiculo.size > 0) {
    const n = await tx.tipoVehiculo.count({
      where: { id: { in: [...idsTipoVehiculo] }, companyId },
    })
    if (n !== idsTipoVehiculo.size) {
      throw new Error('Algún tipo de vehículo no existe en esta empresa.')
    }
  }

  if (idsSucursal.size > 0) {
    const sucursales = await tx.sucursal.findMany({
      where: { id: { in: [...idsSucursal] }, companyId },
      select: { id: true, latitud: true, longitud: true, ubicacionVerificada: true },
    })
    if (sucursales.length !== idsSucursal.size) {
      throw new Error('Alguna sucursal del radio no existe en esta empresa.')
    }
    const mapa = new Map<string, { latitud: number; longitud: number }>()
    for (const s of sucursales) {
      if (!s.ubicacionVerificada || s.latitud == null || s.longitud == null) {
        throw new Error(
          'Un radio de campaña necesita una sucursal con ubicación verificada. Revisa su geolocalización.'
        )
      }
      mapa.set(s.id, { latitud: s.latitud, longitud: s.longitud })
    }
    // Solo para validar que todo radio se pueda resolver hoy; se descarta.
    resolverRadios(nodo, mapa)
  }
}

function recorrer(
  nodo: Nodo,
  fn: (campo: string, valor: unknown) => void
): void {
  if (nodo.tipo === 'condicion') {
    fn(nodo.cond.campo, nodo.cond.valor)
    return
  }
  for (const hijo of nodo.hijos) recorrer(hijo, fn)
}

export const SegmentoServicio = {
  async crear(companyId: string, createdById: string, input: GuardarSegmentoInput): Promise<string> {
    const nombre = input.nombre.trim().slice(0, LIMITE_NOMBRE)
    if (!nombre) throw new Error('El nombre del segmento es obligatorio.')
    const descripcion = (input.descripcion ?? '').trim().slice(0, LIMITE_DESCRIPCION) || null
    const raiz = normalizarRaiz(input.raiz)

    return conEmpresa(companyId, async (tx) => {
      await validarValores(tx, companyId, raiz)
      const segmento = await tx.savedSegment.create({
        data: { companyId, name: nombre, description: descripcion, createdById },
      })
      await persisitirArbol(tx, segmento.id, raiz)
      return segmento.id
    })
  },

  async actualizar(
    companyId: string,
    segmentoId: string,
    input: GuardarSegmentoInput
  ): Promise<void> {
    const nombre = input.nombre.trim().slice(0, LIMITE_NOMBRE)
    if (!nombre) throw new Error('El nombre del segmento es obligatorio.')
    const descripcion = (input.descripcion ?? '').trim().slice(0, LIMITE_DESCRIPCION) || null
    const raiz = normalizarRaiz(input.raiz)

    await conEmpresa(companyId, async (tx) => {
      const existente = await tx.savedSegment.findFirst({
        where: { id: segmentoId, companyId },
        select: { id: true },
      })
      if (!existente) throw new Error('El segmento no existe o no pertenece a esta empresa.')

      await validarValores(tx, companyId, raiz)

      await tx.savedSegment.update({
        where: { id: segmentoId },
        data: { name: nombre, description: descripcion },
      })
      await reemplazarArbol(tx, segmentoId, raiz)
    })
  },

  async activar(companyId: string, segmentoId: string): Promise<void> {
    await conEmpresa(companyId, (tx) =>
      tx.savedSegment.updateMany({
        where: { id: segmentoId, companyId },
        data: { estado: 'ACTIVO' },
      })
    )
  },

  async archivar(companyId: string, segmentoId: string): Promise<void> {
    await conEmpresa(companyId, (tx) =>
      tx.savedSegment.updateMany({
        where: { id: segmentoId, companyId },
        data: { estado: 'ARCHIVADO' },
      })
    )
  },

  async eliminar(companyId: string, segmentoId: string): Promise<void> {
    await conEmpresa(companyId, async (tx) => {
      const enUso = await tx.campanaDirigida.count({
        where: { segmentId: segmentoId, companyId },
      })
      if (enUso > 0) {
        throw new Error(
          'Este segmento lo usan campañas; archívalo en vez de borrarlo.'
        )
      }
      await tx.savedSegment.deleteMany({ where: { id: segmentoId, companyId } })
    })
  },

  async listar(companyId: string): Promise<
    {
      id: string
      nombre: string
      estado: SegmentoEstado
      ultimaAudienciaEstimada: number | null
      ultimaEvaluacionAt: Date | null
      updatedAt: Date
      campanas: number
    }[]
  > {
    return conEmpresa(companyId, async (tx) => {
      const segmentos = await tx.savedSegment.findMany({
        where: { companyId },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { campaigns: true } } },
      })
      return segmentos.map((s) => ({
        id: s.id,
        nombre: s.name,
        estado: s.estado,
        ultimaAudienciaEstimada: s.ultimaAudienciaEstimada,
        ultimaEvaluacionAt: s.ultimaEvaluacionAt,
        updatedAt: s.updatedAt,
        campanas: s._count.campaigns,
      }))
    })
  },

  /** Segmento completo para el editor: incluye el árbol serializado. */
  async obtener(companyId: string, segmentoId: string): Promise<{
    id: string
    nombre: string
    descripcion: string | null
    estado: SegmentoEstado
    ultimaAudienciaEstimada: number | null
    raiz: SegmentoRaiz
  } | null> {
    return conEmpresa(companyId, async (tx) => {
      const segmento = await tx.savedSegment.findFirst({
        where: { id: segmentoId, companyId },
      })
      if (!segmento) return null
      const nodo = await leerArbol(tx, segmentoId)
      return {
        id: segmento.id,
        nombre: segmento.name,
        descripcion: segmento.description,
        estado: segmento.estado,
        ultimaAudienciaEstimada: segmento.ultimaAudienciaEstimada,
        raiz: nodoARaiz(nodo),
      }
    })
  },

  /** AST del segmento (para el estimador y las campañas). null si no existe. */
  async arbol(companyId: string, segmentoId: string): Promise<Nodo | null> {
    return conEmpresa(companyId, async (tx) => {
      const segmento = await tx.savedSegment.findFirst({
        where: { id: segmentoId, companyId },
        select: { id: true },
      })
      if (!segmento) return null
      return leerArbol(tx, segmentoId)
    })
  },

  async esVacio(companyId: string, segmentoId: string): Promise<boolean> {
    const nodo = await SegmentoServicio.arbol(companyId, segmentoId)
    return nodo === null || esRaizVacia(nodoARaiz(nodo))
  },
}

async function persisitirArbol(tx: Tx, segmentId: string, nodo: Nodo): Promise<void> {
  if (nodo.tipo === 'condicion') {
    await crearCondicion(tx, segmentId, nodo.cond.campo, nodo.cond.operador, nodo.cond.valor, null)
    return
  }
  const grupo = await tx.segmentConditionGroup.create({
    data: { segmentId, parentId: null, operator: nodo.operador },
  })
  for (const hijo of nodo.hijos) {
    await persisitirHijo(tx, segmentId, hijo, grupo.id)
  }
}

async function persisitirHijo(tx: Tx, segmentId: string, nodo: Nodo, parentId: string): Promise<void> {
  if (nodo.tipo === 'condicion') {
    await crearCondicion(tx, segmentId, nodo.cond.campo, nodo.cond.operador, nodo.cond.valor, parentId)
    return
  }
  const grupo = await tx.segmentConditionGroup.create({
    data: { segmentId, parentId, operator: nodo.operador },
  })
  for (const hijo of nodo.hijos) {
    await persisitirHijo(tx, segmentId, hijo, grupo.id)
  }
}

function crearCondicion(
  tx: Tx,
  segmentId: string,
  campo: string,
  operador: string,
  valor: unknown,
  groupId: string | null
): Promise<unknown> {
  return tx.segmentCondition.create({
    data: {
      segmentId,
      groupId,
      campo,
      operador,
      valor: valor as Prisma.InputJsonValue,
      orden: 0,
    },
  })
}

async function reemplazarArbol(tx: Tx, segmentId: string, nodo: Nodo): Promise<void> {
  await tx.segmentConditionGroup.deleteMany({ where: { segmentId } })
  await tx.segmentCondition.deleteMany({ where: { segmentId, groupId: null } })
  await persisitirArbol(tx, segmentId, nodo)
}

async function leerArbol(tx: Tx, segmentId: string): Promise<Nodo> {
  const grupos = await tx.segmentConditionGroup.findMany({ where: { segmentId } })
  const condiciones = await tx.segmentCondition.findMany({
    where: { segmentId },
    orderBy: { orden: 'asc' },
  })
  const raices = grupos.filter((g) => g.parentId === null)
  if (raices.length === 0) {
    // Segmento sin condiciones: raíz vacía.
    return { tipo: 'grupo', operador: 'AND', hijos: [] }
  }
  // Por simplicidad el CRUD persiste UNA raíz; si hay varias (import/legado),
  // se unen bajo un AND.
  if (raices.length === 1) {
    return nodoDesdeGrupo(grupos, condiciones, raices[0].id)
  }
  return {
    tipo: 'grupo',
    operador: 'AND',
    hijos: raices.map((r) => nodoDesdeGrupo(grupos, condiciones, r.id)),
  }
}

function nodoDesdeGrupo(
  grupos: { id: string; parentId: string | null; operator: string }[],
  condiciones: {
    id: string
    groupId: string | null
    campo: string
    operador: string
    valor: Prisma.JsonValue
  }[],
  grupoId: string
): Nodo {
  const grupo = grupos.find((g) => g.id === grupoId)!
  const condicionesDirectas = condiciones.filter((c) => c.groupId === grupoId)
  const hijosGrupo = grupos.filter((g) => g.parentId === grupoId)
  const hijos: Nodo[] = [
    ...condicionesDirectas.map((c) => ({
      tipo: 'condicion' as const,
      cond: {
        campo: c.campo,
        operador: c.operador as 'eq',
        valor: c.valor,
      },
    })),
    ...hijosGrupo.map((g) => nodoDesdeGrupo(grupos, condiciones, g.id)),
  ]
  return { tipo: 'grupo', operador: grupo.operator as 'AND' | 'OR' | 'NOT', hijos }
}

/**
 * AST de un segmento dentro de una transacción YA abierta (el fan-out de la
 * cola la abre con `sinEmpresa`). No verifica la empresa: el llamador ya está
 * en un contexto correcto.
 */
export async function leerArbolTx(tx: Tx, segmentId: string): Promise<Nodo> {
  const segmento = await tx.savedSegment.findFirst({
    where: { id: segmentId },
    select: { id: true },
  })
  if (!segmento) throw new Error('El segmento de la campaña no existe.')
  return leerArbol(tx, segmentId)
}
