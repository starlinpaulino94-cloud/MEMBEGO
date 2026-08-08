import Link from 'next/link'
import Image from 'next/image'

/**
 * Superficie de autenticación — BLANCA (DS 2.0 · Fase 2).
 *
 * Era navy a pantalla completa. El navy es un color de herramienta: transmite
 * "panel de control", que es justo lo que alguien NO está haciendo cuando se
 * registra. Registrarse es entrar, y entrar debe sentirse abierto y claro.
 *
 * Sigue siendo una sección de un solo tema a propósito, igual que la landing:
 * `color-scheme: light` evita que el navegador pinte los controles en oscuro,
 * y la clase `theme-landing` fija la paleta clara aunque la persona tenga la
 * app en modo oscuro. Un formulario de registro no debería cambiar de aspecto
 * según una preferencia que se eligió en otra parte del producto.
 *
 * El navy sobrevive en un solo sitio: el pie. Ahí sí aporta — cierra la
 * página y recuerda de quién es el producto sin competir con el formulario.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="theme-landing flex min-h-screen flex-col bg-background text-foreground">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-14">
        <div className="mb-8 flex flex-col items-center gap-2.5">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg text-2xl font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
          >
            <Image src="/logo.svg" alt="" width={38} height={38} priority aria-hidden />
            <span>
              Membe<span className="text-gradient">Go</span>
            </span>
          </Link>
          <p className="text-overline">Conecta · Disfruta · Ahorra</p>
        </div>

        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="border-t border-border bg-sidebar py-5 text-center">
        <p className="text-caption text-sidebar-foreground">
          © {new Date().getFullYear()} MembeGo ·{' '}
          <Link href="/privacy" className="underline-offset-2 hover:underline">
            Privacidad
          </Link>{' '}
          ·{' '}
          <Link href="/terms" className="underline-offset-2 hover:underline">
            Términos
          </Link>
        </p>
      </footer>
    </div>
  )
}
