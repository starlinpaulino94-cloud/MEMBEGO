'use client'

import { CloudOff, RefreshCw, Trash2, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ColaOffline } from '@/components/scanner/useColaOffline'

/**
 * Lo que el empleado VE de la cola sin conexión (Fase 7, punto 28).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CRITERIO DE DISEÑO: NO INTERRUMPIR
 *
 * Quien mira esta pantalla tiene un coche delante y una fila detrás. Una cola
 * que funciona no debe pedirle nada: aparece una franja discreta, dice cuántos
 * quedan y desaparece sola cuando se vacía. Ningún diálogo, ningún botón que
 * haya que pulsar para que las cosas se envíen.
 *
 * La ÚNICA situación que reclama atención es la de las descartadas: lavados
 * que quizá no quedaron registrados y que necesitan que alguien decida. Esas
 * sí se ponen en ámbar y no se van solas.
 *
 * Si no hay nada pendiente y hay conexión, este componente no pinta nada.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function IndicadorCola({ cola }: { cola: ColaOffline }) {
  const { resumen: r, enLinea, disponible } = cola

  // Sin almacenamiento no hay cola que mostrar: el escáner se comporta como
  // antes de la Fase 7 (envío directo) y anunciarlo solo confundiría.
  if (!disponible) return null
  if (r.total === 0 && enLinea) return null

  const enEspera = r.pendientes + r.enviando

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        r.requiereAtencion
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-border/60 bg-muted/40'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!enLinea ? (
            <WifiOff className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <CloudOff className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span>
            {!enLinea && enEspera === 0 && 'Sin conexión. Puedes seguir escaneando.'}
            {enEspera > 0 && (
              <>
                <strong>{enEspera}</strong>{' '}
                {enEspera === 1 ? 'registro pendiente' : 'registros pendientes'}
                {enLinea ? ' de enviar…' : '. Se enviarán solos al volver la red.'}
              </>
            )}
          </span>
        </div>

        {enEspera > 0 && enLinea && (
          <Button size="sm" variant="ghost" onClick={cola.reintentarAhora}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Reintentar
          </Button>
        )}
      </div>

      {r.requiereAtencion && (
        <div className="mt-3 space-y-2 border-t border-amber-500/30 pt-3">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {r.descartadas === 1
              ? 'Un registro no se pudo enviar. Revísalo antes de cerrar el turno:'
              : `${r.descartadas} registros no se pudieron enviar. Revísalos antes de cerrar el turno:`}
          </p>
          <ul className="space-y-1.5">
            {cola.cola
              .filter((p) => p.estado === 'descartada')
              .map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {p.etiqueta ?? (p.tipo === 'visita' ? 'Visita' : 'Canje')}
                    <span className="ml-1.5 text-muted-foreground">
                      · {textoMotivo(p.motivo)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2"
                    onClick={() => cola.descartar(p.id)}
                    aria-label="Quitar de la lista"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * El motivo técnico, dicho en lenguaje de pista.
 *
 * El empleado no tiene por qué saber qué es `respuesta_ambigua`, pero sí tiene
 * que saber si el lavado quedó registrado o no. Cada texto termina en lo que
 * hay que hacer.
 */
function textoMotivo(motivo: string | undefined): string {
  if (!motivo) return 'no se pudo enviar'
  if (motivo.includes('qr_ya_usado')) return 'el QR ya estaba usado: probablemente sí quedó registrado'
  if (motivo.includes('sin_usos')) return 'sin usos disponibles'
  if (motivo.includes('no_tienes_permisos')) return 'sin permisos: avisa al administrador'
  if (motivo.includes('membresia_no_encontrada')) return 'no se encontró la membresía'
  return 'no se pudo enviar tras varios intentos: verifícalo en el panel'
}
