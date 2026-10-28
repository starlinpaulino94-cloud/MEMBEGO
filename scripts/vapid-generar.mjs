#!/usr/bin/env node
/**
 * GENERA LAS CLAVES VAPID DE WEB PUSH  ·  `node scripts/vapid-generar.mjs`
 *
 * Un par P-256 nuevo, en base64url, listo para pegar en el entorno (Vercel →
 * Settings → Environment Variables, y en `.env.local` para probar). Se generan
 * UNA vez: si se cambian, todas las suscripciones guardadas dejan de valer y
 * cada persona tendrá que volver a activar las notificaciones.
 *
 * La pública va con prefijo NEXT_PUBLIC_ porque el navegador la necesita para
 * suscribirse; la privada NUNCA sale del servidor.
 */
import { createECDH } from 'node:crypto'

const ecdh = createECDH('prime256v1')
ecdh.generateKeys()

console.log('# Pega estas tres líneas en el entorno (ver docs/PWA_NOTIFICACIONES_PUSH.md):')
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`)
console.log(`VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`)
console.log('VAPID_SUBJECT=mailto:soporte@membego.com')
