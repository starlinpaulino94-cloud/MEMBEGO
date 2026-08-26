import 'server-only'

import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { membresiaVigente, membresiaCaducada } from '@/modules/membresia/vigencia'
import type { FiltroMembresias } from './filtros'

/**
 * EL PUESTO DE MANDO DE MEMBRESÍAS, LEÍDO DE UNA VEZ.
 *
 * Lo que cambia respecto a la consulta suelta que tenía la página:
 *
 *  1. CADA FILA DICE SI ESTÁ VIGENTE. La tabla pintaba `estado` en crudo, y el
 *     propio sistema tiene documentado que `ACTIVA` no significa vigente:
 *     significa «nadie la ha tocado desde que se activó». Una membresía vencida
 *     en marzo salía como «Activa» en agosto mientras el escáner la rechazaba —
 *     y ésta es la pantalla a la que se viene a averiguar por qué la rechazó.
 *
 *  2. LAS DE PRÁCTICA SE PUEDEN SEPARAR. Sin esto, los datos de un
 *     entrenamiento parecen ventas en la pantalla que cruza todas las empresas.
 *
 *  3. HAY CIFRAS ARRIBA. «Cuántas esperan validación» es lo único accionable de
 *     esta pantalla y había que deducirlo filtrando a ciegas.
 */

export interface MembresiaFila {
  id: string
  estado: string
  /** ACTIVA *y* sin vencer: la misma regla que aplica el escáner del mostrador. */
  vigente: boolean
  fechaInicio: Date | null
  fechaVencimiento: Date | null
  usosRestantes: number
  clienteId: string
  clienteNombre: string
  clienteEmail: string
  empresaNombre: string
  empresaEsDemo: boolean
  planNombre: string
  planPrecio: number
  planEsIlimitado: boolean
  /** Lavados que el plan repone al renovar. `null` si es ilimitado. */
  planLavadosIncluidos: number | null
  planVigenciaDias: number
  /** Regalos vivos: la renovación los conserva, no los repone. */
  usosRegaloRestantes: number
  /**
   * HISTORIAL, para saber si esta membresía se puede BORRAR.
   *
   * Se traen los tres conteos con la lista y no al pulsar el botón: la
   * decisión de si el borrado se OFRECE se toma al pintar, y consultarlos
   * después obligaría a un viaje extra por fila para responder algo que ya se
   * podía saber. `_count` lo resuelve en la misma consulta.
   */
  visitas: number
  comprobantes: number
  pagosConfirmados: number
}

export interface ResumenMembresias {
  /** Comprobantes esperando validación: lo único que exige actuar hoy. */
  porValidar: number
  /** Activas y sin vencer. */
  vigentes: number
  /** Vigentes que caducan en los próximos 7 días. */
  vencenPronto: number
  /**
   * Dicen ACTIVA en la base pero su fecha ya pasó.
   *
   * Debería ser 0 siempre: `vencerMembresias()` corre a diario. Si no lo es,
   * el job no está corriendo — y esta cifra es el único sitio donde eso se ve.
   */
  vencidasSinMarcar: number
}

export interface ListadoMembresias {
  filas: MembresiaFila[]
  total: number
  resumen: ResumenMembresias
  empresas: { id: string; name: string; esDemo: boolean }[]
}

/** El `where` del ámbito: qué empresas entran. */
function whereAmbito(f: FiltroMembresias): Prisma.MembershipWhereInput[] {
  if (f.ambito === 'todas') return []
  return [{ cliente: { company: { esDemo: f.ambito === 'practica' } } }]
}

/**
 * El `where` del filtro.
 *
 * Todo dentro de un `AND` explícito: `membresiaVigente()` trae su propio `OR`
 * (una membresía sin fecha de vencimiento es perpetua y cuenta) y la búsqueda
 * trae otro. Sueltos en la raíz, el segundo pisaría al primero sin error —
 * la pantalla enseñaría de más y nadie lo notaría.
 */
export function whereMembresias(f: FiltroMembresias, ahora: Date): Prisma.MembershipWhereInput {
  const and: Prisma.MembershipWhereInput[] = [...whereAmbito(f)]

  if (f.estado === 'vigentes') and.push(membresiaVigente(ahora))
  else if (f.estado === 'vencidas-sin-marcar') and.push(membresiaCaducada(ahora))
  else if (f.estado !== 'todos') and.push({ estado: f.estado })

  if (f.empresa) and.push({ cliente: { companyId: f.empresa } })

  if (f.q) {
    and.push({
      cliente: {
        OR: [
          { nombre: { contains: f.q, mode: 'insensitive' } },
          { email: { contains: f.q, mode: 'insensitive' } },
        ],
      },
    })
  }

  return and.length > 0 ? { AND: and } : {}
}

