import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Smartphone, Share, PlusSquare, Zap, WifiOff, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Descarga la app',
  description:
    'Usa MembeGo desde tu navegador o instálalo como app en tu teléfono (PWA). Tus membresías y beneficios, siempre a un toque.',
  alternates: { canonical: '/descargar' },
}

const PASOS_IOS = [
  { icon: Share, texto: 'Abre membego.com en Safari y toca el botón Compartir.' },
  { icon: PlusSquare, texto: 'Elige “Añadir a pantalla de inicio”.' },
  { icon: Smartphone, texto: 'Confirma. MembeGo quedará como una app en tu teléfono.' },
]

const PASOS_ANDROID = [
  { icon: Share, texto: 'Abre membego.com en Chrome y toca el menú (⋮).' },
  { icon: PlusSquare, texto: 'Elige “Instalar aplicación” o “Añadir a pantalla de inicio”.' },
  { icon: Smartphone, texto: 'Confirma y ábrela desde tu pantalla de inicio.' },
]

function Pasos({ titulo, pasos }: { titulo: string; pasos: typeof PASOS_IOS }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-card">
      <h2 className="font-semibold text-foreground">{titulo}</h2>
      <ol className="mt-4 space-y-4">
        {pasos.map((p, i) => {
          const Icon = p.icon
          return (
            <li key={i} className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </span>
              <span className="text-sm text-muted-foreground">{p.texto}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default function DescargarPage() {
  return (
    <div className="min-h-screen bg-card">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Image src="/logo.svg" alt="MembeGo" width={40} height={40} />
          </span>
          <h1 className="mt-5 text-h1 text-foreground">
            Lleva MembeGo en tu bolsillo
          </h1>
          <p className="mt-3 max-w-xl text-body text-muted-foreground">
            No necesitas descargar nada de una tienda: MembeGo funciona en tu navegador
            y puedes instalarlo como app en segundos.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/80 p-5 text-center">
            <Zap className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-2 text-sm font-medium text-foreground">Instantáneo</p>
            <p className="text-caption text-muted-foreground">Sin esperar descargas</p>
          </div>
          <div className="rounded-2xl border border-border/80 p-5 text-center">
            <Smartphone className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-2 text-sm font-medium text-foreground">Como una app</p>
            <p className="text-caption text-muted-foreground">En tu pantalla de inicio</p>
          </div>
          <div className="rounded-2xl border border-border/80 p-5 text-center">
            <WifiOff className="mx-auto h-6 w-6 text-primary" />
            <p className="mt-2 text-sm font-medium text-foreground">Siempre a mano</p>
            <p className="text-caption text-muted-foreground">Tus QR cuando los necesites</p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Pasos titulo="En iPhone / iPad" pasos={PASOS_IOS} />
          <Pasos titulo="En Android" pasos={PASOS_ANDROID} />
        </div>

        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <Link
            href="/registro/cuenta"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow transition hover:opacity-95"
          >
            Crear mi cuenta <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Ingresar
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
