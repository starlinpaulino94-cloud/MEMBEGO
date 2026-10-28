'use client'

import { BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useNotificacionesPush } from '@/hooks/use-notificaciones-push'
import { mostrarGuiaInstalacion, useInstalacion } from '@/lib/pwa/instalacion'
import { pushSoportado } from '@/lib/pwa/push-cliente'

/**
 * Configuración → «Notificaciones en este dispositivo». Es el sitio al que
 * volver si se dijo «Ahora no» al aviso, y donde apagarlas.
 */
export function NotificacionesPushAjuste() {
  const { estado, ocupado, activar, desactivar } = useNotificacionesPush()
  const { esIOS, instalada, esNavegadorSinInstalacionEnIOS } = useInstalacion()

  const iosSinInstalar = esIOS && !instalada && !pushSoportado() && !esNavegadorSinInstalacionEnIOS

  let texto: string
  let accion: React.ReactNode = null
  if (estado === null) {
    texto = 'Comprobando…'
  } else if (iosSinInstalar) {
    texto = 'En iPhone, instala MembeGo en tu pantalla de inicio para recibir avisos con el teléfono bloqueado.'
    accion = (
      <Button type="button" variant="outline" onClick={mostrarGuiaInstalacion}>
        Ver cómo instalar
      </Button>
    )
  } else if (estado === 'no-soportado') {
    texto = 'Este navegador no admite notificaciones fuera de la app.'
  } else if (estado === 'no-configurado') {
    texto = 'Las notificaciones push no están disponibles por ahora.'
  } else if (estado === 'bloqueado') {
    texto = 'Bloqueadas en este navegador. Permítelas desde los ajustes del sitio para volver a activarlas.'
  } else if (estado === 'activo') {
    texto = 'Activadas: te avisamos aunque MembeGo esté cerrado.'
    accion = (
      <Button type="button" variant="outline" disabled={ocupado} onClick={() => desactivar()}>
        Desactivar aquí
      </Button>
    )
  } else {
    texto = 'Pagos, vencimientos y promociones, con el teléfono bloqueado o la app cerrada.'
    accion = (
      <Button
        type="button"
        disabled={ocupado}
        onClick={async () => {
          const r = await activar()
          if (r.ok) toast.success('Notificaciones activadas en este dispositivo.')
          else if (r.motivo === 'bloqueado') toast.error('Las notificaciones están bloqueadas en este navegador.')
          else if (r.motivo === 'sin-worker') toast.error('Solo disponible en la versión publicada de MembeGo.')
          else toast.error('No pudimos activarlas. Inténtalo de nuevo.')
        }}
      >
        {ocupado ? 'Activando…' : 'Activar'}
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
          <BellRing className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-small text-muted-foreground">{texto}</p>
      </div>
      {accion}
    </div>
  )
}
