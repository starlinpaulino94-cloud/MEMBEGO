import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { otorgarBienvenidaDirecta } from '@/modules/invitaciones/beneficios'
import { vincularRegalosPorContacto } from '@/modules/regalos/entrega'
import { capturarCanalRegistro } from '@/modules/adquisicion/canal'
import { capturarAtribucionVendedor } from '@/modules/excursiones/atribucion/registrar'

/**
 * UNIRSE A UNA EMPRESA — una sola vez en todo el código.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES «SER CLIENTE DE UNA EMPRESA» AQUÍ
 *
 * Una persona es UNA cuenta (`User` / `supabaseId`) y tiene UNA ficha de
 * `Cliente` POR EMPRESA — el esquema lo dice desde siempre con
 * `@@unique([supabaseId, companyId])`. No es una limitación que haya que
 * rodear: es lo que permite que alguien tenga historial en su lavadero y en un
 * restaurante sin que se mezclen.
 *
 * Lo que faltaba no era el modelo, era el momento de crear la ficha. Antes solo
 * se creaba entrando por «afiliarme a esta empresa», una pantalla a la que hay
 * que llegar a propósito. Quien veía una recompensa de un negocio que no
 * conocía se topaba con «para adquirirla primero únete a la empresa» — un
 * trámite antes del premio, que es exactamente al revés de como funciona esto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEGUIR NO ES UN EXTRA, ES PARTE DEL ALTA
 *
 * Adquirir una recompensa de un negocio ES la señal de interés más fuerte que
 * existe. Por eso el `CompanyFollow` se crea aquí dentro y no lo decide cada
 * llamador: si dependiera de que cada sitio se acuerde de seguirlo, habría
 * clientes con ficha en una empresa y sin seguirla, que es un estado que no
 * significa nada y que rompe las notificaciones (`notificarSeguidores`) y los
 * segmentos de audiencia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA FUNCIÓN NO HACE: CAMBIAR EL CONTEXTO ACTIVO
 *
 * `afiliarmeAEmpresa` sí cambia la empresa activa de la sesión, porque ahí el
 * usuario ha dicho explícitamente «llévame a este negocio». Al adquirir una
 * recompensa NO: alguien que reclama unos tacos desde la pantalla de su
 * lavadero no está pidiendo mudarse de negocio, y moverle el contexto entero
 * debajo de los pies le cambiaría el menú, los planes y el QR sin avisar.
 *
 * Que la compra quede bajo otra ficha obliga a que «Mis beneficios» mire TODAS
 * las fichas de la persona y no solo la activa. Eso está resuelto en
 * `misClienteIds`, y es la razón de que exista.
 */

export interface ResultadoAfiliacion {
  clienteId: string
  /** `false` cuando ya tenía ficha en esa empresa. */
  creado: boolean
}

/**
 * Devuelve el `clienteId` de la persona en `companyId`, creando la ficha y el
 * seguimiento si aún no existen.
 *
 * `nombre` y `telefono` se heredan de la ficha más antigua de la persona: quien
 * ya se registró una vez no debería volver a escribir su nombre para reclamar
 * algo. Si no hay ninguna previa se usa el nombre de la cuenta.
 *
 * Si se proporciona `enlaceSlug`, registra la atribución del vendedor (etapa REGISTRO).
 */
