import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { contarColasDePago } from '@/modules/pagos/colasConteo'
import { whereTransferencias } from '@/modules/pagos/colas'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { membresiaVigente, membresiaVigenteSql } from '@/modules/membresia/vigencia'
import { variacion } from '@/modules/reportes/rango'
import type { BloquesResumen } from './bloques'
import { calendarioDelResumen, serieDe14 } from './calendario'

/**
 * LOS DATOS DEL RESUMEN (auditoría admin · fase 5, tarea 5.1; 05 · D-03, D-06, D-10).
 *
 * UNA transacción y solo las consultas de los bloques que esta persona ve (`bloques.ts`): lo que no se concede, no se pide a
 * la base de datos. Reemplaza al motor de 40 consultas de `dashboardQueries.ts`, que calculaba todo para todos.
 *
 * Presupuesto: ≤ 15 sentencias de datos para el administrador (el que más ve), medido con `pg_stat_statements`
 * (`docs/auditoria-admin/fase-5/INFORME-FASE-5.md`). Lo que lo hace posible:
 *   · los contadores de visitas (hoy, mes y la serie de 14 días) salen de UNA consulta agrupada por día;
 *   · las membresías vigentes y las que vencen en 7 días, de UNA con `FILTER`;
 *   · el recuento de colas de pago salta el «seguimiento», que el Resumen no pinta.
 *
 * Las definiciones NO se reescriben aquí: «vigente» es `membresiaVigente`/`membresiaVigenteSql` (D-24), «cobrado» es
 * `whereCobrado` (D-10), «hoy» y el calendario del negocio salen de `rango.ts` (D-03).
 */

export interface DatosResumen {
  /** «1–20 oct 2026»: la ventana de TODAS las cifras del mes. */
  ventanaMes: string
  /** «1–20 sep»: el mismo tramo del mes anterior, con el que se compara el ingreso. */
  ventanaAnterior: string
  pagos?: {
    total: number
    transferencias: number
    sucursal: number
    compras: number
    cambios: number
    /** Dinero declarado en las transferencias: solo con `ver_financieros`. */
    montoTransferencias: number | null
  }
  vencen?: { total: number; proximos: { nombre: string; fecha: Date }[] }
  riesgo?: { vencen7: number; sinVisitas30: number }
  mostrador?: { canjesHoy: number | null; citasHoy: number | null; porEmpleado: { nombre: string; total: number }[] | null }
  promosVencen?: { total: number; items: { id: string; titulo: string; hasta: Date }[] }
  mes: {
    ingresos?: { valor: number; anterior: number; variacion: number | null }
    membresias?: { vigentes: number; porVencer7: number }
    canjes?: { mes: number; hoy: number }
    clientesNuevos?: number
    registros?: { total: number; porOrigen: { origen: string; total: number }[] }
    seguidores?: number
    beneficioLider?: { id: string; titulo: string; vistas: number; compartidas: number } | null
  }
  serie?: { tipo: 'canjes' | 'registros'; dias: { fecha: string; total: number }[] }
}

