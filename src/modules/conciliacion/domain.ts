/**
 * CONCILIACIÓN DEL COMERCIO · reglas (Fase 9). Puro: sin Prisma ni Next.
 *
 * Una regla de conciliación dice «estas dos cosas tienen que cuadrar» y lo que NO cuadra es un hallazgo. Las
 * reglas viven aquí como DATOS (código, grupo, severidad, qué es, qué hacer) y sus consultas en `queries.ts`:
 * agregar una regla es agregar una entrada y una consulta, y una prueba (`tests/postgres/conciliacion.db.test.ts`
 * rompe cada invariante a mano y comprueba que su regla —y solo ella— lo ve).
 *
 * NO ARREGLA NADA. Conciliar es mirar: la base ya impide casi todo esto con sus reglas (disparadores, CHECK,
 * claves compuestas), así que un hallazgo es la señal de que algo se saltó esas reglas (una escritura manual, un
 * bug, un dato anterior a una regla) o de algo que el diseño permite a propósito y conviene ver (la regla P04).
 * Corregirlo es una decisión humana, caso por caso.
 */

export type Severidad = 'ALTA' | 'MEDIA' | 'BAJA'

export type GrupoDeRegla = 'PEDIDOS_Y_COMISIONES' | 'PAGOS' | 'RENGLONES' | 'EXISTENCIAS' | 'LIBRO' | 'OFERTAS'

export interface Regla {
  codigo: string
  grupo: GrupoDeRegla
  severidad: Severidad
  titulo: string
  /** Qué tiene que cuadrar y por qué importa. */
  queEs: string
  /** Qué mirar primero. */
  queHacer: string
}

export const ETIQUETA_GRUPO: Readonly<Record<GrupoDeRegla, string>> = {
  PEDIDOS_Y_COMISIONES: 'Pedidos y comisiones',
  PAGOS: 'Pagos y verificación',
  RENGLONES: 'Montos del pedido',
  EXISTENCIAS: 'Inventario',
  LIBRO: 'Libro de la cuenta Membego',
  OFERTAS: 'Ofertas con presupuesto',
}

export const ORDEN_DE_GRUPOS: readonly GrupoDeRegla[] = ['PEDIDOS_Y_COMISIONES', 'PAGOS', 'RENGLONES', 'LIBRO', 'OFERTAS', 'EXISTENCIAS']

