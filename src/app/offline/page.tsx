import { WifiOff } from 'lucide-react'

/**
 * Página que sirve el service worker cuando no hay red y la ruta pedida no
 * está en caché (Fase 7, punto 28).
 *
 * Es estática a propósito: no consulta la base, no lee la sesión y no importa
 * nada del dominio. Si dependiera de cualquiera de esas tres cosas no podría
 * renderizarse en el único momento en que hace falta.
 */
export const dynamic = 'force-static'

export const metadata = {
  title: 'Sin conexión · MembeGo',
  robots: { index: false },
}

export default function SinConexion() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-16 text-center">
      <div className="max-w-md space-y-4">
        <WifiOff className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">Sin conexión</h1>
        <p className="text-muted-foreground">
          No hay red ahora mismo. Esta pantalla no necesita internet, pero la que
          buscabas sí.
        </p>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-left text-sm">
          <p className="font-medium">Si estás en la pista:</p>
          <p className="mt-1 text-muted-foreground">
            Vuelve al escáner y sigue atendiendo. Los registros que hagas se
            guardan en el teléfono y se envían solos en cuanto vuelva la señal.
          </p>
        </div>
      </div>
    </main>
  )
}
