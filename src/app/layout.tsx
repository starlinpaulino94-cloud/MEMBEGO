import type { Metadata } from 'next'
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/ThemeProvider'
import { RegistrarSW } from '@/components/system/RegistrarSW'
import { SITE_NAME, SITE_DESCRIPTION, getAppUrl } from '@/lib/site'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Fuente display para títulos: geométrica y cálida, distingue la marca del
// texto de lectura (Geist). Variable font: todos los pesos en un archivo.
const jakarta = Plus_Jakarta_Sans({
  variable: '--font-display',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: getAppUrl(),
    locale: 'es_ES',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MembeGo — Conecta. Disfruta. Ahorra.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ['/og-image.png'],
  },
  icons: {
    // Google exige un favicon de al menos 48x48 (múltiplo de 48) para mostrar
    // el logo del sitio en los resultados de búsqueda. favicon.ico es
    // multi-resolución (16/32/48) para que la pestaña se vea nítida y Google
    // tenga su entrada de 48px.
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/logo.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
}

/**
 * Datos estructurados (JSON-LD): así Google asocia el logo a la marca y
 * puede mostrarlo en los resultados de búsqueda y el panel de conocimiento.
 */
function StructuredData() {
  const base = getAppUrl()
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: base,
    logo: `${base}/icon-512.png`,
    description: SITE_DESCRIPTION,
    slogan: 'Conecta. Disfruta. Ahorra.',
  }
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: base,
    inLanguage: 'es',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${base}/empresas?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
      />
    </>
  )
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes escribe la clase del tema en <html>
    // antes de hidratar (evita el flash de tema incorrecto).
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jakarta.variable} antialiased`}
      >
        <ThemeProvider>
          <StructuredData />
          {/* Fase 7 · el escáner de pista tiene que poder ABRIR sin red. */}
          <RegistrarSW />
          {children}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
