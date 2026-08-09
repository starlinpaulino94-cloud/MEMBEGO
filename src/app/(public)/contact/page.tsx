import type { Metadata } from 'next'
import { Mail, Building2, MessageCircle } from 'lucide-react'
import { buildWaLink, SOPORTE_PLATAFORMA } from '@/lib/soporte'

export const metadata: Metadata = {
  title: 'Contacto',
  description: 'Ponte en contacto con el equipo de MembeGo.',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  const waLink = buildWaLink(
    SOPORTE_PLATAFORMA.whatsappCodigoPais,
    SOPORTE_PLATAFORMA.whatsappNumero,
    'Hola, necesito ayuda con MembeGo.'
  )

  return (
    <div className="min-h-screen bg-card">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-h1 text-foreground">Contacto</h1>
        <p className="text-muted-foreground mt-2">
          ¿Tienes preguntas o quieres registrar tu empresa en MembeGo? Escríbenos.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border p-6">
            <MessageCircle className="h-6 w-6 text-success" />
            <h2 className="mt-3 font-semibold text-foreground">WhatsApp</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Ayuda y soporte, respuesta rápida
            </p>
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-sm font-medium"
            >
              {SOPORTE_PLATAFORMA.whatsappDisplay}
            </a>
          </div>

          <div className="rounded-xl border border-border p-6">
            <Mail className="h-6 w-6 text-primary" />
            <h2 className="mt-3 font-semibold text-foreground">Correo</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Soporte general y clientes
            </p>
            <a
              href={`mailto:${SOPORTE_PLATAFORMA.email}`}
              className="text-primary hover:underline text-sm font-medium"
            >
              {SOPORTE_PLATAFORMA.email}
            </a>
          </div>

          <div className="rounded-xl border border-border p-6">
            <Building2 className="h-6 w-6 text-primary" />
            <h2 className="mt-3 font-semibold text-foreground">Empresas</h2>
            <p className="text-muted-foreground text-sm mt-1">
              ¿Quieres ofrecer membresías a tus clientes?
            </p>
            <a
              href="mailto:empresas@membego.com"
              className="text-primary hover:underline text-sm font-medium"
            >
              empresas@membego.com
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
