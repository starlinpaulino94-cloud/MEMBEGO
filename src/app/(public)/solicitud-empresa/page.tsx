import { Store, ClipboardList, ImageIcon, Rocket } from 'lucide-react'
import { SolicitudEmpresaForm } from '@/components/public/SolicitudEmpresaForm'

export const metadata = {
  title: 'Solicita tu empresa - MembeGo',
  description:
    'Cuéntanos todo sobre tu negocio: nosotros lo dejamos listo en MembeGo con tus planes, tu promoción de arranque y tu marca.',
}

/**
 * Etapa CONCIERGE del alta B2B: el negocio no se crea solo — llena esta
 * solicitud (con imágenes incluidas) y el equipo de MembeGo la revisa en
 * /superadmin/solicitudes, lo contacta y crea la empresa con un clic.
 * Convive con /registro-empresa (autoservicio): este camino es el que se
 * envía por WhatsApp a los negocios que MembeGo está reclutando.
 */
const PASOS = [
  { icon: ClipboardList, texto: 'Llena esta solicitud con calma: se guarda en tu navegador mientras avanzas.' },
  { icon: ImageIcon, texto: 'Adjunta tu logo, tu foto de portada y la imagen de tu promoción.' },
  { icon: Rocket, texto: 'Nuestro equipo te contacta y deja tu negocio listo para vender.' },
]

export default function SolicitudEmpresaPage() {
  return (
    <div className="min-h-screen bg-card">
      <section className="relative overflow-hidden surface-hero py-12">
        <div className="absolute -top-16 right-10 h-56 w-56 rounded-full bg-primary/30 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 text-white sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/80 ring-1 ring-inset ring-white/20">
            <Store className="h-4 w-4" /> Para negocios
          </span>
          <h1 className="mt-4 text-display">Vamos a crear tu negocio en MembeGo</h1>
          <p className="mt-2 max-w-xl text-body text-white/80">
            Cuéntanos todo aquí — nosotros hacemos el resto: tu página, tus planes de
            membresía, tu promoción de arranque y tu acceso de administrador.
          </p>
          <ul className="mt-5 space-y-2">
            {PASOS.map((p) => (
              <li key={p.texto} className="flex items-start gap-2 text-sm text-white/85">
                <p.icon className="mt-0.5 h-4 w-4 shrink-0" /> {p.texto}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <SolicitudEmpresaForm />
      </section>
    </div>
  )
}
