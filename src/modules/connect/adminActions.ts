'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { appUrl } from '@/lib/site'
import {
  cambiarEstadoEntrante,
  crearEntrante,
  eliminarEntrante,
} from '@/modules/connect/entrantes'
import {
  archivarRegla,
  cambiarEstadoRegla,
  crearReglaHttp,
} from '@/modules/connect/reglasHttp'
import { crearClaveApi, revocarClaveApi } from '@/modules/connect/clavesApi'
import { crearConexion, desconectarConexion } from '@/modules/connect/registro'
import { conectarWhatsapp } from '@/modules/connect/whatsapp'
import { proveedorDe } from '@/modules/connect/proveedores/indice'
import {
  actualizarEventosSuscripcion,
  cambiarEstadoSuscripcion,
  crearSuscripcion,
  reenviarEntregaAhora,
  rotarSecretoSuscripcion,
} from '@/modules/connect/webhooks'
import { soloEventosConocidos } from '@/modules/connect/eventosSuscribibles'
import {
  entregaDeEmpresa,
  probarSuscripcion,
  type ResultadoPrueba,
} from '@/modules/connect/entregas'
import { MENSAJE_URL } from '@/modules/connect/webhooksNucleo'
import { SCOPES_POR_CAPABILITY } from '@membego/contracts'

/**
 * Acciones del panel de INTEGRACIONES de una empresa (Connect · Fase 4).
 *
 * Cada una empieza por `requireSection('integraciones', <función>)`, y ese
 * segundo argumento no es decorativo: es lo que hace que las funciones
 * listadas en `lib/auth/funciones.ts` sean interruptores REALES y no pintados.
 * La regla de honestidad del módulo de Permisos dice que solo se lista lo que
 * tiene guardia cableada; esto es el otro extremo de esa promesa.
 *
 * `requireSection` devuelve el usuario o null, y de él sale el `companyId`:
 * NUNCA se acepta uno del formulario. Un `companyId` que viaja por el
 * navegador es una sugerencia, no una autorización.
 */

export interface AccionState {
  error?: string
  success?: string
  /**
   * La clave recién creada, EN CLARO. Es la única vez que existe fuera del
   * hash, y por eso viaja de vuelta en el estado en vez de guardarse: si se
   * pierde, se rota.
   */
  claveNueva?: string
  /** El secreto de firma de un webhook recién creado. */
  secretoNuevo?: string
  /** Lo que respondió el servidor de la empresa al evento de prueba (A-4). */
  prueba?: ResultadoPrueba
}

/** Scopes que una empresa puede conceder a una clave suya. */
const SCOPES_PERMITIDOS = [...new Set(Object.values(SCOPES_POR_CAPABILITY).flat())]
  .filter((s) => s.endsWith(':read'))
  .sort()

/**
 * Solo scopes de LECTURA, y no por prudencia genérica: los recursos de
 * escritura de la API v1 exigen la credencial de un satélite (necesitan saber
 * qué sistema respalda un canje). Ofrecer aquí `benefits:redeem` sería listar
 * un permiso que la guardia va a rechazar después — un interruptor pintado.
 */
export async function scopesDisponibles(): Promise<string[]> {
  return SCOPES_PERMITIDOS
}

export async function crearClaveAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'clave_crear')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!nombre) return { error: 'Ponle un nombre para reconocerla después.' }

  const pedidos = formData.getAll('scopes').map(String)
  const scopes = pedidos.filter((s) => SCOPES_PERMITIDOS.includes(s))
  if (scopes.length === 0) return { error: 'Elige al menos un permiso.' }

  const res = await crearClaveApi({
    companyId: user.metadata.companyId,
    nombre,
    scopes,
    creadoPor: user.metadata.dbUserId ?? null,
  })
  if (!res.ok) {
    return {
      error:
        'Tu plan no incluye claves de API, o alcanzaste el máximo. Escríbenos para ampliarlo.',
    }
  }

  revalidatePath('/admin/integraciones')
  return {
    success: 'Clave creada. Cópiala ahora: no se puede volver a ver.',
    claveNueva: res.creada.clave,
  }
}

export async function revocarClaveAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'clave_revocar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta la clave.' }

  const res = await revocarClaveApi(user.metadata.companyId, id)
  if (!res.ok) return { error: 'Esa clave ya estaba revocada.' }

  revalidatePath('/admin/integraciones')
  return { success: 'Clave revocada. Deja de funcionar en la próxima llamada.' }
}