export async function asegurarClienteEnEmpresa(
  supabaseId: string,
  email: string | null | undefined,
  companyId: string,
  enlaceSlug?: string | null
): Promise<ResultadoAfiliacion | { error: string }> {
  const [dbUser, existente] = await sinEmpresa(
    'afiliación: mi user y mi ficha en la empresa destino',
    (tx) =>
      Promise.all([
        tx.user.findUnique({ where: { supabaseId }, select: { id: true, name: true } }),
        tx.cliente.findUnique({
          where: { supabaseId_companyId: { supabaseId, companyId } },
          select: { id: true },
        }),
      ])
  )
  if (!dbUser) return { error: 'No se encontró tu cuenta.' }

  // Ya tenía ficha: el seguimiento se asegura igual. Una ficha creada antes de
  // que esto existiera puede no tenerlo, y `upsert` lo deja en su sitio sin
  // pisar `esFavorita` si el usuario ya la había marcado.
  if (existente) {
    await seguirEmpresa(dbUser.id, companyId)
    // Atribución de vendedor si vino por enlace/QR (etapa REGISTRO)
    if (enlaceSlug) {
      await capturarAtribucionVendedor(existente.id, companyId, { enlaceSlug }).catch((e) =>
        console.error('[afiliación] atribución de vendedor (existente):', e)
      )
    }
    return { clienteId: existente.id, creado: false }
  }

  const previa = await sinEmpresa('afiliación: mi ficha más antigua (nombre y teléfono)', (tx) =>
    tx.cliente.findFirst({
      where: { supabaseId },
      select: { nombre: true, telefono: true },
      orderBy: { createdAt: 'asc' },
    })
  )

  const nombre = previa?.nombre ?? dbUser.name
  const telefono = previa?.telefono ?? null

  const cliente = await sinEmpresa('afiliación: crear mi ficha en la empresa destino', (tx) =>
    tx.cliente.create({
      data: { companyId, supabaseId, nombre, email: email ?? '', telefono },
      select: { id: true },
    })
  )

  await seguirEmpresa(dbUser.id, companyId)

  /**
   * LA BIENVENIDA DE LA EMPRESA — aquí, y no al registrarse.
   *
   * Antes la daba `repararContextoCliente`: alguien creaba su cuenta de Membego
   * y recibía el regalo de bienvenida de un negocio que no había elegido, del
   * que quedaba como cliente y al que seguía. La relación se la inventaba el
   * sistema.
   *
   * Ahora se entrega en el momento en que esa relación existe de verdad: al
   * reclamar una recompensa suya, al afiliarse, al comprar. La regla comercial
   * no cambia —quien se hace cliente de una empresa recibe su bienvenida—; lo
   * que cambia es que ya no se le regala en nombre de alguien que no conocía.
   *
   * Los tres van sin bloquear: el alta ya está hecha y la persona viene a por
   * otra cosa. Un fallo aquí le cuesta un regalo, no su ficha.
   */
  await otorgarBienvenidaDirecta(cliente.id, companyId).catch((e) =>
    console.error('[afiliación] bienvenida:', e)
  )
  await capturarCanalRegistro(cliente.id).catch((e) =>
    console.error('[afiliación] canal de registro:', e)
  )
  // Atribución de vendedor si vino por enlace/QR (etapa REGISTRO)
  if (enlaceSlug) {
    await capturarAtribucionVendedor(cliente.id, companyId, { enlaceSlug }).catch((e) =>
      console.error('[afiliación] atribución de vendedor:', e)
    )
  }
  if (email) {
    await vincularRegalosPorContacto({ clienteId: cliente.id, companyId, email }).catch((e) =>
      console.error('[afiliación] regalos por contacto:', e)
    )
  }

  // El negocio se entera de que tiene un cliente nuevo por el mismo evento que
  // ya usaba el alta normal: para las automatizaciones da igual si entró por la
  // pantalla de afiliación o reclamando una recompensa.
  await emitirEventoEstrategia({
    companyId,
    type: 'cliente.registrado',
    subjectId: cliente.id,
    payload: {
      cliente: { nombre, compras: 0, visitas: 0, email: email ?? null, telefono },
    },
  }).catch((e) => console.error('[afiliación] evento cliente.registrado:', e))

  return { clienteId: cliente.id, creado: true }
}

/**
 * Seguir la empresa. No bloquea el alta si falla: quedarse sin seguimiento es
 * recuperable —el `upsert` de la próxima vez lo arregla—, pero perder la ficha
 * a medio crear dejaría a la persona sin la recompensa que venía a buscar.
 */
async function seguirEmpresa(userId: string, companyId: string) {
  await conEmpresa(companyId, (tx) =>
    tx.companyFollow.upsert({
      where: { userId_companyId: { userId, companyId } },
      update: {},
      create: { userId, companyId },
    })
  ).catch((e) => console.error('[afiliación] auto-follow:', e))
}

/**
 * TODAS las fichas de la persona, no solo la activa.
 *
 * «Mis beneficios» es de la PERSONA, no de la empresa que tenga abierta en ese
 * momento. Filtrar por el `clienteId` de la sesión escondía cualquier
 * recompensa reclamada en otro negocio: se adquiría bien, se guardaba bien, y
 * no aparecía por ningún lado.
 */
/**
 * La ficha de la persona en UNA empresa concreta, o `null` si aún no tiene.
 *
 * Lectura pura: no crea nada. Sirve para que una pantalla sepa si esta persona
 * ya es cliente de ese negocio —para contar su límite de adquisiciones contra
 * la ficha correcta, y para avisarle de que va a empezar a seguirlo— sin
 * afiliarla por el mero hecho de mirar.
 */
