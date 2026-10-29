'use client'

/**
 * EL SELECTOR DE EMPRESA DE «CAPACIDADES POR EMPRESA».
 *
 * Antes cambiar el desplegable NO cambiaba la empresa: había que pulsar «Ver», y
 * mientras tanto el formulario de abajo seguía siendo el de la PRIMERA de la
 * lista. Quien elegía su negocio, marcaba un interruptor y guardaba sin pulsar
 * «Ver» cambiaba las capacidades de OTRA empresa sin enterarse (pasó el
 * 2026-10-29: el «Editor de inicio» se encendió en una empresa de prueba y el
 * negocio real siguió sin él). Ahora elegir una empresa la carga al instante.
 *
 * «Ver» se conserva para quien no tenga JavaScript.
 */
export function SelectorDeEmpresa({
  empresas,
  seleccionada,
}: {
  empresas: { id: string; etiqueta: string }[]
  seleccionada: string
}) {
  return (
    <select
      name="empresa"
      aria-label="Empresa"
      defaultValue={seleccionada}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="mt-1 block h-10 min-w-64 rounded-xl border border-input bg-background px-3 text-sm"
    >
      {empresas.map((e) => (
        <option key={e.id} value={e.id}>
          {e.etiqueta}
        </option>
      ))}
    </select>
  )
}