export async function crearWebhookAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_crear')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  const url = String(formData.get('url') ?? '').trim()
  if (!nombre) return { error: 'Ponle un nombre para reconocerlo después.' }

  const res = await crearSuscripcion({
    companyId: user.metadata.companyId,
    nombre,
    url,
    // Sin eventos elegidos = todos. Ver `suscripcionQuiere`.
    //
    // Se filtra contra el catálogo: un evento inventado no se guarda. Guardarlo
    // no daría error en ningún sitio — daría una suscripción que no recibe nada
    // y una tarde buscando por qué.
    eventos: soloEventosConocidos(formData.getAll('eventos').map(String)),
    creadoPor: user.metadata.dbUserId ?? null,
  })

  if (!res.ok) {
    if (res.motivo === 'url_invalida') return { error: MENSAJE_URL[res.detalle] }
    return {
      error: 'Tu plan no incluye webhooks, o alcanzaste el máximo. Escríbenos para ampliarlo.',
    }
  }

  revalidatePath('/admin/integraciones')
  return {
    success: 'Webhook creado. Guarda el secreto para verificar nuestras firmas.',
    secretoNuevo: res.secreto,
  }
}

export async function cambiarEstadoWebhookAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_estado')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  if (estado !== 'ACTIVE' && estado !== 'PAUSED') return { error: 'Estado no válido.' }

  const res = await cambiarEstadoSuscripcion(user.metadata.companyId, id, estado)
  if (!res.ok) return { error: 'No se pudo cambiar. Recarga la página.' }

  revalidatePath('/admin/integraciones')
  return {
    success:
      estado === 'ACTIVE'
        ? 'Webhook reactivado. Los próximos eventos se te entregarán.'
        : 'Webhook pausado. Dejamos de entregarte eventos hasta que lo reactives.',
  }
}

/**
 * CREAR UNA REGLA «cuando pase X, llama a Y» (hallazgo B-1).
 *
 * Un solo permiso para crear, pausar y archivar: las tres son la misma
 * facultad —decidir a quién llamamos y cuándo— y partirla en tres
 * interruptores sería pedirle a quien administra permisos que distinga cosas
 * que en la práctica van juntas.
 */
export async function crearReglaHttpAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'regla_http')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const res = await crearReglaHttp({
    companyId: user.metadata.companyId,
    nombre: String(formData.get('nombre') ?? ''),
    evento: String(formData.get('evento') ?? ''),
    metodo: String(formData.get('metodo') ?? 'POST'),
    url: String(formData.get('url') ?? ''),
    cabeceras: cabecerasDelFormulario(formData),
    cuerpo: String(formData.get('cuerpo') ?? ''),
  })

  if (!res.ok) {
    if (res.motivo === 'sin_nombre') return { error: 'Ponle un nombre para reconocerla después.' }
    if (res.motivo === 'sin_evento') return { error: 'Elige qué evento la dispara.' }
    return { error: res.detalle ?? 'No se pudo crear la regla.' }
  }

  revalidatePath('/admin/integraciones')
  return { success: 'Regla creada y activa. La próxima vez que ocurra ese evento, llamaremos.' }
}

/**
 * Las cabeceras vienen como filas paralelas `cabeceraNombre[]` / `cabeceraValor[]`.
 *
 * Se recorren por índice y no con `Object.fromEntries` sobre pares sueltos: si
 * un nombre llegara sin su valor, emparejarlos por posición deja el hueco
 * vacío, mientras que reconstruirlos a ciegas desplazaría todos los siguientes
 * — y una cabecera de autorización con el valor de otra es un fallo que solo se
 * ve en el servidor del otro lado.
 */
function cabecerasDelFormulario(formData: FormData): Record<string, string> {
  const nombres = formData.getAll('cabeceraNombre').map(String)
  const valores = formData.getAll('cabeceraValor').map(String)
  const out: Record<string, string> = {}
  for (let i = 0; i < nombres.length; i++) {
    const n = nombres[i]?.trim()
    const v = valores[i]?.trim()
    if (n && v) out[n] = v
  }
  return out
}

