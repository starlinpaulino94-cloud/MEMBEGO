'use client'

import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { toast } from 'sonner'
import { useNotificacionesPush } from '@/hooks/use-notificaciones-push'
import { pushSoportado, sincronizarPush } from '@/lib/pwa/push-cliente'
import { mostrarGuiaInstalacion, useInstalacion } from '@/lib/pwa/instalacion'

/**
 * «ACTIVA LAS NOTIFICACIONES» · el aviso dentro de la app, para quien ya entró.
 *
 * Se monta en las carcasas con sesión (cliente, panel, mostrador). Pide el
 * permiso del navegador SOLO desde el botón: pedirlo nada más cargar es la
 * forma de que la gente lo bloquee para siempre, y un permiso bloqueado no se
 * puede volver a pedir desde la web.
 *
 * Además, cada vez que se monta vuelve a poner la suscripción (si la hay) a
 * nombre de la sesión actual: así un teléfono compartido no sigue avisando a
 * quien cerró sesión.
 */
const CLAVE_DESCARTADO = 'membego:push:descartado'
const DIAS_SILENCIO = 7

function descartadoRecientemente(): boolean {
  try {
    const desde = Number(localStorage.getItem(CLAVE_DESCARTADO) ?? 0)
    return desde > 0 && Date.now() - desde < DIAS_SILENCIO * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export function NotificacionesPush() {
  const { estado, ocupado, activar } = useNotificacionesPush()
  const { esIOS, instalada, esNavegadorSinInstalacionEnIOS } = useInstalacion()
  // Leer localStorage en el inicializador no desincroniza la hidratación:
  // mientras `estado` es null (servidor y primera pintura) no se pinta nada.
  const [oculto, setOculto] = useState(() => typeof window !== 'undefined' && descartadoRecientemente())

  // Una vez por carga completa (la carcasa sobrevive a las navegaciones del
  // cliente): si este navegador está suscrito, queda a nombre de la sesión actual.
  useEffect(() => {
    void sincronizarPush()
  }, [])

  if (oculto || estado === null) return null

  // iPhone en Safari (sin instalar): el navegador no deja suscribirse hasta que
  // MembeGo esté en la pantalla de inicio. Se explica, en vez de callar.
  const iosSinInstalar = esIOS && !instalada && !pushSoportado() && !esNavegadorSinInstalacionEnIOS
  if (estado !== 'inactivo' && !iosSinInstalar) return null

  const cerrar = () => {
    try {
      localStorage.setItem(CLAVE_DESCARTADO, String(Date.now()))
    } catch {
      // Navegación privada: se volverá a ofrecer en la próxima visita.
    }
    setOculto(true)
  }

  const encender = async () => {
    const r = await activar()
    if (r.ok) {
      toast.success('Listo: te avisaremos aunque no tengas MembeGo abierto.')
      setOculto(true)
      return
    }
    if (r.motivo === 'bloqueado') {
      toast.error('Las notificaciones están bloqueadas en este navegador. Actívalas desde los ajustes del sitio.')
      setOculto(true)
    } else if (r.motivo === 'sin-sesion') {
      toast.error('Tu sesión caducó. Entra de nuevo para activar las notificaciones.')
    } else if (r.motivo === 'sin-worker') {
      toast.error('Las notificaciones solo funcionan en la versión publicada de MembeGo.')
    } else {
      toast.error('No pudimos activar las notificaciones. Inténtalo de nuevo.')
    }
  }

  return (
    <div
      role="region"
      aria-label="Activar notificaciones"
      className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      data-testid="aviso-push"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <BellRing className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-tight text-foreground">Entérate de todo, aunque no estés en la app</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {iosSinInstalar
            ? 'En iPhone, instala MembeGo en tu pantalla de inicio para recibir avisos con el teléfono bloqueado.'
            : 'Pagos, vencimientos y promociones te llegan como notificación, con el teléfono bloqueado o MembeGo cerrado.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {iosSinInstalar ? (
            <button
              type="button"
              onClick={() => {
                mostrarGuiaInstalacion()
                setOculto(true)
              }}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
            >
              Ver cómo instalar
            </button>
          ) : (
            <button
              type="button"
              onClick={encender}
              disabled={ocupado}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
            >
              {ocupado ? 'Activando…' : 'Activar notificaciones'}
            </button>
          )}
          <button
            type="button"
            onClick={cerrar}
            className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Ahora no
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar"
        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
