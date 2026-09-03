import type { Prisma } from '@prisma/client'

/**
 * VIGENCIA DE UNA MEMBRESÍA · una sola definición, y una red debajo.
 *
 * Hasta la auditoría de 2026-08, `estado = 'ACTIVA'` no significaba «vigente»:
 * significaba «nadie la ha tocado desde que se activó». No existía ningún
 * proceso que venciera membresías — el único sitio de todo el código que
 * escribía `VENCIDA` era el botón «desactivar» que un administrador pulsa a
 * mano. Una membresía que venció en marzo seguía contando como activa en
 * agosto.
 *
 * El mostrador nunca se equivocó: `visitas/canje.ts` compara la fecha antes de
 * canjear. Y eso era justamente lo peor que podía pasar — el panel enseñaba
 * como vigentes membresías que el escáner rechazaba, y el empleado quedaba en
 * falso delante del cliente.
 *
 * Se arregla por los dos lados a la vez, y a propósito:
 *
 * 1. `vencerMembresias()` corre a diario y pone al día el estado.
 * 2. `membresiaVigente()` exige ADEMÁS que la fecha no haya pasado.
 *
 * El segundo hace al primero redundante casi siempre, y ese es el punto: el día
 * que el cron falle, se caiga la cola o alguien cambie el horario, los números
 * siguen siendo verdad. Un dato correcto no debería depender de que un proceso
 * se ejecutara anoche.
 */

/**
 * Filtro de «membresía vigente»: activa Y sin vencer.
 *
 * Va dentro de `AND` a propósito. El fragmento necesita su propio `OR` (una
 * membresía sin fecha de vencimiento es perpetua y cuenta), y si lo expusiera
 * suelto, cualquier consulta que ya tuviera un `OR` lo pisaría en silencio.
 * Envuelto, se compone con `{ companyId, ...membresiaVigente() }` sin sorpresas.
 *
 * No se escribe como `NOT: { fechaVencimiento: { lt: ahora } }`, que parece
 * equivalente y no lo es: en SQL, `NOT (NULL < x)` es NULL, no TRUE, así que
 * las membresías perpetuas desaparecerían del recuento.
 */
export function membresiaVigente(ahora: Date = new Date()): Prisma.MembershipWhereInput {
  return {
    AND: [
      { estado: 'ACTIVA' },
      { OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gte: ahora } }] },
    ],
  }
}

/**
 * La misma pregunta sobre una fila que ya está en memoria.
 *
 * `membresiaVigente()` sirve para consultar; esto sirve para decidir delante de
 * un objeto que ya se leyó. Misma regla, para que no haya dos verdades: una
 * fila que dice ACTIVA con la fecha pasada NO está vigente, la haya marcado el
 * job o no.
 */
export function estaVigente(
  m: { estado: string; fechaVencimiento: Date | null },
  ahora: Date = new Date()
): boolean {
  return m.estado === 'ACTIVA' && (m.fechaVencimiento === null || m.fechaVencimiento > ahora)
}

/** Lo contrario: activa en la base pero ya pasada de fecha. Lo que el job barre. */
export function membresiaCaducada(ahora: Date = new Date()): Prisma.MembershipWhereInput {
  return { estado: 'ACTIVA', fechaVencimiento: { lt: ahora } }
}

/**
 * «Vencida» tal y como la entiende quien mira la pantalla: se acabó.
 *
 * Son dos cosas a la vez, y la segunda es la que faltaba:
 *
 *  · La que alguien marcó —`VENCIDA` o `CANCELADA`—.
 *  · La que sigue diciendo `ACTIVA` porque el job todavía no pasó, pero cuya
 *    fecha quedó atrás. Es exactamente `membresiaCaducada()`.
 *
 * Sin la segunda rama, ese cliente no aparecía en NINGÚN filtro: la fecha lo
 * sacaba de «vigente», el estado lo sacaba de «vencida», tenía membresía así
 * que tampoco era «sin», y su fecha ya había pasado así que tampoco estaba
 * «por vencer». Se caía por los cuatro huecos y desaparecía del directorio.
 *
 * Mismo criterio que `membresiaVigente()`: la verdad la decide la fecha, no que
 * un proceso se ejecutara anoche.
 *
 * `fechaVencimiento: { lt: ahora }` deja fuera las perpetuas (`NULL`) por sí
 * solo: en SQL `NULL < x` es NULL, no TRUE. Es lo correcto — una membresía sin
 * fecha no vence nunca.
 */
export function membresiaTerminada(ahora: Date = new Date()): Prisma.MembershipWhereInput {
  return {
    OR: [{ estado: { in: ['VENCIDA', 'CANCELADA'] } }, membresiaCaducada(ahora)],
  }
}
