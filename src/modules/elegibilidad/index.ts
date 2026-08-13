import 'server-only'

/**
 * Elegibilidad · MOTOR CON BASE DE DATOS (Fase 3).
 *
 * Compone los datos (empresa → categoría de negocio, vehículos del cliente,
 * planes con su precio por categoría) y delega TODA decisión en `decidir.ts`,
 * que es puro y está probado. Página de planes, checkout, API y admin deben
 * consumir esto — no reimplementar reglas (§9).
 *
 * Nadie lo consume todavía: se integra en las fases de UI (patrón de la casa
 * — el motor entra probado y las pantallas se conectan después).
 *
 * REGLA DE COMPATIBILIDAD: `requisitosPara` con USAR_MEMBRESIA o
 * RENOVAR_MEMBRESIA devuelve siempre "puede continuar" sin tocar la base —
 * las cuentas y membresías anteriores al rediseño funcionan tal cual.
 */

import { conEmpresa } from '@/lib/tenant'
import { capacidadesEfectivas, type CategoriaNegocio } from '@/modules/capacidades/catalogo'
import type { Tx } from '@/lib/tenant'
import {
  decidirPlan,
  requisitosParaAccion,
  type AccionElegibilidad,
  type DecisionPlan,
  type VehiculoInfo,
} from '@/modules/elegibilidad/decidir'
import { flujoRequiereVehiculo, type EvaluacionRequisitos } from '@/modules/onboarding/flujos'

export type { AccionElegibilidad, DecisionPlan, VehiculoInfo } from '@/modules/elegibilidad/decidir'

/**
 * Categoría de negocio efectiva de la empresa (tipo legacy + overrides).
 * Exportada para que las acciones que YA están dentro de su propia
 * transacción (p. ej. seleccionarPlan) compongan los mismos datos sin anidar
 * conEmpresa — las reglas siguen siendo las puras de decidir.ts.
 *
 * Devuelve la categoría EXPLÍCITA: null cuando el negocio no declaró de qué
 * tipo es. El motor de requisitos existe para cerrar puertas, y una puerta no
 * se cierra por un dato que nadie afirmó — un `type` vacío o inventado ("otro",
 * el valor que ofrece el propio formulario de registro) hacía que el cliente de
 * un restaurante tuviera que registrar un carro para ver los planes.
 */
export async function categoriaDeEmpresa(tx: Tx, companyId: string): Promise<CategoriaNegocio | null> {
  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { type: true, capacidades: true, tipoNegocioCodigo: true },
  })
  if (!company) return null
  return capacidadesEfectivas(company.type, company.capacidades, company.tipoNegocioCodigo)
    .categoriaExplicita
}

/** Vehículos del cliente en la forma plana que consume el motor puro. */
export async function vehiculosDe(tx: Tx, clienteId: string): Promise<VehiculoInfo[]> {
  const filas = await tx.vehiculo.findMany({
    where: { clienteId },
    select: {
      id: true,
      placaNormalizada: true,
      tipoVehiculoId: true,
      esPrincipal: true,
      createdAt: true,
      tipoVehiculo: { select: { nivelTarifario: true, activo: true } },
    },
    // El principal primero; a igualdad, el más reciente (el que registró para
    // esta compra suele ser el último).
    orderBy: [{ esPrincipal: 'desc' }, { createdAt: 'desc' }],
  })
  return filas.map((v) => ({
    id: v.id,
    placaNormalizada: v.placaNormalizada,
    // Una categoría desactivada por la empresa cuenta como "sin categoría":
    // el cliente deberá elegir una vigente antes de una compra nueva.
    tipoVehiculoId: v.tipoVehiculo?.activo ? v.tipoVehiculoId : null,
    nivelTarifario: v.tipoVehiculo?.activo ? v.tipoVehiculo.nivelTarifario : null,
  }))
}

/**
 * ¿Qué le falta al cliente para `accion` en esta empresa? (§15)
 *
 * `USAR_MEMBRESIA` / `RENOVAR_MEMBRESIA` responden sin consultar la base:
 * jamás se bloquean (regla de compatibilidad).
 */
export async function requisitosPara(args: {
  accion: AccionElegibilidad
  companyId: string
  clienteId: string
}): Promise<EvaluacionRequisitos> {
  const { accion, companyId, clienteId } = args
  if (accion !== 'COMPRAR_PLAN') {
    return requisitosParaAccion({ accion, categoria: null, vehiculos: [] })
  }
  return conEmpresa(companyId, async (tx) => {
    const categoria = await categoriaDeEmpresa(tx, companyId)
    const vehiculos = await vehiculosDe(tx, clienteId)
    return requisitosParaAccion({ accion, categoria, vehiculos })
  })
}

export interface PlanElegible {
  id: string
  nombre: string
  decision: DecisionPlan
  /** Ficha completa para la tarjeta: el motor es la ÚNICA consulta de planes
   *  de la página (la respuesta trae solo lo autorizado, §10). */
  esIlimitado: boolean
  descripcion: string | null
  lavadosIncluidos: number
  beneficios: string[]
  vigenciaDias: number
  condiciones: string | null
}

