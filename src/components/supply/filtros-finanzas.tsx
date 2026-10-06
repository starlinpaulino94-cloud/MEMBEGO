import Link from 'next/link'

/**
 * Filtros por enlace (sin JS): estado y proveedor como chips. Cada chip es
 * una URL, así que el filtro se comparte, se guarda y se imprime.
 */
export function FiltrosChips({
  base,
  parametro,
  actual,
  opciones,
  otros = {},
}: {
  base: string
  parametro: string
  actual: string
  opciones: { value: string; label: string }[]
  /** Otros parámetros que se conservan al cambiar este. */
  otros?: Record<string, string | undefined>
}) {
  const url = (valor: string) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(otros)) if (v) q.set(k, v)
    if (valor) q.set(parametro, valor)
    const s = q.toString()
    return s ? `${base}?${s}` : base
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={url('')} className={chip(actual === '')}>
        Todos
      </Link>
      {opciones.map((o) => (
        <Link key={o.value} href={url(o.value)} className={chip(actual === o.value)}>
          {o.label}
        </Link>
      ))}
    </div>
  )
}

function chip(activo: boolean): string {
  return `rounded-full border px-3 py-1 text-sm ${activo ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`
}

/** Selector de proveedor que navega al enviar (formulario GET). */
export function FiltroProveedor({
  base,
  actual,
  proveedores,
  otros = {},
}: {
  base: string
  actual: string
  proveedores: { value: string; label: string }[]
  otros?: Record<string, string | undefined>
}) {
  return (
    <form action={base} method="get" className="flex items-center gap-2">
      {Object.entries(otros).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} aria-label={k} /> : null))}
      <label htmlFor="proveedor" className="text-sm text-muted-foreground">
        Proveedor
      </label>
      <select
        id="proveedor"
        name="proveedor"
        defaultValue={actual}
        className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
      >
        <option value="">Todos</option>
        {proveedores.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-muted">
        Filtrar
      </button>
    </form>
  )
}
