import type { Tx } from '@/lib/tenant'

/**
 * EL STOCK DE UNA PROMOCIÓN SE DESCUENTA EN UN SOLO SITIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EN SQL Y NO LEYENDO-Y-ESCRIBIENDO
 *
 * `leer canjes` → `¿cabe?` → `escribir canjes + 1` tiene una ventana entre la
 * pregunta y la respuesta, y dos aprobaciones concurrentes de la última unidad
 * la venden dos veces. El `UPDATE … WHERE "canjes" < "maxCanjes" RETURNING` no
 * la tiene: PostgreSQL decide y escribe en la misma operación, y quien llega
 * segundo se lleva cero filas.
 *
 * `maxCanjes IS NULL` significa ilimitado: el contador sigue subiendo —sirve
 * para medir— pero nunca cierra la puerta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE DESCUENTA, Y DÓNDE NO
 *
 * Se descuenta cuando la promoción se ENTREGA, no cuando se solicita ni cuando
 * se paga. Una compra que se queda en `PENDIENTE_PAGO` y se rechaza no puede
 * haber consumido stock — por eso el descuento vive en la transición a `ACTIVA`
 * y no antes. (El rechazo solo ocurre desde estados previos a la activación, así
 * que no hay cupo que devolver: se comprobó antes de escribir esto.)
 *
 * NO se descuenta en el regalo P2P. La compra espejo que recibe el destinatario
 * hereda una unidad que la compra de origen YA descontó: es una transferencia,
 * no una segunda venta, y cobrarle stock otra vez sería contar dos veces lo
 * mismo.
 *
 * SÍ se descuenta en las recompensas del Growth Engine, y eso cambió el
 * 23-09-2026. Antes se entregaban sin tocar el contador —estaba escrito y era
 * deliberado— con el efecto de que una promoción con stock 100 podía repartir
 * 150: las cien vendidas más cincuenta regaladas. Decisión del dueño de la
 * plataforma: el campo se llama «Límite de canjes (stock)» en el formulario, y
 * stock son las unidades que EXISTEN, no las que se piensa vender. Cuando se
 * agota, la recompensa no se entrega y queda registrada como PENDIENTE, que es
 * el estado que el negocio ya usa para lo que entrega a mano.
 *
 * @returns `true` si quedaba cupo y se descontó una unidad; `false` si estaba
 *   agotada. No lanza: quien llama decide qué hacer con un «no».
 */
export async function consumirCupoPromocion(tx: Tx, promocionId: string): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "promociones" SET "canjes" = "canjes" + 1
     WHERE "id" = ${promocionId}
       AND ("maxCanjes" IS NULL OR "canjes" < "maxCanjes")
    RETURNING "id"
  `
  return filas.length > 0
}