export interface ResultadoPlanes {
  requisitos: EvaluacionRequisitos
  /**
   * Vehículo usado para calcular precios (el pedido, o el principal). Null en
   * negocios sin vehículos o cuando faltan requisitos.
   */
  vehiculo: VehiculoInfo | null
  /** Vacío cuando faltan requisitos (§10: sin vehículo no se enseñan planes),
   *  salvo modo vitrina (ver `vitrinaSinRequisitos`). */
  planes: PlanElegible[]
  /** true = la lista viene en modo vitrina: precios base, compra bloqueada. */
  vitrina: boolean
  /**
   * Cuántos planes activos tiene la empresa, INDEPENDIENTE de los requisitos.
   *
   * Separa dos vacíos que la lista sola confunde: "no puedes verlos todavía" y
   * "aquí no hay nada que ver". Sin esta cuenta, una empresa sin un solo plan le
   * pedía al cliente que registrara su vehículo para poder enseñarle cero.
   */
  planesPublicados: number
  /** ¿Este negocio exige vehículo para comprar? La UI no lo menciona si es false. */
  requiereVehiculo: boolean
}

/**
 * Planes que el cliente puede ver y comprar, con su precio ya resuelto para
 * el vehículo elegido (§10). La consulta devuelve SOLO lo autorizado: si
 * faltan requisitos, la lista viaja vacía — el gating no es cosa de CSS.
 */
export async function planesElegibles(args: {
  companyId: string
  clienteId: string
  /** Vehículo elegido; ausente = el principal (o el más reciente). */
  vehiculoId?: string
  /**
   * REGLA DE COMPATIBILIDAD: true para clientes con una membresía previa en
   * la empresa. Si les faltan requisitos, en vez de ocultar los planes se
   * devuelven en VITRINA (precio base, compra bloqueada): quien ya es miembro
   * puede seguir viendo la oferta como siempre; solo la compra nueva exige el
   * vehículo. Los clientes nuevos (false) reciben el gating estricto (§10).
   */
  vitrinaSinRequisitos?: boolean
}): Promise<ResultadoPlanes> {
  const { companyId, clienteId, vehiculoId, vitrinaSinRequisitos = false } = args
  return conEmpresa(companyId, async (tx) => {
    const categoria = await categoriaDeEmpresa(tx, companyId)
    const vehiculos = await vehiculosDe(tx, clienteId)
    const requisitos = requisitosParaAccion({ accion: 'COMPRAR_PLAN', categoria, vehiculos })
    const requiereVehiculo = flujoRequiereVehiculo(categoria)
    // La cuenta va ANTES del gate: un negocio sin planes no tiene por qué
    // pedirle nada al cliente, y la página necesita distinguir los dos vacíos.
    const planesPublicados = await tx.plan.count({ where: { companyId, activo: true } })
    const enVitrina = !requisitos.canProceed && vitrinaSinRequisitos
    if (planesPublicados === 0 || (!requisitos.canProceed && !enVitrina)) {
      return {
        requisitos,
        vehiculo: null,
        planes: [],
        vitrina: false,
        planesPublicados,
        requiereVehiculo,
      }
    }

    // El vehículo de contexto solo existe en negocios con paso de vehículo.
    // `vehiculosDe` ya ordena principal-primero. Un vehiculoId ajeno (de otro
    // cliente) simplemente no aparece en la lista y cae al principal. En
    // vitrina no hay vehículo utilizable: precios base.
    const vehiculo =
      !enVitrina && vehiculos.length > 0
        ? (vehiculos.find((v) => v.id === vehiculoId) ?? vehiculos[0])
        : null

    const planes = await tx.plan.findMany({
      where: { companyId, activo: true },
      select: {
        id: true,
        nombre: true,
        precio: true,
        nivelTarifarioMax: true,
        esIlimitado: true,
        descripcion: true,
        lavadosIncluidos: true,
        beneficios: true,
        vigenciaDias: true,
        condiciones: true,
        preciosPorCategoria: vehiculo?.tipoVehiculoId
          ? {
              where: { tipoVehiculoId: vehiculo.tipoVehiculoId, activo: true },
              select: { precio: true },
            }
          : false,
      },
      orderBy: { precio: 'asc' },
    })

    return {
      requisitos,
      vehiculo,
      vitrina: enVitrina,
      planesPublicados,
      requiereVehiculo,
      planes: planes.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        esIlimitado: p.esIlimitado,
        descripcion: p.descripcion,
        lavadosIncluidos: p.lavadosIncluidos,
        beneficios: p.beneficios,
        vigenciaDias: p.vigenciaDias,
        condiciones: p.condiciones,
        decision: decidirPlan(
          {
            id: p.id,
            precioBase: Number(p.precio),
            precioCategoria:
              Array.isArray(p.preciosPorCategoria) && p.preciosPorCategoria[0]
                ? Number(p.preciosPorCategoria[0].precio)
                : null,
            nivelTarifarioMax: p.nivelTarifarioMax,
          },
          vehiculo
        ),
      })),
    }
  })
}