/** Pausa o reactiva una regla. */
export async function cambiarEstadoReglaAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'regla_http')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  if (estado !== 'PUBLISHED' && estado !== 'PAUSED') return { error: 'Estado no válido.' }

  const res = await cambiarEstadoRegla(user.metadata.companyId, id, estado)
  if (!res.ok) return { error: 'No se pudo cambiar. Recarga la página.' }

  revalidatePath('/admin/integraciones')
  return {
    success:
      estado === 'PUBLISHED'
        ? 'Regla reactivada.'
        : 'Regla pausada. Dejamos de llamar hasta que la reactives.',
  }
}

/** Archiva una regla: deja de dispararse y su historial se conserva. */
export async function archivarReglaAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'regla_http')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta la regla.' }

  const res = await archivarRegla(user.metadata.companyId, id)
  if (!res.ok) return { error: 'No encontramos esa regla.' }

  revalidatePath('/admin/integraciones')
  return { success: 'Regla archivada. Dejó de dispararse; su historial se conserva.' }
}

/**
 * CREAR UN WEBHOOK ENTRANTE (hallazgo B-1).
 *
 * Permiso PROPIO y separado de los salientes: crear uno abre una URL pública
 * que ESCRIBE en la base de la empresa. Los salientes solo mandan hacia fuera.
 * Son facultades distintas y la pantalla de permisos tiene que poder
 * distinguirlas.
 */
export async function crearEntranteAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'entrante_crear')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!nombre) return { error: 'Ponle un nombre para reconocerlo después.' }

  const res = await crearEntrante({
    companyId: user.metadata.companyId,
    nombre,
    // `appUrl()` es el único dueño de las URLs de la aplicación: escrita a mano
    // aquí, la URL que alguien copia a su herramienta apuntaría al dominio
    // equivocado el día que la app se mude.
    base: appUrl(),
    creadoPor: user.metadata.dbUserId ?? null,
  })

  if (!res.ok) {
    return {
      error:
        res.motivo === 'nombre_repetido'
          ? 'Ya tienes un webhook entrante que se llama casi igual. Ponle otro nombre.'
          : 'Tu plan no incluye webhooks entrantes, o alcanzaste el máximo. Escríbenos para ampliarlo.',
    }
  }

  revalidatePath('/admin/integraciones')
  return {
    success: `Listo. Pega esta dirección en tu herramienta — es un secreto y no se puede volver a ver. Lo que llegue entrará como «${res.evento}».`,
    // Viaja por `secretoNuevo` para reutilizar el bloque que ya enseña un
    // secreto una sola vez: la URL ES el credencial y se trata como tal.
    secretoNuevo: res.url,
  }
}

/** Pausa o reactiva un webhook entrante. */
export async function cambiarEstadoEntranteAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'entrante_gestionar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  if (estado !== 'ACTIVE' && estado !== 'PAUSED') return { error: 'Estado no válido.' }

  const res = await cambiarEstadoEntrante(user.metadata.companyId, id, estado)
  if (!res.ok) return { error: 'No se pudo cambiar. Recarga la página.' }

  revalidatePath('/admin/integraciones')
  return {
    success:
      estado === 'ACTIVE'
        ? 'Reactivado. Volvemos a procesar lo que te manden.'
        : 'Pausado. Seguiremos aceptando los avisos para que tu herramienta no se llene de errores, pero no haremos nada con ellos.',
  }
}

/** Elimina un webhook entrante: su URL deja de valer en la siguiente llamada. */
export async function eliminarEntranteAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'entrante_gestionar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta el webhook.' }

  const res = await eliminarEntrante(user.metadata.companyId, id)
  if (!res.ok) return { error: 'No encontramos ese webhook.' }

  revalidatePath('/admin/integraciones')
  return { success: 'Eliminado. Esa dirección deja de funcionar.' }
}

/**
 * ROTAR EL SECRETO de un webhook (hallazgo A-7).
 *
 * Permiso propio, `webhook_rotar`, y no vale con `webhook_estado`: pausar es
 * reversible con un clic y solo afecta a lo que llegue después; rotar pone en
 * marcha un reloj que, si nadie copia el secreto nuevo a tiempo, termina en un
 * receptor que deja de validar nuestras firmas. Son facultades distintas.
 */
