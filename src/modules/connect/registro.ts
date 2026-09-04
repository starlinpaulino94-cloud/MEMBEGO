import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarConector } from '@/modules/connect/bitacora'
import { eliminarCredencial } from '@/modules/connect/credenciales'
import { revocarTokensOauth } from '@/modules/connect/revocacion'
import { proveedorDe, slugsDisponibles } from '@/modules/connect/proveedores/indice'
import { puedeTransicionar, type EstadoConexion } from '@/modules/connect/nucleo'
import { CLASES_TRANSITORIAS, type ClaseError } from '@/modules/connect/proveedores/tipos'

export { puedeTransicionar } from '@/modules/connect/nucleo'
export type { EstadoConector, EstadoConexion } from '@/modules/connect/nucleo'

/**
 * REGISTRO de conectores y conexiones de Membego Connect.
 *
 * Mismo reparto que la plataforma de satélites (`modules/plataforma`):
 * el CATÁLOGO (`conectores`) es global y lo administra el superadmin; la
 * CONEXIÓN (`conexiones_empresa`) es de una empresa. Compatibilidad y
 * concesión son cosas distintas.
 *
 * Estas funciones NO comprueban sesión: son la capa de módulo, y la
 * autorización vive en las server actions / rutas que las llaman (igual que
 * `sistemasDeEmpresa`). Lo que SÍ garantizan es el aislamiento: toda consulta
 * de empresa va dentro de `conEmpresa`, y el catálogo global declara su
 * cross-tenant con `sinEmpresa` y motivo.
 */

/**
 * Catálogo para el panel de una empresa: SOLO conectores ACTIVE. Los DRAFT no
 * existen para nadie más que el superadmin — enseñar un conector que no
 * funciona es un interruptor pintado.
 */
export async function catalogoParaEmpresas() {
  // DOS filtros, y el segundo es el que importa: además de estar ACTIVE en la
  // base, el conector tiene que estar CONFIGURADO en este despliegue. Google
  // Calendar sin sus variables de entorno existe como fila y no se ofrece —
  // enseñarlo sería un botón que lleva a una pantalla de error del proveedor.
  const disponibles = slugsDisponibles()
  if (disponibles.length === 0) return []
  return sinEmpresa('connect: catálogo global de conectores (sin datos de empresa)', (tx) =>
    tx.conector.findMany({
      where: { estado: 'ACTIVE', slug: { in: disponibles } },
      select: {
        id: true,
        slug: true,
        nombre: true,
        descripcion: true,
        categoria: true,
        icono: true,
        docsUrl: true,
        authTipo: true,
      },
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
    })
  )
}

/** Catálogo completo, estados incluidos — para el panel del superadmin. */
export async function catalogoCompleto() {
  return sinEmpresa('connect: catálogo completo para superadmin', (tx) =>
    tx.conector.findMany({
      orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
      include: { _count: { select: { conexiones: true } } },
    })
  )
}