export const REGLAS: readonly Regla[] = [
  // ── Pedidos y comisiones ────────────────────────────────────────────────
  { codigo: 'C01', grupo: 'PEDIDOS_Y_COMISIONES', severidad: 'ALTA', titulo: 'Pedido del marketplace completado sin comisión', queEs: 'Todo pedido del marketplace que se cierra con una base comisionable mayor que cero cobra su comisión en la misma transacción. Uno completado sin comisión es dinero que no se cobró. (Un pedido con base 0 —descuento total— nunca comisiona y no sale aquí; tampoco el de una empresa cuyo modelo de cobro vale 0.)', queHacer: 'Revisa si el pedido es anterior a Merchant Billing o si el cobro se saltó; el cron de seguridad de pedidos lo cobra si la cuenta lo admite (solo mira los últimos 45 días).' },
  { codigo: 'C02', grupo: 'PEDIDOS_Y_COMISIONES', severidad: 'ALTA', titulo: 'Pedido reembolsado con la comisión sin revertir', queEs: 'Reembolsar un pedido revierte su comisión con un asiento contrario. Si sigue confirmada, la empresa paga por una venta que se devolvió.', queHacer: 'Revierte la comisión con un ajuste en «Cobros a empresas» y revisa por qué el reembolso no la revirtió.' },
  { codigo: 'C03', grupo: 'PEDIDOS_Y_COMISIONES', severidad: 'ALTA', titulo: 'Comisión confirmada sobre un pedido que no se completó', queEs: 'Solo un pedido completado genera comisión. Una comisión sobre un pedido cancelado o abierto cobra algo que no ocurrió.', queHacer: 'Revisa el pedido y reviértela con un ajuste si el cobro fue un error.' },
  { codigo: 'C04', grupo: 'PEDIDOS_Y_COMISIONES', severidad: 'MEDIA', titulo: 'Comisión sobre un pedido que no comisiona', queEs: 'Solo los pedidos del marketplace comisionan (los de Supply, el POS y los demás, no). Una comisión sobre otro origen contradice esa regla.', queHacer: 'Confirma si el origen cambió después del cobro o si se decidió comisionar ese origen (y entonces actualiza la regla).' },
  { codigo: 'C05', grupo: 'PEDIDOS_Y_COMISIONES', severidad: 'ALTA', titulo: 'Comisión por un monto distinto a su base', queEs: 'La comisión por porcentaje es la base × la tasa, redondeada a centavos; y la base es la del pedido. Si no cuadra, el cobro no sigue la regla de la cuenta.', queHacer: 'Compara base, tasa y monto de la comisión con el pedido.' },
  { codigo: 'C06', grupo: 'PEDIDOS_Y_COMISIONES', severidad: 'ALTA', titulo: 'Base de la comisión distinta de la base del pedido', queEs: 'La comisión se calcula sobre la base comisionable del pedido. Una base distinta indica que el pedido cambió después de cobrar o que se cobró sobre otro monto.', queHacer: 'Revisa los ajustes del pedido y el asiento de la comisión.' },

  // ── Pagos y verificación ────────────────────────────────────────────────
  { codigo: 'P01', grupo: 'PAGOS', severidad: 'ALTA', titulo: 'Pago verificado sin constancia de pago', queEs: 'El nivel «pago verificado» se deriva de una constancia (método, monto, referencia). Sin constancia, el nivel no tiene respaldo y la comisión del 8 % tampoco.', queHacer: 'Busca la constancia o baja el nivel del pedido.' },
  { codigo: 'P02', grupo: 'PAGOS', severidad: 'ALTA', titulo: 'Pago verificado con una constancia que no lo respalda', queEs: 'Para verificar un pago hace falta método verificable (transferencia, tarjeta, checkout), referencia y el monto del pedido. Efectivo, sin referencia o por otro monto no verifica.', queHacer: 'Revisa la constancia del pedido.' },
  { codigo: 'P03', grupo: 'PAGOS', severidad: 'MEDIA', titulo: 'Verificado por el cliente sin su confirmación vigente', queEs: 'Los niveles «verificado por el cliente» y «pago verificado» exigen que el cliente confirmara el monto actual del pedido.', queHacer: 'Revisa la confirmación del cliente y el total del pedido.' },
  { codigo: 'P04', grupo: 'PAGOS', severidad: 'BAJA', titulo: 'Pago verificado después de cerrar: la comisión se quedó en CPA', queEs: 'La comisión se fija al cerrar el pedido. Si el negocio registra el pago verificado DESPUÉS de entregar, la comisión ya cobrada no sube al 8 %. Es el comportamiento diseñado, pero deja de cobrarse la diferencia: conviene verlo.', queHacer: 'Decide si se avisa al negocio de que registre el pago antes de entregar, o si se recalcula la comisión como regla nueva.' },

  // ── Montos del pedido ───────────────────────────────────────────────────
  { codigo: 'L01', grupo: 'RENGLONES', severidad: 'ALTA', titulo: 'Pedido sin renglones', queEs: 'Un pedido pide algo: sin renglones no hay qué entregar ni qué cobrar.', queHacer: 'Revisa cómo se creó el pedido.' },
  { codigo: 'L02', grupo: 'RENGLONES', severidad: 'ALTA', titulo: 'Subtotal o descuento distintos de la suma de sus renglones', queEs: 'El subtotal es la suma de cantidad × precio de los renglones y el descuento es la suma de los descuentos. Si no cuadran, el pedido muestra un monto que sus renglones no explican.', queHacer: 'Compara el pedido con sus renglones.' },
  { codigo: 'L03', grupo: 'RENGLONES', severidad: 'ALTA', titulo: 'Total o base comisionable que no salen de sus partes', queEs: 'La base comisionable es subtotal − descuento + ajuste, y el total es esa base + impuestos. Un total que no sale de ahí no es el monto que el cliente confirmó ni el que se comisiona.', queHacer: 'Recalcula el pedido a mano y revisa los ajustes.' },
  { codigo: 'L04', grupo: 'RENGLONES', severidad: 'MEDIA', titulo: 'Renglón cuyo total no es cantidad × precio − descuento', queEs: 'El total de un renglón es su cantidad por el precio, menos su descuento.', queHacer: 'Revisa el renglón.' },

  // ── Libro de la cuenta Membego ──────────────────────────────────────────
  { codigo: 'G01', grupo: 'LIBRO', severidad: 'ALTA', titulo: 'Libro con un salto o un saldo que no suma', queEs: 'El libro de cada empresa es una cadena: los números de asiento son consecutivos desde 1 y cada saldo es el anterior más el monto. Una ruptura significa que se perdió, se cambió o se insertó un asiento.', queHacer: 'Es grave: nadie debería poder editar el libro. Revisa los accesos y restaura desde un respaldo antes de seguir cobrando.' },
  { codigo: 'G02', grupo: 'LIBRO', severidad: 'ALTA', titulo: 'Comisión y su asiento por montos distintos', queEs: 'Cada comisión tiene un asiento en el libro por el mismo monto.', queHacer: 'Compara la comisión con su asiento.' },
  { codigo: 'G03', grupo: 'LIBRO', severidad: 'ALTA', titulo: 'Reverso de comisión incoherente', queEs: 'Una comisión revertida tiene un asiento de reverso por el monto contrario; una confirmada no tiene reverso.', queHacer: 'Revisa la comisión y su asiento de reverso.' },

  // ── Ofertas con presupuesto ─────────────────────────────────────────────
  { codigo: 'O01', grupo: 'OFERTAS', severidad: 'ALTA', titulo: 'Presupuesto gastado distinto de los canjes', queEs: 'Lo gastado de una oferta es la suma de las cuotas de sus cupones canjeados.', queHacer: 'Compara la oferta con sus cupones canjeados.' },
  { codigo: 'O02', grupo: 'OFERTAS', severidad: 'ALTA', titulo: 'Presupuesto apartado distinto de los cupones vivos', queEs: 'Lo apartado de una oferta es la suma de las cuotas de sus cupones reclamados y sin canjear.', queHacer: 'Compara la oferta con sus cupones reclamados.' },
  { codigo: 'O03', grupo: 'OFERTAS', severidad: 'ALTA', titulo: 'Cupos usados distintos de los cupones', queEs: 'Los cupos en uso son los cupones reclamados más los canjeados.', queHacer: 'Compara la oferta con sus cupones.' },
  { codigo: 'O04', grupo: 'OFERTAS', severidad: 'MEDIA', titulo: 'Cupón y pedido en estados que no se corresponden', queEs: 'Un cupón canjeado tiene su pedido completado, uno reclamado tiene su pedido abierto, y uno cancelado o vencido, su pedido cancelado.', queHacer: 'Revisa el pedido del cupón.' },
  { codigo: 'O05', grupo: 'OFERTAS', severidad: 'ALTA', titulo: 'Cuota cobrada distinta de la cuota del cupón', queEs: 'El canje de una oferta cobra la cuota congelada en su cupón.', queHacer: 'Compara la comisión del pedido con el cupón.' },

  // ── Inventario ──────────────────────────────────────────────────────────
  { codigo: 'I01', grupo: 'EXISTENCIAS', severidad: 'ALTA', titulo: 'Existencias apartadas distintas de las reservas vivas', queEs: 'Lo apartado de una variante en una sucursal es la suma de sus reservas activas. Si no cuadra, se ofrece de más o de menos.', queHacer: 'Revisa las reservas de esa variante y el libro de movimientos.' },
  { codigo: 'I02', grupo: 'EXISTENCIAS', severidad: 'ALTA', titulo: 'Pedido cerrado que dejó existencias apartadas', queEs: 'Al completar un pedido, la reserva de cada renglón pasa a vendida (o, si ya había vencido, se vende de lo disponible y la reserva queda vencida: eso es correcto y no sale aquí). Una reserva que sigue ACTIVA en un pedido cerrado deja existencias apartadas sin dueño.', queHacer: 'Libera la reserva del renglón.' },
  { codigo: 'I03', grupo: 'EXISTENCIAS', severidad: 'MEDIA', titulo: 'Pedido cancelado con existencias todavía apartadas', queEs: 'Cancelar un pedido libera sus reservas. Una reserva activa de un pedido cancelado bloquea existencias sin dueño.', queHacer: 'Libera la reserva.' },
  { codigo: 'I04', grupo: 'EXISTENCIAS', severidad: 'MEDIA', titulo: 'Pedido abierto sin existencias apartadas', queEs: 'Mientras un pedido está abierto, sus reservas están activas. Si una venció o se liberó, el pedido se puede aceptar sin que haya existencias.', queHacer: 'Revisa si el pedido sigue vigente o ciérralo.' },
]

