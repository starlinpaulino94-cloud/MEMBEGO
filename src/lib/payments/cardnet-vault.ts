import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function key(): Buffer {
  const configured = process.env.CARDNET_VAULT_KEY?.trim()
  if (!configured) throw new Error('CARDNET_VAULT_KEY no está configurada.')
  const decoded = Buffer.from(configured, 'base64')
  if (decoded.length !== 32) throw new Error('CARDNET_VAULT_KEY debe ser una clave base64 de 32 bytes.')
  return decoded
}

/** Cifra credenciales reutilizables con AES-256-GCM y un nonce aleatorio. */
export function cifrarTokenCardnet(token: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [VERSION, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function descifrarTokenCardnet(envelope: string): string {
  const [version, nonceRaw, tagRaw, ciphertextRaw, extra] = envelope.split('.')
  if (version !== VERSION || !nonceRaw || !tagRaw || !ciphertextRaw || extra) {
    throw new Error('El token guardado tiene un formato no válido.')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(nonceRaw, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64url')), decipher.final()]).toString('utf8')
}
