'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Download, PlusSquare, Share, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  EVENTO_MOSTRAR_GUIA,
  instalacionDescartadaRecientemente,
  pedirInstalacion,
  recordarDescarteDeInstalacion,
  useInstalacion,
} from '@/lib/pwa/instalacion'

/**
 * «INSTALA MEMBEGO» · el aviso que aparece solo al entrar.
 *
 * Montado en el layout raíz: sale tanto en la landing como dentro de la app,
 * que es donde la gente está cuando decide que quiere el acceso directo.
 *
 * Cuándo se enseña:
 *  - Android / escritorio (Chrome, Edge, Samsung): cuando el navegador dice que
 *    se puede instalar (`beforeinstallprompt`). El botón abre el diálogo nativo.
 *  - iPhone / iPad en Safari: no hay diálogo; se enseñan los dos pasos.
 *  - Nunca si ya corre instalada, ni durante 14 días tras «Ahora no».
 *
 * Y con unos segundos de retraso: que primero se vea la página que la persona
 * vino a ver. Un aviso que tapa el contenido antes de cargarlo se cierra sin
 * leerlo.
 */
const RETRASO_MS = 2500

export function InstalarApp() {
  const { instalable, instalada, esIOS, esNavegadorSinInstalacionEnIOS } = useInstalacion()
  const [visible, setVisible] = useState(false)
  const [forzado, setForzado] = useState(false)
  const [guiaAbierta, setGuiaAbierta] = useState(false)

  const puedeOfrecer = !instalada && (instalable || (esIOS && !esNavegadorSinInstalacionEnIOS))

  useEffect(() => {
    if (!puedeOfrecer) return
    if (!forzado && instalacionDescartadaRecientemente()) return
    const t = window.setTimeout(() => setVisible(true), forzado ? 0 : RETRASO_MS)
    return () => window.clearTimeout(t)
  }, [puedeOfrecer, forzado])

  // Otro sitio de la app (el botón de /descargar, el aviso de notificaciones en
  // iPhone) pide que se enseñe YA, con la guía desplegada.
  useEffect(() => {
    const abrir = () => {
      setForzado(true)
      setGuiaAbierta(true)
      setVisible(true)
    }
    window.addEventListener(EVENTO_MOSTRAR_GUIA, abrir)
    return () => window.removeEventListener(EVENTO_MOSTRAR_GUIA, abrir)
  }, [])

  if (!visible || instalada) return null
  if (!instalable && !(esIOS && !esNavegadorSinInstalacionEnIOS)) return null

  const cerrar = () => {
    recordarDescarteDeInstalacion()
    setVisible(false)
  }

  const instalar = async () => {
    const resultado = await pedirInstalacion()
    if (resultado === 'accepted') {
      toast.success('MembeGo se está instalando en tu dispositivo.')
      setVisible(false)
    } else if (resultado === 'dismissed') {
      cerrar()
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Instalar MembeGo"
      className="theme-landing fixed inset-x-0 bottom-0 z-toast px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm sm:px-0 sm:pb-0"
      data-testid="aviso-instalar"
    >
      <div className="rounded-2xl border border-border bg-card p-3 text-foreground shadow-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Image src="/icon-192.png" alt="" width={32} height={32} className="rounded-lg" />
          </span>
          <button
            type="button"
            onClick={instalable ? instalar : () => setGuiaAbierta(true)}
            className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            <Download className="h-4 w-4 shrink-0" aria-hidden />
            Instalar MembeGo ahora
          </button>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* iPhone / iPad: no hay diálogo nativo; al pulsar el botón se enseñan los dos pasos. */}
        {!instalable && guiaAbierta && (
          <ol className="mt-3 space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
            <li className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Share className="h-4 w-4" aria-hidden />
              </span>
              <span>
                En Safari, toca <strong>Compartir</strong> (el cuadrado con la flecha).
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <PlusSquare className="h-4 w-4" aria-hidden />
              </span>
              <span>
                Elige <strong>Añadir a pantalla de inicio</strong> y confirma.
              </span>
            </li>
          </ol>
        )}
      </div>
    </div>
  )
}
