import { getMigracionesPendientes } from '@/modules/superadmin/migraciones'
import { TriangleAlert } from 'lucide-react'

/**
 * Banner de migraciones pendientes para el panel del superadmin.
 *
 * Es un componente de servidor y NO renderiza nada cuando todo está al día,
 * así que no estorba en el 99% de los casos. Cuando aparece, significa que hay
 * código desplegado esperando un SQL que nadie corrió — la falla silenciosa
 * que ya nos costó días con las capacidades.
 */
export async function AvisoMigraciones() {
  const pendientes = await getMigracionesPendientes()
  if (pendientes.length === 0) return null

  return (
    <div className="rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4">
      <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        {pendientes.length === 1
          ? 'Hay una migración de base de datos sin correr'
          : `Hay ${pendientes.length} migraciones de base de datos sin correr`}
      </p>
      <p className="mt-1 text-sm text-amber-700/90 dark:text-amber-300/90">
        El código ya está desplegado, pero estas funciones no van a trabajar hasta
        que corras su SQL en el editor de Supabase:
      </p>
      <ul className="mt-2 space-y-1.5">
        {pendientes.map((m) => (
          <li key={m.migracion} className="text-sm text-amber-800 dark:text-amber-200">
            <code className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-xs">
              prisma/migrations/{m.migracion}/migration.sql
            </code>
            <span className="ml-2 text-amber-700/90 dark:text-amber-300/90">
              → {m.afecta.join(', ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/80">
        Para la revisión completa del esquema: <code className="font-mono">npm run db:doctor</code>
      </p>
    </div>
  )
}
