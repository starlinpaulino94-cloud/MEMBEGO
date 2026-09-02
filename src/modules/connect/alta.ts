import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { anotarConector } from '@/modules/connect/bitacora'
import { metadatosCredencial } from '@/modules/connect/credenciales'
import { listarCalendarios, validarCalendario } from '@/modules/connect/googleCalendar'
import { proveedorDe } from '@/modules/connect/proveedores/indice'
import type { DefinicionProveedor, PasoConexion } from '@/modules/connect/proveedores/tipos'
import {
  altaCompleta,
  altaVacia,
  conRespuesta,
  guionCaducado,
  leerEstadoAlta,
  pasoActual,
  pasosVisitables,
  progreso,
  type EstadoAlta,
  type HechosAlta,
  type Progreso,
} from '@/modules/connect/altaNucleo'

/**
 * EL ALTA GUIADA · capa de servidor (Connect · Fase 12).
 *
 * Junta lo puro (`altaNucleo.ts`, que decide en qué paso estamos) con lo que
 * solo se sabe consultando: si hay credencial guardada, qué calendarios tiene
 * la cuenta, si la validación pasa.
 *
 * NINGUNA de estas funciones comprueba sesión. La autorización vive en las
 * acciones de servidor que las llaman, igual que en el resto del módulo, y el
 * `companyId` sale SIEMPRE de la sesión — nunca del formulario.
 */

export interface VistaAlta {
  conexionId: string
  def: DefinicionProveedor
  estado: EstadoAlta
  hechos: HechosAlta
  /** Null = ya no queda nada por contestar. */
  paso: PasoConexion | null
  progreso: Progreso
  visitables: PasoConexion[]
  completa: boolean
}

async function filaConexion(companyId: string, slug: string) {
  return conEmpresa(companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { companyId, conector: { slug } },
      select: { id: true, estado: true, setupState: true, config: true },
    })
  )
}

/**
 * DÓNDE VA EL ALTA de una empresa. Null si no hay conexión empezada o si el
 * proveedor no existe.
 *
 * Si el guion cambió desde que empezó (versión distinta), el estado se
 * descarta y se empieza de nuevo: arrastrar respuestas de un guion viejo a
 * unos pasos nuevos es cómo se acaba guardando una configuración que nadie
 * pidió.
 */
export async function vistaDelAlta(companyId: string, slug: string): Promise<VistaAlta | null> {
  const def = proveedorDe(slug)
  if (!def || def.clase !== 'NATIVA') return null

  const fila = await filaConexion(companyId, slug)
  if (!fila) return null

  const leido = leerEstadoAlta(fila.setupState)
  const estado = leido && !guionCaducado(def, leido) ? leido : altaVacia(def.versionAlta)

  // LO DECLARA EL PROVEEDOR, no se deduce del tipo de autorización. Deducirlo
  // rompía el alta incrustada de Meta: autoriza por OAuth y guarda una clave.
  const meta = await metadatosCredencial({
    companyId,
    conexionId: fila.id,
    tipo: def.tipoCredencial,
  })

  const hechos: HechosAlta = {
    autorizado: meta !== null,
    validado: estado.datos.validacion === true,
  }

  return {
    conexionId: fila.id,
    def,
    estado,
    hechos,
    paso: pasoActual(def, estado, hechos),
    progreso: progreso(def, estado, hechos),
    visitables: pasosVisitables(def, estado, hechos),
    completa: altaCompleta(def, estado, hechos),
  }
}

/** Guarda la respuesta de un paso. No decide nada: el paso actual se deduce. */
export async function responderPaso(input: {
  companyId: string
  slug: string
  pasoId: string
  valor: unknown
}): Promise<{ ok: boolean }> {
  const vista = await vistaDelAlta(input.companyId, input.slug)
  if (!vista) return { ok: false }

  // Solo se contesta un paso que EXISTE en el guion. Sin esto, un formulario
  // manipulado podría meter claves arbitrarias en el estado del alta.
  if (!vista.def.pasos().some((p) => p.id === input.pasoId)) return { ok: false }

  const nuevo = conRespuesta(vista.estado, input.pasoId, input.valor)
  await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.update({
      where: { id: vista.conexionId },
      // `setupState` y NUNCA `config`: esto es progreso, no configuración.
      data: { setupState: nuevo as object },
    })
  )
  return { ok: true }
}

