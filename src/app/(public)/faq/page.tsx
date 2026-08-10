import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { SITE_NAME, getAppUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Preguntas frecuentes',
  description:
    'Respuestas a las preguntas más comunes sobre MembeGo: membresías digitales, promociones, QR, referidos y registro de empresas.',
  alternates: { canonical: '/faq' },
}

const FAQS = [
  {
    q: '¿Qué es MembeGo?',
    a: 'MembeGo es una plataforma de membresías digitales: las empresas crean planes, promociones y beneficios, y sus clientes los adquieren y canjean con un código QR desde su teléfono.',
  },
  {
    q: '¿Necesito instalar una aplicación?',
    a: 'No. MembeGo funciona directamente en el navegador. Puedes añadirlo a tu pantalla de inicio como una app (PWA) para acceder con un toque.',
  },
  {
    q: '¿Cómo funcionan las promociones y beneficios?',
    a: 'Cada promoción es un beneficio digital que puedes adquirir (gratis o de pago). Al adquirirla recibes un QR único que el negocio valida al canjearla. Puedes ver tus promociones adquiridas, su vigencia y sus usos restantes.',
  },
  {
    q: '¿Cómo se validan las membresías y los beneficios?',
    a: 'Con un QR de un solo uso. El personal del negocio lo escanea con la cámara o con un lector físico. Mientras te queden usos disponibles, verás tu código vigente en la app.',
  },
  {
    q: '¿Cómo funcionan los referidos?',
    a: 'Compartes un enlace de invitación con el beneficio y una duración. Quien lo abre ve una página con la oferta y un contador; al registrarse recibe su beneficio y tú ganas la recompensa que la empresa haya configurado.',
  },
  {
    q: '¿Cómo registro mi empresa?',
    a: 'Desde “Para empresas” completas el formulario de registro. Podrás crear tus planes, promociones y equipo, y empezar a validar con QR de inmediato.',
  },
  {
    q: '¿Los pagos se procesan en la plataforma?',
    a: 'Hoy las compras se confirman por transferencia con validación del administrador. La arquitectura está preparada para integrar pasarelas de pago en el futuro.',
  },
  {
    q: '¿Mis datos están seguros?',
    a: 'Sí. El acceso está controlado por roles y permisos, y los datos están aislados por empresa. Usamos conexiones cifradas y buenas prácticas de seguridad.',
  },
]

export default function FaqPage() {
  // Datos estructurados FAQ (JSON-LD) para resultados enriquecidos en Google.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <div className="min-h-screen bg-card">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-h1 text-foreground">
          Preguntas frecuentes
        </h1>
        <p className="mt-3 text-body text-muted-foreground">
          Todo lo que necesitas saber sobre {SITE_NAME}. ¿No encuentras tu respuesta?{' '}
          <Link href="/contact" className="text-primary hover:underline">
            Escríbenos
          </Link>
          .
        </p>

        <div className="mt-10">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium text-foreground">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        <p className="mt-10 text-sm text-muted-foreground">
          ¿Eres una empresa?{' '}
          <Link href="/registro-empresa" className="text-primary hover:underline">
            Registra tu negocio
          </Link>{' '}
          y empieza a ofrecer membresías. Más info en{' '}
          <a href={getAppUrl()} className="text-primary hover:underline">
            {getAppUrl().replace(/^https?:\/\//, '')}
          </a>
          .
        </p>
      </div>
    </div>
  )
}
