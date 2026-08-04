import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { registrarTransicionCompra } from '@/modules/promociones/compra'
import { activarCompraPromocion } from '@/modules/pagos/activacionCompra'
import { anotarFallo } from '@/lib/prisma-errors'

/**
 * CAMPAÑAS EN CADENA — marketing cruzado entre empresas aliadas.
 *
 * Ejemplo real: carwash + restaurante. Paso 1 = lavado gratis en el carwash;
 * paso 2 = 20% en desayuno en el restaurante. El cliente recibe el paso 1 al
 * inscribirse y, en cuanto lo USA POR PRIMERA VEZ, se le entrega el paso 2 en
 * la otra empresa. Cada visita empuja al cliente hacia el siguiente negocio.
 *
 * POR QUÉ AL PRIMER USO Y NO AL AGOTARLO: el desbloqueo debe sentirse como una
 * recompensa inmediata por haber ido. Si el beneficio trae varios usos y hay
 * que gastarlos todos, la recompensa llega semanas después y se pierde el
 * vínculo entre visitar un negocio y ganar algo en el otro. Entregar dos veces
 * es imposible: `entregarPaso` detecta que el eslabón ya existe.
 *
 * EL PUENTE ENTRE EMPRESAS: `Cliente` es una fila POR EMPRESA
 * (`@@unique([supabaseId, companyId])`), así que el cliente del carwash no
 * "existe" en el restaurante. Para entregarle el paso 2 se busca —o se crea—
 * su ficha en la empresa destino usando su `supabaseId`, que es lo que
 * identifica a la persona entre empresas. No se inventa un cliente: se copia
 * su identidad real a la empresa aliada, que es justo lo que la campaña
 * promete a ese negocio (clientes nuevos).
 *
 * REGLA DE ORO: la cadena JAMÁS debe romper un canje. Todo aquí se ejecuta
 * después de que el canje ya está confirmado, y cualquier fallo se registra
 * sin propagarse (fail-open).
 */

export interface ResultadoAvance {
  /** Se entregó un paso nuevo. */
  entregado?: { pasoOrden: number; compraId: string; companyName: string; titulo: string }
  /** El cliente terminó la cadena completa. */
  completada?: boolean
  /** No había nada que hacer (la compra no venía de una campaña en cadena). */
  sinCambios?: boolean
  error?: string
}

/**
 * Busca la ficha del cliente en la empresa destino; si no existe, la crea a
 * partir de su identidad real. Devuelve el id del `Cliente` en esa empresa.
 */
async function fichaEnEmpresa(
  supabaseId: string,
  companyId: string,
  datos: { nombre: string; email: string; telefono: string | null }
): Promise<string> {
  return conEmpresa(companyId, async (tx) => {
    const existente = await tx.cliente.findUnique({
      where: { supabaseId_companyId: { supabaseId, companyId } },
      select: { id: true },
    })
    if (existente) return existente.id

    const creado = await tx.cliente.create({
      data: {
        supabaseId,
        companyId,
        nombre: datos.nombre,
        email: datos.email,
        telefono: datos.telefono,
        canalOrigen: 'CAMPANA_CONJUNTA',
      },
      select: { id: true },
    })
    return creado.id
  })
}

/**
 * Entrega el beneficio de un paso a un cliente: crea la compra en la empresa
 * de ese paso y la activa (QR inmediato). Devuelve el id de la compra.
 */
export async function entregarPaso(
  pasoId: string,
  supabaseId: string,
  datos: { nombre: string; email: string; telefono: string | null }
): Promise<
  | { compraId: string; titulo: string; companyName: string; yaExistia: boolean }
  | { error: string }
