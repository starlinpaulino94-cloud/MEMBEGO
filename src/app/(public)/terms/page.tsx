import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Términos y Condiciones',
  description: 'Términos y condiciones de uso de la plataforma MembeGo.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-card">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 prose prose-neutral">
        <h1 className="text-h1 text-foreground">Términos y Condiciones</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Última actualización: julio de 2026
        </p>

        <section className="mt-8 space-y-6 text-foreground leading-relaxed">
          <div>
            <h2 className="text-h2 text-foreground">1. Aceptación</h2>
            <p>
              Al acceder y utilizar MembeGo aceptas estos Términos y Condiciones.
              Si no estás de acuerdo, no utilices la plataforma.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">2. Uso del servicio</h2>
            <p>
              MembeGo permite a las empresas gestionar membresías digitales y a los
              clientes activar y usar dichas membresías mediante un código QR. Te
              comprometes a proporcionar información veraz y a no utilizar la
              plataforma con fines fraudulentos.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">3. Cuentas y seguridad</h2>
            <p>
              Eres responsable de mantener la confidencialidad de tus credenciales y
              de toda actividad realizada desde tu cuenta.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">4. Membresías y pagos</h2>
            <p>
              Las condiciones, precios y beneficios de cada membresía los define la
              empresa correspondiente. MembeGo actúa como plataforma tecnológica y no
              es responsable de la prestación del servicio ofrecido por cada empresa.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">5. Contacto</h2>
            <p>
              Para cualquier consulta sobre estos términos, escríbenos a{' '}
              <a href="mailto:contacto@membego.com" className="text-primary hover:underline">
                contacto@membego.com
              </a>{' '}
              o visita nuestra página de{' '}
              <Link href="/contact" className="text-primary hover:underline">
                contacto
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
