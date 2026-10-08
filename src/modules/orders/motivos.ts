/**
 * Motivos que el SISTEMA escribe al cancelar un pedido por su cuenta. Viven aparte (sin Prisma ni Next) para que quien
 * LEE los pedidos —las señales de riesgo— pueda distinguir una cancelación que decidió una persona de una automática
 * sin importar un servicio que escribe.
 */
export const MOTIVO_SIN_RESPUESTA = 'La empresa no respondió a tiempo'
