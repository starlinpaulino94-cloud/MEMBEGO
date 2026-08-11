import Link from 'next/link'
import { Compass, Sparkles } from 'lucide-react'
import { EmptyState } from '@/components/system/EmptyState'
import { Button } from '@/components/ui/button'

/**
 * EL ESTADO «TODAVÍA NO ERES CLIENTE DE NINGÚN NEGOCIO».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UN COMPONENTE PARA ESTO
 *
 * Hasta ahora este estado no podía existir: quien entraba sin ficha era
 * afiliado automáticamente a «la empresa principal». Al dejar de hacerse
 * —porque afiliar a alguien a un negocio que no ha elegido es inventarle una
 * relación comercial—, dieciocho pantallas se encontraron con un `clienteId`
 * nulo por primera vez.
 *
 * Once de ellas NI SIQUIERA lo comprobaban. Las otras siete respondían «No
 * autorizado», que además de feo es falso: la persona está perfectamente
 * autorizada, lo que pasa es que todavía no tiene nada ahí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO ES UN ERROR, ES EL PRIMER DÍA
 *
 * Alguien que acaba de crear su cuenta no ha hecho nada mal. La pantalla tiene
 * que decirle qué hay y cómo empezar — nunca dejarle una página en blanco ni
 * un mensaje que suene a que le han cerrado la puerta.
 *
 * Es la regla del § 13 del encargo: «un usuario nuevo nunca debería encontrar
 * un inicio vacío».
 */
export function SinEmpresaTodavia({
  que,
  detalle,
}: {
  /** Qué es lo que no tiene, en plural y en su idioma: «beneficios», «citas». */
  que: string
  /** Frase extra para explicar cómo se consigue lo de esta pantalla. */
  detalle?: string
}) {
  return (
    <EmptyState
      icon={Sparkles}
      title={`Aún no tienes ${que}`}
      description={
        detalle ??
        'Cuando adquieras una recompensa o te unas a un negocio, lo verás aquí. ' +
          'Explora lo que hay disponible cerca de ti para empezar.'
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild size="lg">
            <Link href="/cliente/promociones">
              <Sparkles className="h-4 w-4" aria-hidden /> Ver ofertas
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/cliente/cerca">
              <Compass className="h-4 w-4" aria-hidden /> Negocios cerca de mí
            </Link>
          </Button>
        </div>
      }
    />
  )
}