export async function rotarSecretoWebhookAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_rotar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta el webhook.' }

  const res = await rotarSecretoSuscripcion(user.metadata.companyId, id)
  if (!res.ok) return { error: 'No encontramos ese webhook.' }

  revalidatePath('/admin/integraciones')
  // El secreto nuevo viaja en `secretoNuevo` —el mismo campo que al crear— para
  // que la pantalla lo enseñe con el bloque que ya existe. Y la fecha va en el
  // texto: es el dato que convierte «lo copio luego» en una decisión con plazo.
  return {
    success: `Secreto rotado. El anterior sigue valiendo hasta el ${res.anteriorHasta.toLocaleDateString('es-DO', { day: 'numeric', month: 'long' })}: copia el nuevo en tu servidor antes de esa fecha.`,
    secretoNuevo: res.secreto,
  }
}

/**
 * CAMBIAR QUÉ EVENTOS RECIBE un webhook (hallazgo A-5).
 *
 * Reutiliza `webhook_estado` a propósito, y no es pereza: quien puede pausar un
 * webhook ya puede dejar de recibirlo TODO. Poder dejar de recibir una parte es
 * estrictamente menos que eso, así que un permiso nuevo no protegería nada y
 * sería un interruptor más que explicar en la pantalla de permisos.
 */
export async function actualizarEventosWebhookAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_estado')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta el webhook.' }

  const eventos = soloEventosConocidos(formData.getAll('eventos').map(String))
  const res = await actualizarEventosSuscripcion(user.metadata.companyId, id, eventos)
  if (!res.ok) return { error: 'No se pudo guardar. Recarga la página.' }

  revalidatePath('/admin/integraciones')
  return {
    success:
      eventos.length === 0
        ? 'Guardado. Volverás a recibir todos los eventos.'
        : `Guardado. Recibirás ${eventos.length === 1 ? 'solo ese evento' : `solo esos ${eventos.length} eventos`}.`,
  }
}

/**
 * MANDAR UN EVENTO DE PRUEBA (hallazgo A-4).
 *
 * Es lo primero que quiere hacer cualquiera que acaba de pegar una URL, y hasta
 * ahora no se podía: había que esperar a que ocurriera un evento de verdad —una
 * compra, una visita— para descubrir si el webhook estaba bien escrito. Con
 * suerte, eso es media hora; sin suerte, es el lunes.
 *
 * Tiene permiso PROPIO y no reutiliza `webhook_estado`: la prueba hace que
 * NUESTRO servidor toque una URL que escribió otra persona, y eso es una
 * facultad distinta de pausar un webhook.
 */
export async function probarWebhookAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_probar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta el webhook.' }

  const res = await probarSuscripcion(user.metadata.companyId, id)
  if ('error' in res) return { error: res.error }

  revalidatePath('/admin/integraciones')
  // La prueba NO es un error aunque el servidor conteste mal: el resultado va
  // en `prueba` y la pantalla lo pinta con su gravedad. Devolverlo como `error`
  // perdería el diagnóstico, que es justo lo que se fue a buscar.
  return { prueba: res }
}

/**
 * EL CUERPO EXACTO QUE SE ENVIÓ, a demanda.
 *
 * Se pide al abrir una entrega y no con la lista entera: cincuenta cuerpos
 * viajando al navegador para que se lea uno es trabajo tirado, y las listas de
 * entregas se abren muchas más veces de las que se abre un cuerpo.
 *
 * Es una LECTURA, así que le basta el permiso de la sección: no hay función
 * aparte que conceder. Y va acotada por la empresa del usuario —nunca por el
 * id suelto que manda el navegador—, que es lo que impide leer la entrega de
 * otra empresa con un id adivinado.
 */
export async function detalleEntregaAction(
  _prev: DetalleEntregaState,
  formData: FormData
): Promise<DetalleEntregaState> {
  const user = await requireSection('integraciones')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta la entrega.' }

  const entrega = await entregaDeEmpresa(user.metadata.companyId, id)
  if (!entrega) return { error: 'No encontramos esa entrega.' }

  return { id, cuerpo: JSON.stringify(entrega.payload ?? {}, null, 2) }
}

export interface DetalleEntregaState {
  error?: string
  /** A qué entrega corresponde el cuerpo, para no pintarlo bajo otra. */
  id?: string
  cuerpo?: string
}