/** Las conexiones de una empresa, con su conector, para el panel. */
export async function conexionesDeEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.conexionEmpresa.findMany({
      where: { companyId },
      include: {
        conector: {
          select: { slug: true, nombre: true, categoria: true, icono: true, authTipo: true, estado: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  )
}

export type ResultadoCrearConexion =
  | { ok: true; conexionId: string; reutilizada: boolean }
  | { ok: false; motivo: 'conector_no_disponible' | 'ya_conectada' | 'no_se_conecta_aqui' }

/**
 * Inicia el alta de una conexión (queda PENDING; la credencial llega después,
 * por el flujo OAuth de la Fase 5 o a mano). Reutiliza una fila DISCONNECTED
 * si existe — el unique por (empresa, conector) es la garantía de no duplicar.
 */
export async function crearConexion(input: {
  companyId: string
  conectorSlug: string
  creadoPor?: string
}): Promise<ResultadoCrearConexion> {
  // LA GUARDIA DE «PRÓXIMAMENTE», Y VIVE EN EL SERVIDOR (Fase 10).
  //
  // Una fila publicada en el catálogo NO basta para conectar: hace falta que
  // exista código que sepa hablar con ese proveedor. Las integraciones
  // previstas tienen fila y no tienen implementación, y esta comprobación es
  // lo que hace que su botón deshabilitado sea una consecuencia de la regla y
  // no la regla misma. Ocultar un botón no prohíbe nada: quien llame esta
  // acción a mano se encuentra lo mismo.
  const proveedor = proveedorDe(input.conectorSlug)
  if (!proveedor || !proveedor.disponible()) {
    return { ok: false, motivo: 'conector_no_disponible' }
  }
  // Y una integración ADAPTADA no se da de alta aquí: su estado vive en el
  // subsistema que la administra (CardNET, en el módulo de pagos). Crearle una
  // fila sería inventar una segunda verdad sobre el mismo hecho.
  if (proveedor.clase === 'ADAPTADA') return { ok: false, motivo: 'no_se_conecta_aqui' }

  const conector = await sinEmpresa('connect: resolver conector del catálogo global', (tx) =>
    tx.conector.findFirst({
      where: { slug: input.conectorSlug, estado: 'ACTIVE' },
      select: { id: true },
    })
  )
  if (!conector) return { ok: false, motivo: 'conector_no_disponible' }

  const existente = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { companyId: input.companyId, conectorId: conector.id },
      select: { id: true, estado: true },
    })
  )

  if (existente) {
    if (existente.estado !== 'DISCONNECTED') return { ok: false, motivo: 'ya_conectada' }
    await conEmpresa(input.companyId, (tx) =>
      tx.conexionEmpresa.update({
        where: { id: existente.id },
        data: { estado: 'PENDING', ultimoError: null, creadoPor: input.creadoPor ?? null },
      })
    )
    await anotarConector({
      companyId: input.companyId,
      origen: 'CONEXION',
      origenId: existente.id,
      evento: 'conexion.reiniciada',
    })
    return { ok: true, conexionId: existente.id, reutilizada: true }
  }

  const creada = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.create({
      data: {
        companyId: input.companyId,
        conectorId: conector.id,
        estado: 'PENDING',
        creadoPor: input.creadoPor ?? null,
      },
      select: { id: true },
    })
  )
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: creada.id,
    evento: 'conexion.creada',
    detalle: { conector: input.conectorSlug },
  })
  return { ok: true, conexionId: creada.id, reutilizada: false }
}

/**
 * RESUELVE o CREA la conexión de un conector para una empresa, y devuelve su
 * id. Es lo que necesita todo flujo que empieza fuera de nuestra aplicación:
 * el `state` de OAuth se ata a una fila concreta, así que la fila tiene que
 * existir ANTES de mandar a nadie a Google.
 *
 * (Antes de la Fase 10 esto no existía y el botón «Conectar» de un conector
 * OAuth iba directo a la ruta de inicio sin `conexionId`, que respondía «Falta
 * la conexión» con un 400. El botón nunca llegó a funcionar.)
 */
export async function asegurarConexion(input: {
  companyId: string
  conectorSlug: string
  creadoPor?: string
}): Promise<string | null> {
  const creada = await crearConexion(input)
  if (creada.ok) return creada.conexionId
  if (creada.motivo !== 'ya_conectada') return null

  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { companyId: input.companyId, conector: { slug: input.conectorSlug } },
      select: { id: true },
    })
  )
  return fila?.id ?? null
}

/**
 * Apaga una conexión Y BORRA sus credenciales. Desconectar sin borrar el
 * secreto dejaría un token vivo de un servicio que la empresa cree apagado.
 * La fila y su historial se conservan (apagar, no borrar).
 */
