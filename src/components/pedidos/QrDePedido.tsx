import Image from 'next/image'

/**
 * El QR de un pedido listo. Siempre sobre blanco, también en tema oscuro: un QR
 * claro sobre oscuro no lo lee ningún lector. Es el único sitio de pedidos con
 * una superficie blanca fija, y por eso vive solo en su archivo: sin texto del
 * tema alrededor, que en oscuro saldría claro sobre blanco.
 */
export function QrDePedido({ src, alt }: { src: string; alt: string }) {
  return <Image src={src} alt={alt} width={220} height={220} unoptimized className="rounded-lg border border-border bg-white p-2" />
}