export async function listarMembresias(
  f: FiltroMembresias,
  paginacion: { saltar: number; tomar: number },
  opciones: { todo?: boolean } = {}
): Promise<ListadoMembresias> {
  // Un solo «ahora» para el filtro, las cifras y la marca de vigencia de cada
  // fila. Leerlo por separado daría instantes distintos dentro de la misma
  // pantalla, y con ello una fila «vigente» que no cuadra con el total.
  const ahora = new Date()
  const where = whereMembresias(f, ahora)
  const enSieteDias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Las cifras de arriba son del ÁMBITO, no del filtro: son el trabajo
  // pendiente. Si menguaran al filtrar dejarían de servir para decidir qué
  // mirar — que es justo para lo que están.
  const ambito: Prisma.MembershipWhereInput =
    whereAmbito(f).length > 0 ? { AND: whereAmbito(f) } : {}

  return sinEmpresa(
    'membresías globales: el superadmin las revisa a través de todas las empresas',
    async (tx) => {
      const [datos, total, porValidar, vigentes, vencenPronto, vencidasSinMarcar, empresas] =
        await Promise.all([
          tx.membership.findMany({
            where,
            select: {
              id: true,
              estado: true,
              fechaInicio: true,
              fechaVencimiento: true,
              lavadosRestantes: true,
              // Los de regalo viajan aparte: la pantalla de renovación tiene
              // que poder decir cuáles se reponen y cuáles se conservan.
              lavadosBonoRestantes: true,
              clienteId: true,
              plan: {
                select: {
                  nombre: true,
                  precio: true,
                  esIlimitado: true,
                  lavadosIncluidos: true,
                  vigenciaDias: true,
                },
              },
              cliente: {
                select: {
                  nombre: true,
                  email: true,
                  company: { select: { name: true, esDemo: true } },
                },
              },
              _count: { select: { visits: true, comprobantes: true } },
              // Solo los pagos APROBADOS. Un intento fallido no es historia
              // financiera —es el ruido que dejan las pruebas— y contarlo
              // bloquearía el borrado justo en el caso para el que existe.
              pagoIntentos: { where: { estado: 'APROBADO' }, select: { id: true } },
            },
            orderBy: { createdAt: 'desc' },
            ...(opciones.todo ? {} : { skip: paginacion.saltar, take: paginacion.tomar }),
          }),
          tx.membership.count({ where }),
          tx.membership.count({ where: { AND: [ambito, { estado: 'PENDIENTE_PAGO' }] } }),
          tx.membership.count({ where: { AND: [ambito, membresiaVigente(ahora)] } }),
          tx.membership.count({
            where: {
              AND: [
                ambito,
                membresiaVigente(ahora),
                { fechaVencimiento: { lt: enSieteDias } },
              ],
            },
          }),
          tx.membership.count({ where: { AND: [ambito, membresiaCaducada(ahora)] } }),
          // TODAS las empresas, activas o no. El desplegable listaba solo las
          // activas mientras la tabla sí enseñaba sus membresías: había filas
          // que no se podían acotar por su empresa.
          tx.company.findMany({
            orderBy: { name: 'asc' },
            select: { id: true, name: true, esDemo: true },
          }),
        ])

      const filas: MembresiaFila[] = datos.map((m) => ({
        id: m.id,
        estado: m.estado,
        // La misma regla que `membresiaVigente()`, aplicada fila a fila: activa
        // Y (sin fecha O con fecha futura). Sin fecha = perpetua, y cuenta.
        vigente:
          m.estado === 'ACTIVA' &&
          (m.fechaVencimiento == null || m.fechaVencimiento >= ahora),
        fechaInicio: m.fechaInicio,
        fechaVencimiento: m.fechaVencimiento,
        usosRestantes: m.lavadosRestantes,
        clienteId: m.clienteId,
        clienteNombre: m.cliente.nombre,
        clienteEmail: m.cliente.email,
        empresaNombre: m.cliente.company.name,
        empresaEsDemo: m.cliente.company.esDemo,
        planNombre: m.plan.nombre,
        planPrecio: Number(m.plan.precio),
        planEsIlimitado: m.plan.esIlimitado,
        planLavadosIncluidos: m.plan.esIlimitado ? null : m.plan.lavadosIncluidos,
        planVigenciaDias: m.plan.vigenciaDias ?? 30,
        usosRegaloRestantes: m.lavadosBonoRestantes,
        visitas: m._count.visits,
        comprobantes: m._count.comprobantes,
        pagosConfirmados: m.pagoIntentos.length,
      }))

      return {
        filas,
        total,
        resumen: { porValidar, vigentes, vencenPronto, vencidasSinMarcar },
        empresas,
      }
    }
  )
}