export async function desconectarConexion(input: {
  companyId: string
  conexionId: string
}): Promise<{ ok: boolean }> {
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { id: input.conexionId, companyId: input.companyId },
      select: { id: true, estado: true, conector: { select: { slug: true } } },
    })
  )
  if (!fila || fila.estado === 'DISCONNECTED') return { ok: false }

  // PRIMERO se revoca en el proveedor, mientras todavía tenemos el token:
  // borrar nuestro sello sin esto deja un refresh token vivo en Google que la
  // empresa cree apagado. Best-effort: si Google no responde, se desconecta
  // igual — el remedio para un token que no se pudo revocar es borrar nuestra
  // copia, que es justo lo que viene después.
  await revocarTokensOauth({
    companyId: input.companyId,
    conexionId: fila.id,
    slug: fila.conector.slug,
  }).catch(() => undefined)

  // WHATSAPP (Meta · Fase 1): anular nuestra suscripción a los webhooks del
  // WABA del cliente mientras todavía tenemos su token. Sin esto Meta seguía
  // mandándonos sus eventos —sin dueño, pero llegando— de una integración que
  // la empresa cree apagada. Best-effort, igual que la revocación OAuth.
  if (fila.conector.slug === 'whatsapp') {
    const { desconectarWhatsappEnMeta } = await import('@/modules/connect/meta/whatsappDesconexion')
    await desconectarWhatsappEnMeta({ companyId: input.companyId, conexionId: fila.id }).catch(
      () => undefined
    )
  }
  // FACEBOOK E INSTAGRAM (Meta · Fase 3): revocar cada permiso concedido
  // mientras el token de usuario aún vale (DELETE /{user}/permissions/{p}).
  if (fila.conector.slug === 'facebook') {
    const { revocarPermisosPaginas } = await import('@/modules/connect/meta/paginas')
    await revocarPermisosPaginas({ companyId: input.companyId, conexionId: fila.id }).catch(
      () => undefined
    )
  }

  for (const tipo of ['OAUTH_TOKENS', 'API_KEY', 'SECRETO'] as const) {
    await eliminarCredencial({ companyId: input.companyId, conexionId: fila.id, tipo })
  }
  await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.update({ where: { id: fila.id }, data: { estado: 'DISCONNECTED' } })
  )

  // Los activos de Meta se RETIRAN, no se borran: el historial se queda, y el
  // webhook deja de atribuirles nada. Otro negocio podrá reclamarlos.
  const { retirarActivosDeConexion } = await import('@/modules/connect/meta/activos')
  await retirarActivosDeConexion({ companyId: input.companyId, conexionId: fila.id }).catch(
    () => undefined
  )
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: fila.id,
    evento: 'conexion.desconectada',
  })
  return { ok: true }
}

/**
 * Anota el resultado de un uso real de la conexión (lo llamarán los
 * conectores de la Fase 6 tras cada llamada al proveedor). Mantiene la salud
 * observable sin abrir credenciales, y mueve el estado solo por transiciones
 * legales — un éxito no resucita una conexión DISCONNECTED.
 */
export async function anotarSalud(input: {
  companyId: string
  conexionId: string
  resultado: { ok: true } | { ok: false; error: string; clase?: ClaseError }
}): Promise<void> {
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { id: input.conexionId, companyId: input.companyId },
      select: { estado: true },
    })
  )
  if (!fila) return
  const estadoActual = fila.estado as EstadoConexion

  if (input.resultado.ok) {
    const data: { ultimoOkAt: Date; claseError: null; estado?: EstadoConexion } = {
      ultimoOkAt: new Date(),
      // Un uso correcto borra la clase del fallo anterior: si no, una conexión
      // que ya funciona seguiría pidiendo «vuelve a conectar tu cuenta».
      claseError: null,
    }
    if (estadoActual !== 'CONNECTED' && puedeTransicionar(estadoActual, 'CONNECTED')) {
      data.estado = 'CONNECTED'
    }
    await conEmpresa(input.companyId, (tx) =>
      tx.conexionEmpresa.update({ where: { id: input.conexionId }, data })
    )
    return
  }

  const clase: ClaseError = input.resultado.clase ?? 'UNKNOWN'
  // UN LÍMITE DE CUOTA NO ROMPE UNA CONEXIÓN, Y UN CORTE DE RED TAMPOCO.
  //
  // La conexión está sana, el token es válido y no hay NADA que el dueño del
  // negocio pueda arreglar. Marcarla ERROR le pintaría «Requiere atención»
  // sobre una integración que funciona y le pediría reconectar una cuenta que
  // no tiene ningún problema. Se anota el fallo —para que se vea en los
  // registros— y el estado se queda donde estaba.
  const transitorio = CLASES_TRANSITORIAS.includes(clase)

  const data: {
    ultimoErrorAt: Date
    ultimoError: string
    claseError: ClaseError
    estado?: EstadoConexion
  } = {
    ultimoErrorAt: new Date(),
    ultimoError: input.resultado.error.slice(0, 300),
    claseError: clase,
  }
  if (!transitorio && estadoActual !== 'ERROR' && puedeTransicionar(estadoActual, 'ERROR')) {
    data.estado = 'ERROR'
  }
  await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.update({ where: { id: input.conexionId }, data })
  )
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    nivel: transitorio ? 'INFO' : 'WARN',
    evento: 'conexion.fallo',
    detalle: { error: input.resultado.error.slice(0, 300), clase },
  })
}
