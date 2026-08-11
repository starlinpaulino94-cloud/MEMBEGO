import type { MembegoClient } from '@membego/platform-sdk'
import type { AlmacenProyeccion } from './proyeccion'

/**
 * LA OPERACIÓN DEL RESTAURANTE — mesas, comandas y el momento en que se aplica
 * un beneficio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE ESTÁ LA FRONTERA
 *
 * Mesas y comandas son del restaurante: MembeGo no sabe que existen y no tiene
 * por qué. Clientes, membresías y beneficios son del Core: aquí no se crean ni
 * se calculan, se PIDEN.
 *
 * La frontera no está en qué tabla vive cada cosa. Está en quién decide. Este
 * archivo es donde eso se nota.
 */

export interface ComandaAbierta {
  id: string
  mesaId: string
  customerId: string | null
}

/** Lo que la operación necesita de la base propia, sin atarse a Prisma. */
export interface AlmacenOperacion extends AlmacenProyeccion {
  abrirComanda(mesaId: string): Promise<ComandaAbierta>
  asignarCliente(comandaId: string, customerId: string): Promise<void>
  cerrarComanda(
    comandaId: string,
    totalCentavos: number,
    redemptionId: string | null
  ): Promise<void>
}

/**
 * IDENTIFICAR A QUIEN ESTÁ EN LA MESA.
 *
 * El camarero teclea un teléfono. Se pregunta al Core: la identidad es suya.
 *
 * Si no existe, se da de alta —también en el Core, con `createCustomer`— y no
 * aquí. Un satélite que crea su propia ficha de cliente se vuelve dueño de la
 * identidad, y a partir de ahí la misma persona son dos personas distintas
 * según por qué puerta entró (§14 del informe de arquitectura).
 *
 * La clave de idempotencia identifica LA MESA Y EL TURNO, no la llamada HTTP:
 * si el proceso se reinicia entre el envío y la respuesta, el reintento tiene
 * que llegar con la misma clave o se abre una segunda ficha de alguien que solo
 * dijo su nombre.
 */
export async function identificarEnMesa(
  membego: MembegoClient,
  companyId: string,
  entrada: { telefono?: string; nombre?: string },
  claveTurno: string
): Promise<{ customerId: string; creado: boolean }> {
  if (entrada.telefono) {
    const encontrado = await membego
      .resolveCustomer(companyId, { phone: entrada.telefono })
      .catch(() => null)
    if (encontrado) return { customerId: encontrado.id, creado: false }
  }

  const alta = await membego.createCustomer(
    {
      companyId,
      name: entrada.nombre ?? 'Cliente de mesa',
      ...(entrada.telefono ? { phone: entrada.telefono } : {}),
    },
    claveTurno
  )
  return { customerId: alta.customer.id, creado: alta.created }
}

/**
 * QUÉ BENEFICIOS TIENE — para ENSEÑARLOS.
 *
 * Va al Core aunque la copia local tenga al cliente. La copia sabe cómo se
 * llama; no sabe qué le queda, y no debe saberlo (ver `proyeccion.ts`).
 *
 * Si el Core no responde, se devuelve lista vacía en vez de reventar: el
 * restaurante tiene que poder seguir sirviendo comida cuando MembeGo está
 * caído. Lo que NO se hace es inventarse un beneficio para salir del paso.
 */
export async function beneficiosParaMostrar(
  membego: MembegoClient,
  companyId: string,
  customerId: string
): Promise<{ beneficios: unknown[]; degradado: boolean }> {
  try {
    const r = await membego.evaluateBenefits({ companyId, customerId })
    return { beneficios: r.benefits ?? [], degradado: false }
  } catch {
    // `degradado` no es decorativo: la pantalla tiene que poder decir «no se
    // pudo consultar» en vez de «no tiene beneficios», que son cosas
    // distintas y una de ellas hace que el cliente se vaya molesto.
    return { beneficios: [], degradado: true }
  }
}

export interface ResultadoCobro {
  comandaId: string
  redemptionId: string | null
  /** El canje no se pudo aplicar y la comanda se cobró completa. */
  canjeRechazado?: string
}

/**
 * COBRAR LA COMANDA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AQUÍ ES DONDE LA COPIA NO SE USA
 *
 * Aunque la proyección diga que el cliente es socio Premium, el canje se pide
 * al Core. Si el Core dice que no —ya lo gastó, la membresía venció, otro local
 * se le adelantó hace cinco minutos—, se cobra completo y se dice por qué.
 *
 * Un canje decidido con la copia local se descubre cuadrando caja, días
 * después, sin saber a quién se le regaló qué.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CLAVE DE IDEMPOTENCIA ES LA COMANDA
 *
 * No la llamada, no un uuid nuevo, no la hora. Si el cobro se reintenta —porque
 * la respuesta se perdió, porque el camarero volvió a pulsar— tiene que llegar
 * la MISMA clave, o se consume el beneficio dos veces por una comida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN IMPORTA: PRIMERO EL CANJE, DESPUÉS EL CIERRE
 *
 * Cerrando primero, un fallo del canje deja la comanda cobrada como si se
 * hubiera aplicado el beneficio. Al revés, un fallo del cierre deja un canje
 * consumido y una comanda abierta — visible, y arreglable por quien esté en el
 * mostrador. De los dos desastres, este avisa.
 */
export async function cobrarComanda(
  membego: MembegoClient,
  almacen: AlmacenOperacion,
  comanda: {
    id: string
    companyId: string
    customerId: string | null
    totalCentavos: number
    /** Membresía contra la que se aplica el beneficio, si el cliente eligió. */
    membershipId?: string | null
    servicio?: string
  }
): Promise<ResultadoCobro> {
  let redemptionId: string | null = null
  let canjeRechazado: string | undefined

  if (comanda.customerId && comanda.membershipId) {
    try {
      const r = await membego.redeem(
        {
          companyId: comanda.companyId,
          membershipId: comanda.membershipId,
          servicio: comanda.servicio ?? 'Consumo en mesa',
        },
        `comanda-${comanda.id}`
      )
      redemptionId = r.redemptionId
    } catch (e) {
      canjeRechazado = e instanceof Error ? e.message : 'No se pudo aplicar el beneficio.'
    }
  }

  await almacen.cerrarComanda(comanda.id, comanda.totalCentavos, redemptionId)

  // La venta se registra DESPUÉS de cerrar y sin bloquear: es información para
  // el Core, no una condición para cobrar. Si esto falla, el cliente ya pagó y
  // la comanda ya está cerrada; lo que se pierde es una fila de analítica, no
  // dinero. Bloquear el cobro por esto sería dejar de facturar porque un
  // sistema de informes no responde.
  membego
    .recordTransaction(
      {
        companyId: comanda.companyId,
        customerId: comanda.customerId ?? undefined,
        amount: comanda.totalCentavos,
        description: comanda.servicio ?? 'Consumo en mesa',
        // La referencia del restaurante, para que un informe del Core se pueda
        // cruzar con la comanda sin adivinar por hora e importe.
        externalId: `comanda-${comanda.id}`,
      },
      `venta-comanda-${comanda.id}`
    )
    .catch((e) => console.error('[restaurant] no se registró la venta en MembeGo:', e))

  return { comandaId: comanda.id, redemptionId, canjeRechazado }
}
