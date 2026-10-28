'use client'

import { useSyncExternalStore } from 'react'

/**
 * INSTALAR MEMBEGO COMO APP (PWA) · el estado del navegador.
 *
 * MembeGo no está en las tiendas, así que «descargar la app» es instalar la
 * web en la pantalla de inicio. El navegador lo permite de dos maneras y aquí
 * se unifican:
 *
 *  - Chrome/Edge/Samsung (Android y escritorio) disparan `beforeinstallprompt`
 *    cuando la web cumple los requisitos. Hay que GUARDAR ese evento y llamar
 *    a `prompt()` desde un clic. El evento puede dispararse ANTES de que React
 *    hidrate, por eso `SCRIPT_INSTALACION` (inline en el <head>) lo captura en
 *    `window.__membegoInstalar` y aquí solo se lee.
 *
 *  - Safari en iPhone/iPad no tiene evento: se instala a mano desde Compartir
 *    → «Añadir a pantalla de inicio». Aquí se detecta y la UI enseña los pasos.
 *
 * Es un `useSyncExternalStore` para que el servidor y la primera pintura del
 * cliente coincidan (nada instalable) y no haya saltos de hidratación.
 */

const CLAVE_DESCARTADO = 'membego:instalar:descartado'
const CLAVE_INSTALADO = 'membego:instalar:instalado'
const DIAS_SILENCIO = 14

/** Lo que captura el script inline; mismo nombre aquí y en `SCRIPT_INSTALACION`. */
const PROPIEDAD_GLOBAL = '__membegoInstalar'
const EVENTO_INSTALABLE = 'membego:instalable'
const EVENTO_INSTALADO = 'appinstalled'
/** Lo disparan otros componentes para abrir la guía (botón de /descargar, aviso de notificaciones en iOS). */
export const EVENTO_MOSTRAR_GUIA = 'membego:instalar:mostrar'

export const SCRIPT_INSTALACION = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.${PROPIEDAD_GLOBAL}=e;window.dispatchEvent(new Event('${EVENTO_INSTALABLE}'))});window.addEventListener('${EVENTO_INSTALADO}',function(){window.${PROPIEDAD_GLOBAL}=null;try{localStorage.setItem('${CLAVE_INSTALADO}','1')}catch(e){}})`

interface EventoInstalacion extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface EstadoInstalacion {
  /** Hay un `beforeinstallprompt` guardado: se puede instalar con un clic. */
  readonly instalable: boolean
  /** Ya corre como app instalada (standalone): no hay nada que ofrecer. */
  readonly instalada: boolean
  /** iPhone/iPad: no hay evento; la instalación es manual desde Safari. */
  readonly esIOS: boolean
  /** En iOS, dentro de un navegador que NO puede instalar (Instagram, Facebook, Chrome…). */
  readonly esNavegadorSinInstalacionEnIOS: boolean
}

const EN_SERVIDOR: EstadoInstalacion = { instalable: false, instalada: false, esIOS: false, esNavegadorSinInstalacionEnIOS: false }

let estadoCacheado: EstadoInstalacion | null = null
const oyentes = new Set<() => void>()

function eventoGuardado(): EventoInstalacion | null {
  const e = (window as unknown as Record<string, unknown>)[PROPIEDAD_GLOBAL]
  return e && typeof (e as EventoInstalacion).prompt === 'function' ? (e as EventoInstalacion) : null
}

export function corriendoComoApp(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function detectarIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS se hace pasar por Mac; los puntos táctiles lo delatan.
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function navegadorSinInstalacionEnIOS(): boolean {
  const ua = navigator.userAgent
  // Chrome/Firefox/Edge en iOS y los navegadores incrustados no ofrecen «Añadir a pantalla de inicio».
  return /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\/|Twitter|TikTok/i.test(ua)
}

function calcular(): EstadoInstalacion {
  const esIOS = detectarIOS()
  return {
    instalable: eventoGuardado() !== null,
    instalada: corriendoComoApp(),
    esIOS,
    esNavegadorSinInstalacionEnIOS: esIOS && navegadorSinInstalacionEnIOS(),
  }
}

function leer(): EstadoInstalacion {
  if (!estadoCacheado) estadoCacheado = calcular()
  return estadoCacheado
}

function notificar() {
  estadoCacheado = calcular()
  for (const o of oyentes) o()
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente)
  window.addEventListener(EVENTO_INSTALABLE, notificar)
  window.addEventListener(EVENTO_INSTALADO, notificar)
  // El estado ya pudo cambiar antes de que montara el primer componente.
  const actual = calcular()
  if (!estadoCacheado || actual.instalable !== estadoCacheado.instalable) notificar()
  return () => {
    oyentes.delete(oyente)
    if (oyentes.size === 0) {
      window.removeEventListener(EVENTO_INSTALABLE, notificar)
      window.removeEventListener(EVENTO_INSTALADO, notificar)
    }
  }
}

export function useInstalacion(): EstadoInstalacion {
  return useSyncExternalStore(suscribir, leer, () => EN_SERVIDOR)
}

/**
 * Lanza el diálogo nativo de instalación. Solo funciona desde un gesto del
 * usuario y una vez por evento: tras usarlo, el navegador no vuelve a dar otro
 * hasta la próxima visita.
 */
export async function pedirInstalacion(): Promise<'accepted' | 'dismissed' | 'no-disponible'> {
  const evento = eventoGuardado()
  if (!evento) return 'no-disponible'
  ;(window as unknown as Record<string, unknown>)[PROPIEDAD_GLOBAL] = null
  notificar()
  try {
    await evento.prompt()
    const { outcome } = await evento.userChoice
    return outcome
  } catch {
    return 'dismissed'
  }
}

/** Pide al aviso de instalación que se enseñe ahora (con la guía, en iOS). */
export function mostrarGuiaInstalacion() {
  window.dispatchEvent(new Event(EVENTO_MOSTRAR_GUIA))
}

export function instalacionDescartadaRecientemente(): boolean {
  try {
    if (localStorage.getItem(CLAVE_INSTALADO) === '1') return true
    const desde = Number(localStorage.getItem(CLAVE_DESCARTADO) ?? 0)
    return desde > 0 && Date.now() - desde < DIAS_SILENCIO * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export function recordarDescarteDeInstalacion() {
  try {
    localStorage.setItem(CLAVE_DESCARTADO, String(Date.now()))
  } catch {
    // Navegación privada: se volverá a ofrecer en la próxima visita, y ya está.
  }
}
