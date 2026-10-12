import Link from 'next/link'
import Image from 'next/image'
import { EnlaceDeInicio } from '@/components/public/EnlaceDeInicio'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[oklch(0.14_0.035_260)] px-4 py-12 text-center text-white">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 text-2xl font-bold"
      >
        <Image src="/logo.svg" alt="MembeGo" width={36} height={36} priority />
        <span>
          Membe<span className="text-gradient">Go</span>
        </span>
      </Link>
      <p className="text-6xl font-bold text-gradient">404</p>
      <h1 className="mt-4 text-2xl font-bold">Página no encontrada</h1>
      <p className="mt-2 max-w-md text-white/60">
        La página que buscas no existe o fue movida.
      </p>
      <EnlaceDeInicio className="mt-8 bg-primary hover:bg-primary/90" />
    </div>
  )
}
