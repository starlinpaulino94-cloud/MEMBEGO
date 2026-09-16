'use strict'

const { urlApi } = require('./autenticacion')

/**
 * DISPARADORES POR REST HOOK.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOOK Y NO SONDEO
 *
 * Zapier ofrece las dos formas. El sondeo pregunta cada cinco o quince minutos
 * según el plan; el hook llega en el momento.
 *
 * Aquí el hook además no cuesta casi nada, y ésa es la razón de fondo: MembeGo
 * ya tiene la maquinaria de entrega —firma, escalera de reintentos de 30 s a
 * 24 h, registro de entregas, dead letter—. Un disparador por sondeo tiraría
 * todo eso a la basura para reimplementar «¿hay algo nuevo?» con paginación por
 * fecha, que es justo donde se pierden eventos cuando dos ocurren en el mismo
 * segundo.
 *
 * El ciclo es: Zapier llama a `performSubscribe` al encender el Zap y a
 * `performUnsubscribe` al apagarlo. `perform` solo recibe lo que ya llegó.
 */

/**
 * Los eventos que se pueden escuchar, con el nombre que viaja por el cable (v2).
 *
 * Escritos aquí y no leídos de la API a propósito: Zapier necesita la lista al
 * CONSTRUIR la app, no en tiempo de ejecución, porque cada disparador es una
 * entrada del directorio con su propio nombre y su propia muestra. Que se
 * queden viejos lo vigila una prueba que los compara con el catálogo real.
 */
const EVENTOS = [
  {
    clave: 'clienteNuevo',
    evento: 'customer.created',
    nombre: 'Cliente nuevo',
    descripcion: 'Se dispara cuando alguien se registra en tu negocio.',
  },
  {
    clave: 'visita',
    evento: 'visit.completed',
    nombre: 'Visita registrada',
    descripcion: 'Se dispara cuando se registra una visita o un canje.',
  },
  {
    clave: 'compra',
    evento: 'purchase.completed',
    nombre: 'Compra realizada',
    descripcion: 'Se dispara cuando un cliente compra una membresía o una oferta.',
  },
  {
    clave: 'membresiaActivada',
    evento: 'membership.activated',
    nombre: 'Membresía activada',
    descripcion: 'Se dispara cuando una membresía queda activa.',
  },
  {
    clave: 'referidoConvertido',
    evento: 'referral.converted',
    nombre: 'Referido convertido',
    descripcion: 'Se dispara cuando un referido completa su conversión.',
  },
]

/** Crea la suscripción en MembeGo. Zapier guarda lo devuelto para el unsubscribe. */
const suscribir = (evento) => async (z, bundle) => {
  const resp = await z.request({
    url: urlApi(z, bundle, '/webhooks'),
    method: 'POST',
    body: {
      url: bundle.targetUrl,
      name: `Zapier · ${evento}`,
      // UN evento por suscripción, no la lista vacía que significa «todos».
      // Un Zap que pide compras no debe recibir visitas: pagaría una tarea de
      // Zapier por cada una para descartarla, y eso se nota en la factura.
      events: [evento],
    },
  })
  return resp.data
}

/** Retira la suscripción al apagar el Zap. */
const desuscribir = async (z, bundle) => {
  const id = (bundle.subscribeData || {}).id
  // Sin id no hay nada que retirar, y fallar aquí impediría apagar el Zap.
  if (!id) return { deleted: false }
  const resp = await z.request({
    url: urlApi(z, bundle, `/webhooks/${id}`),
    method: 'DELETE',
  })
  return resp.data
}

/**
 * Lo que llegó por el webhook.
 *
 * Devuelve el sobre APLANADO: `data` sube a la raíz y los campos del sobre se
 * conservan con prefijo. Zapier enseña los campos como una lista plana al
 * construir el Zap, y un `data.cliente.nombre` anidado obliga a bucear;
 * además, el `id` de arriba es lo que Zapier usa para deduplicar.
 */
const recibir = (z, bundle) => {
  const sobre = bundle.cleanedRequest || {}
  const datos = sobre.data || {}
  return [
    {
      id: sobre.id,
      event: sobre.event,
      companyId: sobre.companyId,
      createdAt: sobre.createdAt,
      ...datos,
    },
  ]
}

/**
 * SIN `performList`, y conviene explicar por qué.
 *
 * Zapier usa `performList` para enseñar datos REALES al configurar el Zap, y es
 * lo deseable: quien mapea campos sobre un ejemplo inventado descubre que
 * algunos no existen la primera vez que el Zap se dispara de verdad — cuando ya
 * no está mirando.
 *
 * Pero hoy no hay a qué llamar. La API tiene `/customers/search`, que EXIGE un
 * término de búsqueda de varios caracteres; no existe «dame los últimos». Se
 * podría llamar con una letra cualquiera y fingir que es una lista, y eso
 * funcionaría en una demo y fallaría para el primer negocio cuyos clientes no
 * la lleven en el nombre.
 *
 * Así que se declara `sample` y ya está. Zapier lo marca visiblemente como
 * ejemplo, que es honesto, mientras que un filtro inventado se presentaría como
 * datos reales. Cuando exista un listado paginado —el hallazgo B-6 de la
 * auditoría— esto pasa a ser tres líneas.
 */

const MUESTRA = {
  id: 'evt_ejemplo',
  event: 'customer.created',
  companyId: 'cmp_ejemplo',
  createdAt: '2026-09-16T12:00:00.000Z',
  customerId: 'cli_ejemplo',
}

/** Construye la definición de un disparador a partir de su entrada del catálogo. */
function disparadorDe(e) {
  return {
    key: e.clave,
    noun: 'Evento',
    display: { label: e.nombre, description: e.descripcion },
    operation: {
      type: 'hook',
      performSubscribe: suscribir(e.evento),
      performUnsubscribe: desuscribir,
      perform: recibir,
      sample: { ...MUESTRA, event: e.evento },
    },
  }
}

module.exports = {
  EVENTOS,
  disparadores: Object.fromEntries(EVENTOS.map((e) => [e.clave, disparadorDe(e)])),
}