export const MUESTRA_POR_REGLA = 10

export interface FilaDeHallazgo {
  companyId: string
  empresa: string
  /** Lo que identifica el caso: el código del pedido, el número de asiento, la oferta… */
  referencia: string
  detalle: string
}

export interface Hallazgo {
  regla: Regla
  /** Cuántos casos hay (no solo los de la muestra). */
  total: number
  muestra: FilaDeHallazgo[]
}

export interface ResumenDeConciliacion {
  reglas: number
  reglasConHallazgos: number
  casos: number
  porSeveridad: Record<Severidad, number>
}

export function resumirConciliacion(h: readonly Hallazgo[]): ResumenDeConciliacion {
  const porSeveridad: Record<Severidad, number> = { ALTA: 0, MEDIA: 0, BAJA: 0 }
  let casos = 0
  let conHallazgos = 0
  for (const x of h) {
    if (x.total > 0) {
      conHallazgos++
      casos += x.total
      porSeveridad[x.regla.severidad] += x.total
    }
  }
  return { reglas: h.length, reglasConHallazgos: conHallazgos, casos, porSeveridad }
}

const PESO: Record<Severidad, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 }

/** Los hallazgos en el orden en que conviene leerlos: primero lo grave y, dentro, lo que más casos tiene. */
export function ordenarHallazgos<T extends Hallazgo>(h: readonly T[]): T[] {
  return [...h].sort((a, b) => PESO[a.regla.severidad] - PESO[b.regla.severidad] || b.total - a.total || a.regla.codigo.localeCompare(b.regla.codigo))
}

export const ETIQUETA_SEVERIDAD: Readonly<Record<Severidad, string>> = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Informativa' }
