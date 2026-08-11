import type { SobreEvento } from '@membego/platform-sdk'

/**
 * LA PROYECCIÓN LOCAL — y la regla que decide si esto es una plataforma o un
 * desastre repartido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ SIRVE UNA COPIA
 *
 * El camarero teclea un teléfono y tiene que ver «Ana, socia Premium» ANTES de
 * que termine de teclear el siguiente. Ir al Core en cada tecla es lento, y si
 * MembeGo tarda o no responde, el restaurante deja de funcionar por algo que no
 * es suyo.
 *
 * Por eso hay copia. Y por eso la copia tiene un límite muy concreto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA COPIA MUESTRA. NO DECIDE.
 *
 * Un beneficio se consume contra el Core, por HTTP, siempre. Nunca contra esta
 * copia.
 *
 * Si se decidiera aquí, bastaría un webhook perdido —o simplemente lento— para
 * regalar un beneficio que ya se gastó en otro local hace cinco minutos. Nadie
 * lo notaría en el momento: el camarero ve «le queda uno», lo aplica, el cliente
 * se va contento. Aparece al cuadrar caja, días después, sin forma de saber a
 * quién se le regaló qué.
 *
 * Esa es la razón de que `ClienteProyectado` no tenga saldos ni usos restantes.
 * No es que se hayan olvidado: es que tenerlos invitaría a usarlos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS EVENTOS NO LLEGAN EN ORDEN
 *
 * MembeGo reintenta lo que no responde. El segundo intento de un evento de las
 * 10:00 puede aterrizar después del primer intento de uno de las 10:05 — no es
 * un fallo, es cómo funciona cualquier reparto con reintentos.
 *
 * Aplicado sin mirar, el cliente «volvería» a su nombre anterior y nada
 * fallaría: no habría error, ni log, ni una fila mal formada. Solo un dato
 * viejo pisando a uno nuevo.
 *
 * Por eso se compara `occurredAt`, que el sobre define como CUÁNDO OCURRIÓ y no
 * cuándo se envió: los reintentos no lo mueven. Es el único campo del sobre con
 * el que se puede ordenar.
 */

/** Lo que la proyección necesita saber hacer, sin atarse a Prisma. */
export interface AlmacenProyeccion {
  /** `occurredAt` de la última versión guardada, o null si no hay fila. */
  vigenciaDe(customerId: string): Promise<Date | null>
  guardar(fila: ClienteProyectadoDatos): Promise<void>
}

export interface ClienteProyectadoDatos {
  customerId: string
  companyId: string
  nombre: string
  telefono: string | null
  email: string | null
  vigenteDesde: Date
}

export type ResultadoProyeccion =
  | { aplicado: true }
  | { aplicado: false; motivo: 'sin-cliente' | 'sin-datos' | 'evento-viejo' | 'tipo-ignorado' }

/**
 * Eventos que tocan la proyección del cliente. El resto —canjes, membresías,
 * referidos— se ignoran aquí a propósito: cambian cosas que esta copia no
 * guarda, y guardarlas sería empezar a tener saldos.
 */
const TIPOS_DE_CLIENTE = new Set(['customer.created', 'customer.updated'])

/** ¿Este texto sirve como valor, o es relleno? */
function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Aplica un evento a la proyección. Puro respecto al almacén: lo que decide es
 * QUÉ hacer, y el almacén lo hace.
 *
 * Devuelve por qué NO se aplicó cuando no se aplica. Un `void` aquí obligaría a
 * elegir entre no saber nada o registrar en log cada evento ignorado, que son
 * la mayoría.
 */
export async function aplicarEvento(
  almacen: AlmacenProyeccion,
  evento: SobreEvento
): Promise<ResultadoProyeccion> {
  if (!TIPOS_DE_CLIENTE.has(evento.eventType)) {
    return { aplicado: false, motivo: 'tipo-ignorado' }
  }
  if (!evento.customerId) return { aplicado: false, motivo: 'sin-cliente' }

  // El payload viene del Core y puede traer más campos de los que esta copia
  // guarda. Se toma lo que sirve y se ignora el resto: un satélite que exige
  // una forma exacta se rompe cada vez que el Core añade un campo.
  const datos = (evento.data?.cliente ?? evento.data) as Record<string, unknown>
  const nombre = texto(datos?.nombre) ?? texto(datos?.name)
  if (!nombre) return { aplicado: false, motivo: 'sin-datos' }

  const ocurrido = new Date(evento.occurredAt)
  const vigente = await almacen.vigenciaDe(evento.customerId)

  // ESTRICTAMENTE MAYOR. Con `>=`, dos eventos del mismo instante se aplicarían
  // los dos y el último en llegar ganaría — que es justo el no-determinismo que
  // esta comparación existe para quitar.
  if (vigente && ocurrido <= vigente) {
    return { aplicado: false, motivo: 'evento-viejo' }
  }

  await almacen.guardar({
    customerId: evento.customerId,
    companyId: evento.companyId,
    nombre,
    telefono: texto(datos?.telefono) ?? texto(datos?.phone),
    email: texto(datos?.email),
    vigenteDesde: ocurrido,
  })
  return { aplicado: true }
}

/**
 * CUÁNTO SE PUEDE FIAR UNO DE LA COPIA.
 *
 * Una proyección atrasada no avisa: se ve igual de bien que una al día. Esto
 * convierte el desfase en un número para poder enseñarlo en pantalla («datos de
 * hace 12 minutos») en vez de dejar que el camarero suponga que está al día.
 *
 * No bloquea nada. Bloquear por desfase dejaría al restaurante sin poder servir
 * por un problema de MembeGo, que es exactamente lo que la copia evita.
 */
export function desfase(vigenteDesde: Date | null, ahora = new Date()): number | null {
  if (!vigenteDesde) return null
  return Math.max(0, ahora.getTime() - vigenteDesde.getTime())
}
