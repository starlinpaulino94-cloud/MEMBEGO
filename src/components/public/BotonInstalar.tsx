'use client'

import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { mostrarGuiaInstalacion, pedirInstalacion, useInstalacion } from '@/lib/pwa/instalacion'

/**
 * El botón de /descargar. Si el navegador puede instalar con un clic, lo hace;
 * en iPhone abre la guía; si ya corre instalada, lo dice. No se pinta hasta
 * saber en qué caso estamos (en el servidor no se sabe).
 */
export function BotonInstalar() {
  const { instalable, instalada, esIOS, esNavegadorSinInstalacionEnIOS } = useInstalacion()

  if (instalada) {
    return <p className="text-sm font-medium text-success-ink">Ya tienes MembeGo instalado en este dispositivo.</p>
  }
  if (!instalable && !(esIOS && !esNavegadorSinInstalacionEnIOS)) return null

  const clic = async () => {
    if (instalable) {
      const r = await pedirInstalacion()
      if (r === 'accepted') toast.success('MembeGo se está instalando en tu dispositivo.')
      return
    }
    mostrarGuiaInstalacion()
  }

  return (
    <button
      type="button"
      onClick={clic}
      className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow transition hover:opacity-95"
      data-testid="boton-instalar"
    >
      <Download className="h-4 w-4" aria-hidden />
      {instalable ? 'Instalar MembeGo ahora' : 'Instalar en mi iPhone'}
    </button>
  )
}
