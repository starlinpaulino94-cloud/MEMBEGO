'use client'

import { useRouter } from 'next/navigation'

/** «Filas por pág.»: cambiar el número navega al enlace ya armado por el servidor. */
export function SelectorFilas({ filas, opciones, hrefs }: { filas: number; opciones: number[]; hrefs: Record<number, string> }) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-1">
      <span className="text-sv2-outline">Filas por pág:</span>
      <select
        value={filas}
        onChange={(e) => router.push(hrefs[Number(e.target.value)] ?? '')}
        className="cursor-pointer rounded-[4px] bg-sv2-soft px-1.5 py-0.5 text-[13px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-sv2-accent"
        data-testid="filas-por-pagina"
      >
        {opciones.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  )
}