export async function getResumen(
  companyId: string,
  timeZone: string,
  bloques: BloquesResumen,
  permisos: { conFinanzas: boolean; conEmpleados: boolean }
): Promise<DatosResumen> {
  const ahora = new Date()
  const c = calendarioDelResumen(ahora, timeZone)
  const en7 = new Date(ahora.getTime() + 7 * 86_400_000)
  const hace30 = new Date(ahora.getTime() - 30 * 86_400_000)
  const quiere = {
    pagos: bloques.hoy.includes('pagos'),
    vencen: bloques.hoy.includes('vencen'),
    riesgo: bloques.hoy.includes('riesgo'),
    mostrador: bloques.hoy.includes('mostrador'),
    promosVencen: bloques.hoy.includes('promosVencen'),
  }
  const m = new Set(bloques.mes)
  const verCanjes = (quiere.mostrador && bloques.mostrador.canjes) || m.has('canjes') || bloques.grafica === 'canjes'
  const verRegistros = m.has('registros') || bloques.grafica === 'registros'
  const necesitaMembresias = quiere.vencen || quiere.riesgo || m.has('membresias')

  const datos: DatosResumen = { ventanaMes: c.ventanaMes, ventanaAnterior: c.ventanaAnterior, mes: {} }
  // Los visitas y los registros por día se leen desde el más antiguo de los dos límites: el mes o los 14 días de la gráfica.
  const desde = c.inicioMes < c.desdeSerie ? c.inicioMes : c.desdeSerie

  await conEmpresa(companyId, async (tx) => {
    const tareas: Promise<void>[] = []
    const tarea = (f: () => Promise<void>) => tareas.push(f())

    // ── HOY · requiere acción ─────────────────────────────────────────────────────────────────────────────────────
    if (quiere.pagos) {
      tarea(async () => {
        const [colas, monto] = await Promise.all([
          contarColasDePago(companyId, tx, { conSeguimiento: false }),
          permisos.conFinanzas
            ? tx.membership
                .aggregate({ where: whereTransferencias(companyId), _sum: { montoPagado: true } })
                .then((a) => Number(a._sum.montoPagado ?? 0))
                .catch(() => 0)
            : Promise.resolve(null),
        ])
        datos.pagos = {
          total: colas.porValidar,
          transferencias: colas.transferencias,
          sucursal: colas.sucursal,
          compras: colas.compras,
          cambios: colas.cambios,
          montoTransferencias: monto,
        }
      })
    }

    let vigentes = 0
    let porVencer7 = 0
    if (necesitaMembresias) {
      tarea(async () => {
        const [f] = await tx.$queryRaw<{ vigentes: number; por_vencer: number }[]>(Prisma.sql`
          SELECT COUNT(*) FILTER (WHERE ${membresiaVigenteSql('m', ahora)})::int AS vigentes,
                 COUNT(*) FILTER (WHERE ${membresiaVigenteSql('m', ahora)} AND m."fechaVencimiento" <= ${en7})::int AS por_vencer
          FROM "memberships" m
          WHERE m."companyId" = ${companyId}`)
        vigentes = f?.vigentes ?? 0
        porVencer7 = f?.por_vencer ?? 0
      })
    }
    if (quiere.vencen) {
      tarea(async () => {
        const proximos = await tx.$queryRaw<{ nombre: string; fecha: Date }[]>(Prisma.sql`
          SELECT c."nombre" AS nombre, m."fechaVencimiento" AS fecha
          FROM "memberships" m
          JOIN "clientes" c ON c."id" = m."clienteId"
          WHERE m."companyId" = ${companyId} AND ${membresiaVigenteSql('m', ahora)} AND m."fechaVencimiento" <= ${en7}
          ORDER BY m."fechaVencimiento" ASC
          LIMIT 2`)
        datos.vencen = { total: 0, proximos }
      })
    }
    if (quiere.riesgo) {
      tarea(async () => {
        const sinVisitas30 = await tx.cliente.count({
          where: {
            companyId,
            memberships: { some: membresiaVigente(ahora) },
            visits: { none: { fechaVisita: { gte: hace30 } } },
          },
        })
        datos.riesgo = { vencen7: 0, sinVisitas30 }
      })
    }
    if (quiere.mostrador && bloques.mostrador.citas) {
      tarea(async () => {
        const citasHoy = await tx.cita
          .count({ where: { companyId, inicio: { gte: c.inicioHoy, lt: c.finHoy }, estado: { in: ['PENDIENTE', 'CONFIRMADA'] } } })
          .catch(() => 0)
        datos.mostrador = { canjesHoy: null, porEmpleado: null, ...datos.mostrador, citasHoy }
      })
    }
    if (quiere.mostrador && bloques.mostrador.canjes && permisos.conEmpleados) {
      tarea(async () => {
        const filas = await tx.$queryRaw<{ nombre: string | null; total: number }[]>(Prisma.sql`
          SELECT u."name" AS nombre, COUNT(*)::int AS total
          FROM "visits" v
          JOIN "clientes" c ON c."id" = v."clienteId"
          LEFT JOIN "users" u ON u."id" = v."empleadoId"
          WHERE c."companyId" = ${companyId} AND v."fechaVisita" >= ${c.inicioHoy}
          GROUP BY u."name"
          ORDER BY total DESC
          LIMIT 3`)
        datos.mostrador = {
          canjesHoy: null,
          citasHoy: null,
          ...datos.mostrador,
          porEmpleado: filas.map((f) => ({ nombre: f.nombre ?? 'Sin asignar', total: f.total })),
        }
      })
    }
    if (quiere.promosVencen) {
      tarea(async () => {
        const filas = await tx.$queryRaw<{ id: string; titulo: string; hasta: Date; total: number }[]>(Prisma.sql`
          SELECT p."id", p."titulo", p."vigenciaHasta" AS hasta, COUNT(*) OVER()::int AS total
          FROM "promociones" p
          WHERE p."companyId" = ${companyId} AND p."activo" AND NOT p."archivada"
            AND p."vigenciaHasta" >= ${ahora} AND p."vigenciaHasta" <= ${en7}
          ORDER BY p."vigenciaHasta" ASC
          LIMIT 2`)
        datos.promosVencen = { total: filas[0]?.total ?? 0, items: filas.map((f) => ({ id: f.id, titulo: f.titulo, hasta: f.hasta })) }
      })
    }

    // ── ESTE MES · cada cifra con su ventana ─────────────────────────────────────────────────────────────────────
    if (m.has('ingresos') && permisos.conFinanzas) {
      tarea(async () => {
        // `whereCobrado` en cada agregado, a la vista: es el ÚNICO criterio de «cobrado» (D-10) y una prueba lo exige así.
        const [valor, anterior] = await Promise.all([
          tx.membership
            .aggregate({ where: whereCobrado(c.inicioMes, undefined, { companyId }), _sum: { montoPagado: true } })
            .then((a) => Number(a._sum.montoPagado ?? 0)),
          tx.membership
            .aggregate({ where: whereCobrado(c.inicioMesAnterior, c.finTramoAnterior, { companyId }), _sum: { montoPagado: true } })
            .then((a) => Number(a._sum.montoPagado ?? 0))
            .catch(() => 0),
        ])
        datos.mes.ingresos = { valor, anterior, variacion: variacion(valor, anterior) }
      })
    }
    if (m.has('clientesNuevos')) {
      tarea(async () => {
        datos.mes.clientesNuevos = await tx.cliente.count({ where: { companyId, createdAt: { gte: c.inicioMes } } })
      })
    }
    if (m.has('seguidores')) {
      tarea(async () => {
        datos.mes.seguidores = await tx.companyFollow.count({ where: { companyId, createdAt: { gte: hace30 } } })
      })
    }
    if (m.has('beneficioLider')) {
      tarea(async () => {
        const p = await tx.promocion.findFirst({
          where: { companyId, archivada: false },
          orderBy: { viewCount: 'desc' },
          select: { id: true, titulo: true, viewCount: true, shareCount: true },
        })
        datos.mes.beneficioLider = p ? { id: p.id, titulo: p.titulo, vistas: p.viewCount, compartidas: p.shareCount } : null
      })
    }

    // Visitas por día: hoy, el mes y la serie de la gráfica salen de las mismas filas.
    let visitasPorDia = new Map<string, number>()
    if (verCanjes) {
      tarea(async () => {
        const filas = await tx.$queryRaw<{ dia: string; total: number }[]>(Prisma.sql`
          SELECT to_char(v."fechaVisita" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS dia,
                 COUNT(*)::int AS total
          FROM "visits" v
          JOIN "clientes" c ON c."id" = v."clienteId"
          WHERE c."companyId" = ${companyId} AND v."fechaVisita" >= ${desde}
          GROUP BY 1`)
        visitasPorDia = new Map(filas.map((f) => [f.dia, f.total]))
      })
    }
    let registrosPorDia = new Map<string, number>()
    const porOrigen = new Map<string, number>()
    if (verRegistros) {
      tarea(async () => {
        const filas = await tx.$queryRaw<{ dia: string; origen: string; total: number }[]>(Prisma.sql`
          SELECT to_char(c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS dia,
                 COALESCE(NULLIF(c."canalOrigen", ''), 'Directo') AS origen,
                 COUNT(*)::int AS total
          FROM "clientes" c
          WHERE c."companyId" = ${companyId} AND c."createdAt" >= ${desde}
          GROUP BY 1, 2`)
        registrosPorDia = new Map()
        for (const f of filas) {
          registrosPorDia.set(f.dia, (registrosPorDia.get(f.dia) ?? 0) + f.total)
          if (f.dia >= `${c.mesClave}-01`) porOrigen.set(f.origen, (porOrigen.get(f.origen) ?? 0) + f.total)
        }
      })
    }

    await Promise.all(tareas)

    // ── Lo que se arma con lo leído ───────────────────────────────────────────────────────────────────────────────
    if (datos.vencen) datos.vencen.total = porVencer7
    if (datos.riesgo) datos.riesgo.vencen7 = porVencer7
    if (m.has('membresias')) datos.mes.membresias = { vigentes, porVencer7 }
    if (verCanjes) {
      const delMes = [...visitasPorDia].filter(([dia]) => dia >= `${c.mesClave}-01`).reduce((t, [, n]) => t + n, 0)
      const hoy = visitasPorDia.get(c.hoyDia) ?? 0
      if (m.has('canjes')) datos.mes.canjes = { mes: delMes, hoy }
      if (quiere.mostrador && bloques.mostrador.canjes) {
        datos.mostrador = { citasHoy: null, porEmpleado: null, ...datos.mostrador, canjesHoy: hoy }
      }
      if (bloques.grafica === 'canjes') datos.serie = { tipo: 'canjes', dias: serieDe14(c.primerDiaSerie, visitasPorDia) }
    }
    if (verRegistros) {
      const total = [...porOrigen.values()].reduce((t, n) => t + n, 0)
      if (m.has('registros')) {
        datos.mes.registros = {
          total,
          // El canal viene como lo capturó la cookie (`instagram`, `facebook`, `tarjeta`…): se escribe con mayúscula inicial.
          porOrigen: [...porOrigen]
            .map(([origen, n]) => ({ origen: origen.charAt(0).toUpperCase() + origen.slice(1), total: n }))
            .sort((a, b) => b.total - a.total),
        }
      }
      if (bloques.grafica === 'registros') datos.serie = { tipo: 'registros', dias: serieDe14(c.primerDiaSerie, registrosPorDia) }
    }
  })

  return datos
}
