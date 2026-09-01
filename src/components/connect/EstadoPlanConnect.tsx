import Link from 'next/link'
import { KeyRound, Lock, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * QUÉ VE UNA EMPRESA QUE TODAVÍA NO TIENE ESTO CONCEDIDO (Connect · Fase 11).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE ARREGLA
 *
 * `api_keys.max` y `webhooks.max` valen CERO por defecto — deliberadamente:
 * son las funciones que abren los datos de una empresa a terceros y se
 * conceden una a una. La consecuencia práctica es que HOY, para el cien por
 * cien de las empresas, estas dos pantallas están vacías.
 *
 * Hasta ahora las dos situaciones distintas decían lo mismo:
 *
 *   límite 0            «Tu plan no incluye claves de API»   ← nunca se concedió
 *   3 claves de 3       «Tu plan no incluye claves de API»   ← sí se concedió, y se llenó
 *
 * La segunda frase era simplemente falsa. Y la primera salía en un recuadro
 * amarillo de aviso, como si algo se hubiera roto, cuando no hay nada roto:
 * es una función que no se ha pedido.
 *
 * Ahora son dos componentes distintos porque son dos hechos distintos.
 */

/**
 * NO CONCEDIDO. Vacío honesto, no aviso: explica qué es, para qué sirve y
 * cómo se pide. Sin amarillo, sin alarma.
 */
export function PlanNoIncluye({
  que,
}: {
  que: 'claves' | 'webhooks'
}) {
  const esClaves = que === 'claves'
  return (
    <EmptyState
      variant="card"
      icon={
        esClaves ? (
          <KeyRound className="h-6 w-6" aria-hidden />
        ) : (
          <Webhook className="h-6 w-6" aria-hidden />
        )
      }
      title={esClaves ? 'Las claves de API no están activadas' : 'Los webhooks no están activados'}
      description={
        esClaves
          ? 'Con una clave, tu propio sistema o herramientas como Zapier pueden consultar los datos de tu negocio. No viene activada de serie porque abre tus datos a programas de fuera: la activamos cuando nos digas para qué la necesitas.'
          : 'Un webhook avisa a tu servidor en el momento en que pasa algo en Membego — una visita, un canje, una cita. No viene activado de serie: lo habilitamos cuando nos digas a qué sistema quieres que avisemos.'
      }
      action={
        <Button asChild>
          <Link href="/admin/tickets">Pedir que se active</Link>
        </Button>
      }
      secondaryAction={
        <Button variant="ghost" asChild>
          <Link href="/admin/integraciones/desarrolladores">Ver qué ofrece la API</Link>
        </Button>
      }
    />
  )
}

/**
 * CONCEDIDO Y LLENO. Esto sí es un aviso, porque hay una acción concreta que
 * la empresa puede tomar ahora mismo: revocar una que ya no use.
 */
export function LimiteAlcanzado({
  que,
  limite,
}: {
  que: 'claves' | 'webhooks'
  limite: number
}) {
  const nombre = que === 'claves' ? 'claves de API' : 'webhooks'
  return (
    <StatusBanner variant="info" title={`Llegaste al máximo de ${nombre}`}>
      Tu plan incluye {limite} {limite === 1 ? 'activa' : 'activas'}. Para crear otra, revoca
      alguna de las de abajo o escríbenos para ampliarlo.
    </StatusBanner>
  )
}

/**
 * Candado discreto para la cabecera de una tarjeta cuya función no está
 * concedida. Sustituye al botón de crear: enseñar un botón que va a rechazar
 * la operación es un interruptor pintado.
 */
export function CandadoPlan({ titulo }: { titulo: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
      title={titulo}
    >
      <Lock className="h-3.5 w-3.5" aria-hidden />
      No activado
    </span>
  )
}