/**
 * REENVIAR UNA ENTREGA (hallazgo A-4).
 *
 * Cierra el ciclo del que depende todo lo demás: se arregla el servidor y se
 * comprueba aquí mismo si sirvió, en vez de esperar al siguiente evento real
 * para enterarse.
 */
export async function reenviarEntregaAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_reenviar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta la entrega.' }

  const res = await reenviarEntregaAhora(user.metadata.companyId, id)
  if (!res.ok) {
    return {
      error:
        res.motivo === 'suscripcion_inactiva'
          ? 'Este webhook está pausado o apagado. Reactívalo antes de reenviar.'
          : 'No encontramos esa entrega.',
    }
  }

  revalidatePath('/admin/integraciones')
  if (res.resultado === 'enviado') {
    return { success: 'Entregado. Tu servidor lo recibió y lo aceptó.' }
  }
  // Volver a fallar es un resultado legítimo del botón, no un fallo del botón.
  // Se dice lo que pasa DESPUÉS, que es lo que la persona necesita saber para
  // decidir si se queda mirando o se va a arreglar su servidor.
  return {
    error:
      'Tu servidor volvió a rechazarlo. Seguiremos reintentando solos; mira el detalle de la entrega para ver qué respondió.',
  }
}

/**
 * CONECTAR WHATSAPP: la empresa pega su token permanente y su Phone number ID.
 *
 * Se valida contra Meta ANTES de guardar (ver `conectarWhatsapp`): un token
 * mal pegado se descubriría semanas después, cuando una automatización
 * intentara enviar. Aquí el error sale mientras la persona sigue en pantalla.
 *
 * Reutiliza el permiso `webhook_crear`… NO. Tiene el suyo: conectar una
 * aplicación entrega credenciales de la empresa a un tercero y merece su
 * propio interruptor.
 */
export async function conectarWhatsappAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const token = String(formData.get('token') ?? '').trim()
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '').trim()
  if (!token || !phoneNumberId) {
    return { error: 'Pega el token y el identificador del número (Phone number ID).' }
  }

  const conexion = await crearConexion({
    companyId: user.metadata.companyId,
    conectorSlug: 'whatsapp',
    creadoPor: user.metadata.dbUserId ?? undefined,
  })
  // `ya_conectada` no es un error para el usuario: quiere REEMPLAZAR el token,
  // que es justo lo que se hace al guardar la credencial (upsert).
  const conexionId =
    conexion.ok ? conexion.conexionId : await idDeConexion(user.metadata.companyId, 'whatsapp')
  if (!conexionId) return { error: 'WhatsApp no está disponible en este momento.' }

  const res = await conectarWhatsapp({
    companyId: user.metadata.companyId,
    conexionId,
    token,
    phoneNumberId,
  })
  if (!res.ok) return { error: res.detalle }

  revalidatePath('/admin/integraciones')
  return {
    success: res.numeroVisible
      ? `WhatsApp conectado con el número ${res.numeroVisible}.`
      : 'WhatsApp conectado.',
  }
}

/** Id de la conexión existente de un conector, si la hay. */
async function idDeConexion(companyId: string, slug: string): Promise<string | null> {
  const { conexionesDeEmpresa } = await import('@/modules/connect/registro')
  const conexiones = await conexionesDeEmpresa(companyId)
  return conexiones.find((c) => c.conector.slug === slug)?.id ?? null
}

/**
 * DESCONECTAR una aplicación. Borra sus credenciales además de apagarla:
 * dejar un token vivo de un servicio que la empresa cree apagado sería
 * exactamente lo contrario de lo que pidió.
 */
export async function desconectarAppAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'app_desconectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta la conexión.' }

  const res = await desconectarConexion({ companyId: user.metadata.companyId, conexionId: id })
  if (!res.ok) return { error: 'Esa aplicación ya estaba desconectada.' }

  revalidatePath('/admin/integraciones')
  return { success: 'Aplicación desconectada y sus credenciales borradas.' }
}

/** La URL a la que mandar al usuario para conectar por OAuth. */
export async function urlDeConexionOauth(slug: string): Promise<string | null> {
  const def = proveedorDe(slug)
  if (!def || def.autorizacion.tipo !== 'OAUTH2' || !def.disponible()) return null
  return `/api/connect/oauth/${encodeURIComponent(slug)}/iniciar`
}
