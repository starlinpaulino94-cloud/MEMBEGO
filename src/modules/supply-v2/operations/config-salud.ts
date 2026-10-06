import { qstashConfigurado } from '@/lib/jobs/qstash'
import { capacidadActiva } from './flags'
import { secretoValido, type EstadoConfig, type PiezaDeConfig } from './salud-dominio'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 4 · ¿ESTÁ ESTO CONFIGURADO? (§8)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE ESTO EVITA
 *
 * Los bloques 2 y 3 fallan CERRADO cuando falta una variable: sin secreto de
 * pasarela el webhook responde 401, sin cuenta de integración responde 500 y
 * guarda el evento. Eso protege el dinero, y tiene un problema operativo: el
 * síntoma es «el proveedor dice que mandó avisos y no llegan», y descubrir que
 * la causa es una variable olvidada puede llevar medio día.
 *
 * Esto convierte esa media jornada en una línea del panel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NUNCA EL VALOR. NI UN TROZO
 *
 * Se devuelve el ESTADO, no el contenido: `CONFIGURED`, `MISSING`, `INVALID`,
 * `DISABLED`. Ni los últimos cuatro caracteres —en un secreto corto, eso es
 * media clave—, y un panel lo ve más gente que la base de datos: soporte, un
 * compañero por encima del hombro, una captura en un chat.
 *
 * `INVALID` comprueba la FORMA, no el valor: un secreto de cuatro letras o uno
 * que todavía dice «cambiame» pasa cualquier «¿está puesto?» y no protege nada.
 */

export interface SaludDeConfiguracion {
  piezas: PiezaDeConfig[]
  /** Lo que falta de algo ENCENDIDO. Es lo único que impide operar. */
  faltaCritico: boolean
}

export async function saludDeConfiguracion(): Promise<SaludDeConfiguracion> {
  const pagosActivos = await capacidadActiva('SUPPLY_V2_EXTERNAL_PAYMENTS')
  const entregaActiva = await capacidadActiva('SUPPLY_V2_OUTBOX_DELIVERY')

  const piezas: PiezaDeConfig[] = [
    {
      clave: 'SUPPLY_V2_WEBHOOK_ACTOR_ID',
      etiqueta: 'Cuenta de la integración',
      // Si los pagos están apagados, que falte es una consecuencia de la
      // decisión, no un descuido: DISABLED, no MISSING.
      estado: !pagosActivos ? 'DISABLED' : idValido(process.env.SUPPLY_V2_WEBHOOK_ACTOR_ID),
      remedio:
        'Designar la cuenta de Membego con la que actúa la integración. Sin ella el webhook responde 500 y los eventos quedan esperando.',
    },
    {
      clave: 'SUPPLY_V2_TEST_GATEWAY_SECRET',
      etiqueta: 'Secreto de la pasarela de prueba',
      estado: !pagosActivos ? 'DISABLED' : secretoValido(process.env.SUPPLY_V2_TEST_GATEWAY_SECRET),
      remedio: 'Poner el secreto HMAC del proveedor. Sin él, el webhook rechaza todo con 401 (fallo cerrado).',
    },
    {
      clave: 'QSTASH',
      etiqueta: 'Cola de trabajos (QStash)',
      // Sin QStash la cola NO se pierde: ejecuta en línea. Es degradación
      // honesta, no una avería, y por eso es INVALID y no MISSING: funciona,
      // pero dentro de la petición.
      estado: !entregaActiva ? 'DISABLED' : qstashConfigurado() ? 'CONFIGURED' : 'INVALID',
      remedio:
        'Configurar QStash para que los efectos salgan del request. Sin él se ejecutan en línea: más lento, pero no se pierde ninguno.',
    },
    {
      clave: 'SENTRY_DSN',
      etiqueta: 'Sentry',
      // No es crítico para operar, y decirlo importa: marcarlo como avería
      // haría que el panel estuviera en ámbar permanente en entornos donde no
      // se usa, y un panel siempre en ámbar no se lee.
      estado: process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || process.env.SENTRY_DSN?.trim() ? 'CONFIGURED' : 'DISABLED',
      remedio: 'Opcional. Sin Sentry, el detalle de un error se busca en los logs del proveedor de hosting.',
    },
    {
      clave: 'BOOTSTRAP_SECRET',
      etiqueta: 'Secreto del diagnóstico de salud',
      estado: secretoValido(process.env.BOOTSTRAP_SECRET, 8),
      remedio: 'Sin él, `/api/health` solo da el estado agregado y no el detalle.',
    },
  ]

  return {
    piezas,
    faltaCritico: piezas.some((p) => p.estado === 'MISSING' || p.estado === 'INVALID'),
  }
}

/**
 * Un id de usuario de los nuestros. Se comprueba la forma, no la existencia:
 * que el usuario exista lo verifica el camino del webhook en la base, y hacer
 * esa consulta aquí convertiría una comprobación de configuración en una
 * consulta más del panel.
 */
function idValido(valor: string | undefined): EstadoConfig {
  const v = valor?.trim()
  if (!v) return 'MISSING'
  return /^c[a-z0-9]{20,30}$/i.test(v) ? 'CONFIGURED' : 'INVALID'
}