> {
  const paso = await sinEmpresa('campanas: paso de campaña por id (cross-tenant)', (tx) =>
    tx.campanaPaso.findUnique({
      where: { id: pasoId },
      include: {
        company: { select: { name: true } },
        campana: { select: { estado: true } },
      },
    })
  )
  if (!paso) return { error: 'Paso de campaña no encontrado.' }
  if (!paso.promocionId) {
    return { error: 'Este paso aún no se ha aplicado en su empresa.' }
  }
  if (paso.campana.estado === 'ARCHIVADA') {
    return { error: 'La campaña está archivada.' }
  }

  const promo = await conEmpresa(paso.companyId, (tx) =>
    tx.promocion.findUnique({
      where: { id: paso.promocionId },
      select: { id: true, companyId: true, precio: true, usosPorCompra: true, activo: true },
    })
  )
  if (!promo || !promo.activo) {
    return { error: 'El beneficio de este paso ya no está disponible.' }
  }

  const clienteId = await fichaEnEmpresa(supabaseId, paso.companyId, datos)

  // Un paso no se entrega dos veces al mismo cliente.
  const yaLoTiene = await conEmpresa(paso.companyId, (tx) =>
    tx.productoCompra.findFirst({
      where: {
        campanaPasoId: paso.id,
        clienteId,
        estado: { notIn: ['CANCELADA', 'RECHAZADA'] },
      },
      select: { id: true },
    })
  )
  if (yaLoTiene) {
    // Ya se lo habíamos entregado (p. ej. un segundo uso del mismo beneficio):
    // no se duplica y se avisa para no volver a anunciar el desbloqueo.
    return {
      compraId: yaLoTiene.id,
      titulo: paso.titulo,
      companyName: paso.company.name,
      yaExistia: true,
    }
  }

  const compra = await conEmpresa(paso.companyId, async (tx) => {
    const creada = await tx.productoCompra.create({
      data: {
        tipo: 'PROMOCION',
        estado: 'SOLICITADA',
        companyId: paso.companyId,
        clienteId,
        promocionId: promo.id,
        campanaPasoId: paso.id,
        // Los pasos de una cadena son siempre un beneficio, no una venta.
        precioCongelado: 0,
        usosIncluidos: promo.usosPorCompra,
      },
    })
    await registrarTransicionCompra(tx, {
      compraId: creada.id,
      desde: null,
      hacia: 'SOLICITADA',
      motivo: `Campaña conjunta · paso ${paso.orden}`,
      userId: null,
    })
    return creada
  })

  const res = await activarCompraPromocion(compra.id, null, { ipAddress: null, userAgent: null }, {
    motivo: `Campaña conjunta: paso ${paso.orden} desbloqueado`,
  })
  if (!res.ok) return { error: res.error }

  return {
    compraId: compra.id,
    titulo: paso.titulo,
    companyName: paso.company.name,
    yaExistia: false,
  }
}

/**
 * Inscribe a un cliente en una campaña en cadena y le entrega el primer paso.
 * Idempotente: si ya está inscrito, devuelve su estado actual sin duplicar.
 */
export async function inscribirEnCadena(
  campanaId: string,
  supabaseId: string,
  datos: { nombre: string; email: string; telefono: string | null }
): Promise<ResultadoAvance> {
  try {
    const campana = await sinEmpresa('campanas: campaña global por id (cross-tenant)', (tx) =>
      tx.campanaGlobal.findUnique({
        where: { id: campanaId },
        select: {
          id: true,
          modo: true,
          estado: true,
          pasos: { orderBy: { orden: 'asc' }, select: { id: true, orden: true, companyId: true } },
        },
      })
    )
    if (!campana) return { error: 'Campaña no encontrada.' }
    if (campana.modo !== 'CADENA') return { error: 'Esta campaña no es en cadena.' }
    if (campana.estado !== 'APLICADA') {
      return { error: 'La campaña todavía no está disponible.' }
    }
    const primero = campana.pasos[0]
    if (!primero) return { error: 'La campaña no tiene pasos configurados.' }

    // La inscripción vive contra la ficha del cliente en la empresa del paso 1.
    const clienteId = await fichaEnEmpresa(supabaseId, primero.companyId, datos)

    const inscripcion = await conEmpresa(primero.companyId, (tx) =>
      tx.campanaInscripcion.upsert({
        where: { campanaId_clienteId: { campanaId, clienteId } },
        create: { campanaId, clienteId, pasoActual: primero.orden },
        update: {},
        select: { id: true, pasoActual: true, estado: true },
      })
    )
    if (inscripcion.estado === 'COMPLETADA') return { completada: true }

    const entrega = await entregarPaso(primero.id, supabaseId, datos)
    if ('error' in entrega) return { error: entrega.error }
    if (entrega.yaExistia) return { sinCambios: true }

    return {
      entregado: {
        pasoOrden: primero.orden,
        compraId: entrega.compraId,
        companyName: entrega.companyName,
        titulo: entrega.titulo,
      },
    }
  } catch (e) {
    console.error('[campañas cadena] inscribir:', e)
    return { error: 'No se pudo unir a la campaña. Intenta de nuevo.' }
  }
}

/**
 * Se llama DESPUÉS de que un canje quedó confirmado. Si la compra canjeada era
 * un eslabón de una cadena, entrega el siguiente paso al mismo cliente en la
 * empresa aliada.
 *
 * Nunca lanza: un fallo aquí no puede deshacer un canje ya cobrado.
 */