export async function fichaEnEmpresa(
  supabaseId: string,
  companyId: string
): Promise<string | null> {
  const ficha = await sinEmpresa('cliente: mi ficha en una empresa concreta', (tx) =>
    tx.cliente.findUnique({
      where: { supabaseId_companyId: { supabaseId, companyId } },
      select: { id: true },
    })
  )
  return ficha?.id ?? null
}

/**
 * Datos que son de la PERSONA y viven copiados en cada ficha.
 *
 * No incluye nada de la relación comercial —membresías, beneficios, historial,
 * notas del negocio—: eso es de cada empresa y no se copia de un lado a otro.
 */
export interface DatosPersonales {
  nombre: string
  telefono: string | null
  fechaNacimiento: Date | null
  ciudad: string | null
  genero: string | null
  notifPromos: boolean
  notifRecordatorios: boolean
  avatarUrl?: string
}

/**
 * ESCRIBIR SUS DATOS EN TODAS SUS FICHAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UNA FUNCIÓN Y NO ESTABA DENTRO DE LA ACCIÓN
 *
 * Una `server action` necesita sesión de Supabase, así que no se puede
 * ejecutar en una verificación contra la base. Sacando aquí la parte que
 * decide QUÉ se escribe y DÓNDE, lo que se comprueba en
 * `scripts/verificar-cuenta-y-ayuda.mts` es el código de verdad y no una copia
 * suya escrita en el script — que es una prueba que solo se prueba a sí misma.
 *
 * Cada ficha se escribe con `conEmpresa` de SU empresa: el aislamiento sigue
 * puesto en cada escritura, y un fallo en una no tumba las demás.
 *
 * Devuelve cuántas fichas se actualizaron.
 */
export async function propagarDatosPersonales(
  supabaseId: string,
  datos: DatosPersonales
): Promise<number> {
  const fichas = await sinEmpresa('perfil: mis fichas para propagar mis datos', (tx) =>
    tx.cliente.findMany({
      where: { supabaseId },
      select: { id: true, companyId: true },
    })
  )
  let escritas = 0
  for (const ficha of fichas) {
    const ok = await conEmpresa(ficha.companyId, (tx) =>
      tx.cliente.update({ where: { id: ficha.id }, data: datos })
    )
      .then(() => true)
      .catch((e) => {
        console.error('[perfil] propagar a', ficha.companyId, e)
        return false
      })
    if (ok) escritas++
  }
  return escritas
}

/**
 * POR QUÉ ESTO **NO** LLEVA `cache` DE REACT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA OPTIMIZACIÓN QUE PARECÍA GRATIS
 *
 * Al cerrar las fases 4-9 esta función se llama desde 36 sitios, y una sola
 * pantalla la dispara varias veces: `/cliente/regalos` pide los regalos y las
 * gift cards, y cada una resuelve las fichas por su cuenta. Envolverla en
 * `cache()` —como ya hacen `getRegionalPrefs` y
 * `getCampanaPorCodigoInvitacion`— une esas consultas idénticas en una.
 *
 * Se probó, y se quitó.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE LO DESACONSEJA
 *
 * A diferencia de aquellas dos, esta lista CAMBIA dentro de la propia
 * petición: `asegurarClienteEnEmpresa` crea una ficha nueva al adquirir una
 * recompensa de un negocio donde la persona todavía no era clienta. Si una
 * lectura posterior recibiera la lista memorizada de ANTES del alta, la
 * recompensa recién reclamada no aparecería en «Mis beneficios» — que es
 * exactamente el fallo que estas fases se dedicaron a quitar, reintroducido
 * por una optimización.
 *
 * Y no se puede comprobar desde aquí: `cache` solo deduplica dentro del
 * contexto de una petición de Next; en un script devuelve una caché nueva en
 * cada llamada, así que una verificación como las de `scripts/` no distingue
 * si funciona o no. Adoptarla a ciegas sería cambiar una consulta barata
 * —índice por `supabaseId`, dos filas— por un riesgo que nadie ha medido.
 *
 * Queda anotado por si alguien vuelve: haría falta separar la lectura del
 * camino que da de alta, o invalidar tras el alta. Hasta entonces, la consulta
 * se repite y no pasa nada.
 */
export async function misClienteIds(supabaseId: string): Promise<string[]> {
  const fichas = await sinEmpresa('cliente: todas mis fichas (para listar beneficios)', (tx) =>
    tx.cliente.findMany({ where: { supabaseId }, select: { id: true } })
  )
  return fichas.map((f) => f.id)
}
