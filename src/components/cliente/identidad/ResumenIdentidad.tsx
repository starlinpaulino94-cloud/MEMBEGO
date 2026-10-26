import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import type { PanelDeIdentidad } from '@/modules/identidad/identidadPuerta'
import type { TonoDeVista } from '@/modules/identidad/vistaCore'

const TONO: Record<TonoDeVista, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  exito: 'success',
  aviso: 'warning',
  peligro: 'danger',
  info: 'info',
  neutro: 'neutral',
}

/**
 * El resumen de la verificación de identidad dentro de Configuración: el estado y un
 * botón a su pantalla. Es lo único que Configuración sabe del tema; todo lo demás vive en
 * `/cliente/identidad`. No se pinta si la verificación no se ofrece (apagada y sin historial).
 */
export function ResumenIdentidad({ panel }: { panel: PanelDeIdentidad | null }) {
  if (!panel?.visible) return null
  const { vista } = panel
  const quiereAccion = vista.accion === 'verificar' || vista.accion === 'continuar' || vista.accion === 'reintentar'
  return (
    <Card className="border-border/60 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-h4">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          Verificación de identidad
          <StatusChip tone={TONO[vista.tono]} className="ml-auto">
            {vista.etiqueta}
          </StatusChip>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-small text-muted-foreground">{vista.titulo}</p>
        <Button asChild variant={quiereAccion ? 'default' : 'outline'}>
          <Link href="/cliente/identidad">{quiereAccion ? (vista.textoAccion ?? 'Verificar') : 'Ver detalles'}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
