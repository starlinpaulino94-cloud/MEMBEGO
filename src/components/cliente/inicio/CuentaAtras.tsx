'use client'

import { useEffect, useState } from 'react'

/**
 * La cuenta atrás de un banner: días, horas y minutos hasta que venza.
 *
 * Empieza vacía y se llena en el navegador: el servidor y la primera pintura
 * del cliente no pueden coincidir en «cuánto falta» (pasan segundos entre una
 * y otra), y un texto que cambia al hidratar es un aviso de React y un salto
 * visible. Se actualiza cada medio minuto: no enseña segundos, así que más
 * seguido no cambiaría nada.
 */
export function CuentaAtras({ vence }: { vence: string }) {
  const [resto, setResto] = useState<{ d: number; h: number; m: number } | null>(null)

  useEffect(() => {
    const fin = new Date(vence).getTime()
    const calcular = () => {
      const ms = Math.max(0, fin - Date.now())
      setResto({ d: Math.floor(ms / 86_400_000), h: Math.floor((ms % 86_400_000) / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000) })
    }
    calcular()
    const id = window.setInterval(calcular, 30_000)
    return () => window.clearInterval(id)
  }, [vence])

  const caja = (valor: number | undefined, etiqueta: string) => (
    <span className="flex flex-1 flex-col items-center rounded-lg bg-white/15 py-2 backdrop-blur">
      <span className="font-display text-xl font-extrabold tabular-nums text-white">
        {valor == null ? '––' : String(valor).padStart(2, '0')}
      </span>
      <span className="text-label-sm font-semibold text-vibe-celeste">{etiqueta}</span>
    </span>
  )

  return (
    <div className="flex gap-2" role="timer" aria-label="Tiempo que falta para que venza">
      {caja(resto?.d, 'días')}
      {caja(resto?.h, 'horas')}
      {caja(resto?.m, 'min')}
    </div>
  )
}