export async function avanzarCadenaTrasCanje(compraId: string): Promise<ResultadoAvance> {
  try {
    const compra = await sinEmpresa('campanas: compra por id para avanzar cadena (cross-tenant)', (tx) =>
      tx.productoCompra.findUnique({
        where: { id: compraId },
        select: {
          campanaPasoId: true,
          cliente: { select: { supabaseId: true, nombre: true, email: true, telefono: true } },
        },
      })
    )
    if (!compra?.campanaPasoId || !compra.cliente) return { sinCambios: true }

    const paso = await sinEmpresa('campanas: paso por id (cross-tenant)', (tx) =>
      tx.campanaPaso.findUnique({
        where: { id: compra.campanaPasoId },
        select: { orden: true, campanaId: true, companyId: true },
      })
    )
    if (!paso) return { sinCambios: true }

    const siguiente = await sinEmpresa('campanas: siguiente paso de la cadena (cross-tenant)', (tx) =>
      tx.campanaPaso.findFirst({
        where: { campanaId: paso.campanaId, orden: { gt: paso.orden } },
        orderBy: { orden: 'asc' },
        select: { id: true, orden: true, companyId: true },
      })
    )

    const datos = {
      nombre: compra.cliente.nombre,
      email: compra.cliente.email,
      telefono: compra.cliente.telefono,
    }

    // La inscripción se identifica por la ficha del cliente en la empresa del
    // paso que acaba de canjear.
    const clienteAqui = await conEmpresa(paso.companyId, (tx) =>
      tx.cliente.findUnique({
        where: {
          supabaseId_companyId: { supabaseId: compra.cliente.supabaseId, companyId: paso.companyId },
        },
        select: { id: true },
      })
    )

    if (!siguiente) {
      // Era el último eslabón: la cadena queda completada.
      if (clienteAqui) {
        await conEmpresa(paso.companyId, (tx) =>
          tx.campanaInscripcion.updateMany({
            where: { campanaId: paso.campanaId, clienteId: clienteAqui.id },
            data: { estado: 'COMPLETADA', completadaAt: new Date() },
          })
        ).catch(anotarFallo('campanas:campanaInscripcion.updateMany'))
      }
      return { completada: true }
    }

    const entrega = await entregarPaso(siguiente.id, compra.cliente.supabaseId, datos)
    if ('error' in entrega) {
      console.error('[campañas cadena] no se pudo entregar el paso siguiente:', entrega.error)
      return { error: entrega.error }
    }
    // Usos posteriores del mismo beneficio: el siguiente eslabón ya se entregó
    // en el primer canje, así que no hay nada nuevo que anunciar.
    if (entrega.yaExistia) return { sinCambios: true }

    if (clienteAqui) {
      await conEmpresa(paso.companyId, (tx) =>
        tx.campanaInscripcion.updateMany({
          where: { campanaId: paso.campanaId, clienteId: clienteAqui.id },
          data: { pasoActual: siguiente.orden },
        })
      ).catch(anotarFallo('campanas:campanaInscripcion.updateMany'))
    }

    return {
      entregado: {
        pasoOrden: siguiente.orden,
        compraId: entrega.compraId,
        companyName: entrega.companyName,
        titulo: entrega.titulo,
      },
    }
  } catch (e) {
    // Fail-open deliberado: el canje ya ocurrió y es lo que importa.
    console.error('[campañas cadena] avanzar tras canje:', e)
    return { error: 'No se pudo desbloquear el siguiente beneficio.' }
  }
}

/**
 * Engancha una compra recién creada a la cadena, SI la promoción que el
 * cliente acaba de adquirir es el primer eslabón de una campaña.
 *
 * Gracias a esto el cliente NO necesita una pantalla especial para "unirse":
 * toma el lavado gratis del carwash como cualquier otra promoción y queda
 * inscrito; al canjearlo aparece solo el beneficio del restaurante.
 *
 * Fail-open: si algo falla, la compra normal sigue siendo válida.
 */
export async function vincularCompraSiEsPaso(
  compraId: string,
  promocionId: string,
  clienteId: string
): Promise<void> {
  try {
    const paso = await sinEmpresa('campanas: paso por promoción (cross-tenant)', (tx) =>
      tx.campanaPaso.findFirst({
        where: { promocionId },
        select: { id: true, orden: true, campanaId: true, campana: { select: { modo: true, estado: true } } },
      })
    )
    if (!paso || paso.campana.modo !== 'CADENA' || paso.campana.estado !== 'APLICADA') return

    await conEmpresa(paso.companyId, (tx) =>
      tx.productoCompra.update({
        where: { id: compraId },
        data: { campanaPasoId: paso.id },
      })
    )

    // Solo el primer eslabón inscribe; los siguientes ya llegan por la cadena.
    if (paso.orden === 1) {
      await conEmpresa(paso.companyId, (tx) =>
        tx.campanaInscripcion.upsert({
          where: { campanaId_clienteId: { campanaId: paso.campanaId, clienteId } },
          create: { campanaId: paso.campanaId, clienteId, pasoActual: 1 },
          update: {},
        })
      )
    }
  } catch (e) {
    console.error('[campañas cadena] vincular compra:', e)
  }
}
