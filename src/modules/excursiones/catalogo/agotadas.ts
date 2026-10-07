/**
 * EXCURSIONES · Catálogo — sincronización del estado AGOTADA.
 *
 * Vive FUERA de `actions.ts` (`'use server'`) a propósito: lo que un archivo `'use server'`
 * exporta es un endpoint al que cualquier navegador puede llamar. Estas dos funciones
 * reciben la empresa como argumento y no comprueban sesión (la comprueban las acciones de
 * reservas que las llaman): estando en el archivo de acciones, cualquiera podía cambiar el
 * estado de las excursiones de otra empresa y, con `sincronizarTodasAgotadas`, disparar una
 * transacción por excursión (hallazgo M2 de la auditoría del 2026-10-07). Lo vigila
 * `tests/acciones-sin-guardia.test.ts`.
 */

import { conEmpresa } from '@/lib/tenant'

/** Recalcula y sincroniza el estado AGOTADA de una excursión según su disponibilidad. */
export async function sincronizarEstadoAgotada(companyId: string, excursionId: string): Promise<void> {
  await conEmpresa(companyId, async (tx) => {
    const excursion = await tx.excursion.findFirst({
      where: { id: excursionId, companyId },
      select: {
        id: true,
        capacidad: true,
        estado: true,
        // Se lee más abajo para decidir si hay que tocar los combos padre.
        // Faltaba en el select: el código pedía un campo que la consulta no
        // traía, y en ejecución habría salido `undefined` —o sea, la rama de
        // los combos se habría comportado como si TODO fuera un combo.
        tipoItem: true,
        horaSalida: true,
        horaRegreso: true,
        horarios: {
          where: { activo: true },
          select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
        },
      },
    })
    if (!excursion || excursion.estado === 'ARCHIVADA') return

    const effectiveHorarios =
      excursion.horarios && excursion.horarios.length > 0
        ? excursion.horarios
        : excursion.horaSalida
          ? [
              {
                id: `default-${excursion.id}`,
                diasSemana: [1, 2, 3, 4, 5, 6, 7],
                horaSalida: excursion.horaSalida,
                cupo: null,
              },
            ]
          : []

    // Calcular disponibilidad real (próximos 90 días)
    const capacidad = excursion.capacidad && excursion.capacidad > 0 ? excursion.capacidad : 50
    if (effectiveHorarios.length === 0) {
      if (excursion.estado !== 'AGOTADA') {
        await tx.excursion.update({ where: { id: excursionId }, data: { estado: 'AGOTADA' } })
      }
      return
    }

    // Verificar si hay al menos una salida futura con cupo
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const dentroDe90 = new Date(hoy)
    dentroDe90.setDate(dentroDe90.getDate() + 90)

    const [reservasDirectas, reservasItems] = await Promise.all([
      tx.reservaExc.findMany({
        where: {
          companyId,
          excursionId: excursion.id,
          fecha: { gte: hoy, lte: dentroDe90 },
          estado: { notIn: ['CANCELADA', 'NO_SHOW', 'COMPLETADA'] },
        },
        select: { fecha: true, hora: true, adultos: true, ninos: true },
      }),
      tx.reservaItem.findMany({
        where: {
          companyId,
          actividadId: excursion.id,
          fecha: { gte: hoy, lte: dentroDe90 },
          estado: { notIn: ['CANCELADA'] },
          reserva: { estado: { notIn: ['CANCELADA', 'NO_SHOW', 'COMPLETADA'] } },
        },
        select: { fecha: true, hora: true, adultos: true, ninos: true },
      }),
    ])

    const reservasMap = new Map<string, number>()
    for (const r of reservasDirectas) {
      const fechaStr = r.fecha.toISOString().split('T')[0]
      const horaStr = (r.hora || '').trim().slice(0, 5)
      const key = `${fechaStr}|${horaStr}`
      reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
    }
    for (const r of reservasItems) {
      const fechaStr = r.fecha.toISOString().split('T')[0]
      const horaStr = (r.hora || '').trim().slice(0, 5)
      const key = `${fechaStr}|${horaStr}`
      reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
    }

    const DIAS_SEMANA_MAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 } as const

    function generarFechasParaDia(diaSemana: number, limiteDias = 90): string[] {
      const fechas: string[] = []
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)
      const targetDay =
        DIAS_SEMANA_MAP[diaSemana as keyof typeof DIAS_SEMANA_MAP] ?? diaSemana
      const fecha = new Date(hoy)
      const diff = (targetDay - fecha.getDay() + 7) % 7
      fecha.setDate(fecha.getDate() + diff)
      for (let i = 0; i < limiteDias; i += 7) {
        if (fecha >= hoy) fechas.push(fecha.toISOString().split('T')[0])
        fecha.setDate(fecha.getDate() + 7)
      }
      return fechas
    }

    let hayDisponibilidad = false
    const ahoraTimestamp = Date.now()

    for (const horario of effectiveHorarios) {
      const dias = Array.isArray(horario.diasSemana) ? (horario.diasSemana as number[]) : [1, 2, 3, 4, 5, 6, 7]
      for (const diaSemana of dias) {
        const fechas = generarFechasParaDia(diaSemana)
        for (const fecha of fechas) {
          const horaSalida = (horario.horaSalida || '00:00').trim().slice(0, 5)
          const key = `${fecha}|${horaSalida}`
          const reservados = reservasMap.get(key) || 0
          const cupoEfectivo = horario.cupo && horario.cupo > 0 ? horario.cupo : capacidad
          const cupoDisponible = Math.max(0, cupoEfectivo - reservados)
          
          const [hStr, mStr] = horaSalida.split(':')
          const [y, m, d] = fecha.split('-').map(Number)
          const salidaDate = new Date(y, m - 1, d, Number(hStr || 0), Number(mStr || 0), 0, 0)
          const fechaPasada = salidaDate.getTime() < ahoraTimestamp
          const agotada = cupoDisponible <= 0 || fechaPasada
          if (!agotada) {
            hayDisponibilidad = true
            break
          }
        }
        if (hayDisponibilidad) break
      }
      if (hayDisponibilidad) break
    }

    const nuevoEstado = hayDisponibilidad ? 'ACTIVA' : 'AGOTADA'
    if (excursion.estado !== nuevoEstado && excursion.estado !== 'ARCHIVADA') {
      await tx.excursion.update({ where: { id: excursionId }, data: { estado: nuevoEstado } })
    }

    // Si es una actividad individual, sincronizar también los combos que la contienen
    if (excursion.tipoItem !== 'COMBO') {
      /**
       * PENDIENTE: la cascada hacia los combos padre no está implementada.
       *
       * Este bloque llegó a medias: consultaba por `excursionId`, que no es un
       * campo de `ExcursionComboItem` —el padre es `comboId` y la hija
       * `actividadId`— y el cuerpo del bucle no hacía nada. Se corrige el
       * nombre del campo para que diga la verdad, y se deja anotado que la
       * propagación sigue sin escribirse: cuando una actividad se agota, el
       * combo que la contiene NO pasa a AGOTADA todavía.
       *
       * No se inventa aquí el comportamiento que falta: decidir si un combo se
       * agota porque una de sus actividades lo hizo es una regla de negocio, y
       * escribirla a ojo sería peor que dejarla a la vista.
       */
      const combosPadre = await tx.excursionComboItem.findMany({
        where: { actividadId: excursionId, companyId },
        select: { comboId: true },
      })
      void combosPadre
    }
  })
}

/**
 * Recalcula AGOTADA para todas las excursiones de una empresa (job nocturno).
 *
 * La lista se lee en su PROPIA transacción, que se cierra antes del bucle.
 * `sincronizarEstadoAgotada` abre la suya, así que llamarla desde dentro de
 * otra mantenía dos conexiones del pool ocupadas a la vez —una por excursión—
 * durante todo el recorrido. En una empresa con catálogo grande eso agota el
 * pool y tumba lo que esté sirviendo a la vez.
 *
 * El resultado es el mismo: cada excursión se recalcula igual, solo que cada
 * una en su transacción corta en vez de todas dentro de una larga.
 */
export async function sincronizarTodasAgotadas(companyId: string): Promise<void> {
  const excursiones = await conEmpresa(companyId, (tx) =>
    tx.excursion.findMany({
      where: { companyId, estado: { not: 'ARCHIVADA' } },
      select: { id: true },
    })
  )
  for (const exc of excursiones) {
    await sincronizarEstadoAgotada(companyId, exc.id)
  }
}