/**
 * RETROCEDER: olvida la respuesta de un paso.
 *
 * Con el paso actual deducido de lo cumplido, «volver» no es mover un cursor
 * —no hay cursor— sino BORRAR lo que se contestó en aquel paso. El asistente
 * lo recalcula y aterriza allí solo.
 *
 * No se puede retroceder a un paso de autorización ya cumplido: borrar su
 * respuesta no revocaría la credencial, así que enseñaría un botón de conectar
 * sobre una cuenta ya conectada. Deshacer eso es DESCONECTAR, que es otra
 * acción y tiene su propia confirmación.
 */
export async function olvidarPaso(input: {
  companyId: string
  slug: string
  pasoId: string
}): Promise<{ ok: boolean }> {
  const vista = await vistaDelAlta(input.companyId, input.slug)
  if (!vista) return { ok: false }

  const paso = vista.def.pasos().find((p) => p.id === input.pasoId)
  if (!paso || paso.tipo === 'AUTORIZACION') return { ok: false }
  if (!vista.visitables.some((p) => p.id === input.pasoId)) return { ok: false }

  const datos = { ...vista.estado.datos }
  delete datos[input.pasoId]
  // La validación deja de valer en cuanto se cambia algo anterior: lo que se
  // comprobó era sobre las respuestas de entonces.
  delete datos.validacion

  await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.update({
      where: { id: vista.conexionId },
      data: { setupState: { ...vista.estado, datos } as object },
    })
  )
  return { ok: true }
}

/**
 * OPCIONES de un paso de elección. Es la ÚNICA costura específica de proveedor
 * en el servidor del asistente, y se deja a la vista en vez de esconderla: un
 * `switch` que se lee es mejor que una indirección que hay que perseguir.
 */
export async function opcionesDelPaso(input: {
  companyId: string
  slug: string
  conexionId: string
  pasoId: string
}): Promise<{ ok: true; opciones: OpcionPaso[] } | { ok: false; detalle: string }> {
  if (input.slug === 'google-calendar' && input.pasoId === 'calendario') {
    const lista = await listarCalendarios({
      companyId: input.companyId,
      conexionId: input.conexionId,
    })
    if (!lista.ok) return { ok: false, detalle: lista.detalle }
    return {
      ok: true,
      opciones: lista.calendarios.map((c) => ({
        valor: c.id,
        etiqueta: c.nombre,
        nota: c.principal ? 'Tu calendario principal' : null,
        // Un calendario de solo lectura (los festivos del país, uno
        // compartido) se ENSEÑA deshabilitado en vez de ocultarse: quien lo
        // busca y no lo encuentra cree que la lista está mal.
        deshabilitada: !c.puedeEscribir,
        motivo: c.puedeEscribir ? null : 'Solo puedes verlo, no escribir en él',
      })),
    }
  }
  return { ok: true, opciones: [] }
}

export interface OpcionPaso {
  valor: string
  etiqueta: string
  nota: string | null
  deshabilitada: boolean
  motivo: string | null
}

/** Resultado de la validación, en el vocabulario del asistente. */
export interface ResultadoPasoValidacion {
  ok: boolean
  comprobaciones: { clave: string; titulo: string; ok: boolean; detalle: string }[]
  detalle?: string
}

/**
 * VALIDA la conexión. NO escribe nada en la cuenta del cliente: comprueba la
 * credencial, el refresco, los permisos concedidos, que la lista responde y
 * que el calendario elegido admite escritura.
 */
