import type { Prisma } from '@prisma/client'

/**
 * QUÉ CUENTA COMO DINERO COBRADO. Una sola definición.
 *
 * Estaba escrita tres veces —el Resumen del administrador, Reportes y la
 * conciliación— con las mismas dos condiciones copiadas a mano. Tres copias de
 * un criterio son tres oportunidades de que una se quede atrás, y cuando eso
 * pasa el síntoma es el peor posible: dos pantallas dan cifras distintas del
 * mismo mes y nadie sabe cuál creer.
 *
 * Las dos condiciones, y por qué:
 *
 *  · `pagoConfirmado` — cobrado es lo que ENTRÓ, no lo que se facturó. Una
 *    membresía creada y sin pagar no es dinero.
 *
 *  · La fecha es `fechaPago`, con respaldo a `updatedAt` SOLO cuando
 *    `fechaPago` es null. Ese respaldo existe por los cobros anteriores a que
 *    la columna existiera: sin él desaparecerían del histórico. Y va como
 *    `fechaPago: null` explícito, no como un `OR` suelto, para que un cobro con
 *    fecha propia NO pueda contarse dos veces por su `updatedAt`.
 *
 * Sin `import 'server-only'` a propósito: así se puede probar sin base de datos.
 */
export function whereCobrado(
  desde: Date,
  /** Fin del rango, EXCLUSIVO. Omitirlo significa «desde `desde` hasta hoy». */
  hasta?: Date,
  /** Acotación extra: la empresa, o excluir las de práctica. */
  extra?: Prisma.MembershipWhereInput
): Prisma.MembershipWhereInput {
  const rango = hasta ? { gte: desde, lt: hasta } : { gte: desde }
  return {
    AND: [
      { pagoConfirmado: true },
      { OR: [{ fechaPago: rango }, { fechaPago: null, updatedAt: rango }] },
      ...(extra ? [extra] : []),
    ],
  }
}

/**
 * LO QUE LA CAJA YA CONTÓ, NO SE CUENTA OTRA VEZ COMO COBRO DE MEMBRESÍA.
 *
 * Un pago con tarjeta de la pasarela activa la membresía (`montoPagado`, `pagoConfirmado`) Y deja una venta `SALE` en
 * el libro (`transactions`, con `pagoIntentoId`). Los reportes suman los dos flujos —la caja y las membresías— y, sin
 * esta guarda, ese mismo dinero saldría dos veces en «Total cobrado».
 *
 * La guarda deja fuera del flujo de membresías las que tienen una venta de pasarela COBRADA en el MISMO periodo. Es por
 * periodo a propósito: un cobro anterior a que existiera el comprobante (sin venta) sigue contándose por su membresía,
 * como siempre, y no desaparece del histórico.
 *
 * Alcance deliberado: solo ventas de pasarela. Las ventas de mostrador y del panel que también activan una membresía
 * no se tocan aquí (ver `docs/PAGO_TARJETA_COMPROBANTE.md`, hallazgo previo): cambiar cifras ya publicadas es una
 * decisión del negocio, no un efecto lateral de este trabajo.
 */
export function sinVentaDePasarelaEnElPeriodo(desde: Date, hasta: Date): Prisma.MembershipWhereInput {
  return {
    transacciones: {
      none: {
        tipo: 'SALE',
        estado: { in: ['APPROVED', 'APPLIED'] },
        pagoIntentoId: { not: null },
        createdAt: { gte: desde, lt: hasta },
      },
    },
  }
}

/**
 * El periodo anterior de la misma longitud, para comparar.
 *
 * Se calcula por diferencia real de milisegundos y no restando «30 días»: si el
 * rango cruza un cambio de horario, restar días naturales devuelve un periodo de
 * distinta duración y la comparación pasa a mentir un poco sin avisar.
 */
export function periodoAnterior(desde: Date, hasta: Date): { desde: Date; hasta: Date } {
  const largo = hasta.getTime() - desde.getTime()
  return { desde: new Date(desde.getTime() - largo), hasta: desde }
}

/**
 * Variación entre dos periodos, en porcentaje entero.
 *
 * `null` cuando el periodo anterior fue CERO: no existe el «infinito por ciento»
 * y pintar «+100 %» al pasar de 0 a 3 es inventarse una escala. Quien lo muestre
 * debe decir «sin datos previos» y no un número.
 */
export function variacion(actual: number, previo: number): number | null {
  if (previo === 0) return null
  return Math.round(((actual - previo) / previo) * 100)
}