export async function validarAlta(input: {
  companyId: string
  slug: string
}): Promise<ResultadoPasoValidacion> {
  const vista = await vistaDelAlta(input.companyId, input.slug)
  if (!vista) return { ok: false, comprobaciones: [], detalle: 'No encontramos la conexión.' }

  if (input.slug === 'google-calendar') {
    const calendarId = vista.estado.datos.calendario
    if (typeof calendarId !== 'string') {
      return { ok: false, comprobaciones: [], detalle: 'Falta elegir el calendario.' }
    }
    const res = await validarCalendario({
      companyId: input.companyId,
      conexionId: vista.conexionId,
      calendarId,
    })
    if (res.ok) {
      await responderPaso({
        companyId: input.companyId,
        slug: input.slug,
        pasoId: 'validacion',
        valor: true,
      })
    }
    return { ok: res.ok, comprobaciones: res.comprobaciones }
  }

  return { ok: false, comprobaciones: [], detalle: 'Esta integración no tiene validación.' }
}

/**
 * CIERRA EL ALTA (regla B de la decisión 2):
 *
 *   config       ← lo que el proveedor considere permanente
 *   setupState   ← null. Nada de progreso residual tras una conexión completa.
 *   setupVersion ← la versión del guion con la que se terminó
 *   estado       ← CONNECTED
 *
 * Se niega si queda algún paso sin contestar: el botón de terminar solo
 * aparece cuando no queda ninguno, y esta comprobación es la que hace que eso
 * sea una regla y no una decisión de la pantalla.
 */
export async function terminarAlta(input: {
  companyId: string
  slug: string
}): Promise<{ ok: boolean; motivo?: 'sin_alta' | 'incompleta' }> {
  const vista = await vistaDelAlta(input.companyId, input.slug)
  if (!vista) return { ok: false, motivo: 'sin_alta' }
  if (!vista.completa) return { ok: false, motivo: 'incompleta' }

  const config = vista.def.configDesdeAlta?.(vista.estado.datos) ?? {}

  await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.update({
      where: { id: vista.conexionId },
      data: {
        config: config as object,
        // `Prisma.DbNull` y NO `undefined`: en Prisma, `undefined` significa
        // «no toques este campo», que es exactamente lo contrario de lo que
        // hace falta aquí. Con `undefined` el progreso del alta sobreviviría a
        // la conexión terminada — el residuo que la regla B prohíbe.
        setupState: Prisma.DbNull,
        setupVersion: vista.def.versionAlta,
        estado: 'CONNECTED',
        ultimoOkAt: new Date(),
        ultimoError: null,
        claseError: null,
      },
    })
  )

  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: vista.conexionId,
    evento: 'conexion.configurada',
    detalle: { conector: input.slug, versionAlta: vista.def.versionAlta },
  })

  return { ok: true }
}

/**
 * LA CONFIGURACIÓN de una conexión terminada, en etiquetas legibles.
 *
 * Enseñar el JSON crudo sería enseñar `calendarId: "abc@group.calendar.google.com"`,
 * que no le dice nada a quien eligió «Agenda del salón» en una lista.
 */
export async function configuracionVisible(
  companyId: string,
  slug: string
): Promise<{ etiqueta: string; valor: string }[]> {
  const fila = await filaConexion(companyId, slug)
  if (!fila || fila.estado !== 'CONNECTED') return []
  const config =
    fila.config && typeof fila.config === 'object' && !Array.isArray(fila.config)
      ? (fila.config as Record<string, unknown>)
      : {}

  if (slug === 'google-calendar') {
    const filas: { etiqueta: string; valor: string }[] = []
    if (typeof config.calendarId === 'string') {
      // Se pide el nombre al proveedor en vez de guardarlo: un nombre copiado
      // se queda viejo en cuanto alguien renombra el calendario en Google.
      const lista = await listarCalendarios({ companyId, conexionId: fila.id })
      const nombre = lista.ok
        ? (lista.calendarios.find((c) => c.id === config.calendarId)?.nombre ?? config.calendarId)
        : config.calendarId
      filas.push({ etiqueta: 'Calendario', valor: nombre })
    }
    filas.push({
      etiqueta: 'Citas confirmadas',
      valor: config.sincronizarConfirmadas === false ? 'No se llevan' : 'Se llevan al calendario',
    })
    return filas
  }

  return []
}
