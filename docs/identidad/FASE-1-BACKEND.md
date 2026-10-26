# Verificación de identidad · Fase 1 — Backend y modelos

Estado: **construida, apagada y sin proveedor.** No captura nada, no habla con nadie y no
se muestra en ninguna pantalla. Base: [AUDITORIA-VERIFICACION-IDENTIDAD.md](./AUDITORIA-VERIFICACION-IDENTIDAD.md)
(aprobada).

## Qué existe

| Pieza | Dónde |
|---|---|
| Modelos: resultado global por persona, intentos, consentimientos, interruptor | `prisma/schema/identidad-verificacion.prisma` |
| Proyección binaria en la ficha de empresa (`identidadEstado/Nivel/VerificadaEn`) | `prisma/schema/clientes.prisma` |
| Migraciones | `20261078_identidad_acciones_enum` (valores del enum de auditoría, sola) y `20261079_identidad_verificacion` |
| RLS de dueño (**manual**, no se aplica sola) | `prisma/migrations_manual/2026-10-rls-identidad.sql` |
| Núcleo puro (estados, política, razones, hash) | `src/modules/identidad/identidadCore.ts` |
| Textos y versiones de consentimiento (**borrador, pendiente de revisión legal**) | `src/modules/identidad/identidadConsentimientosCore.ts` |
| Servicio (único escritor del estado) | `src/modules/identidad/identidad.ts` |
| Mantenimiento diario (expirar, abandonar, contar avisos) | `src/app/api/cron/identidad/route.ts` + `vercel.json` (`0 8 * * *`) |
| Capacidad de empresa | `VERIFICACION_IDENTIDAD` en `src/modules/capacidades/catalogo.ts` |

## Reglas que el código hace cumplir

- **El cliente nunca se marca verificado.** El estado solo cambia en `aplicarDecision`,
  que en la Fase 2 llamará únicamente el worker tras consultar al proveedor. Ninguna ruta
  de API ni acción lo llama hoy.
- **Resultado global por persona** (`User`), no por empresa. Una empresa solo ve
  «verificada + nivel + fecha» en su ficha, y solo si la persona consintió la divulgación.
  La ficha no puede decir «rechazada» (CHECK en la base).
- **Estados que solo avanzan**, eventos idempotentes, decisión final inmutable; un evento
  contradictorio queda como `prohibida` y deja rastro.
- **Un solo intento abierto por persona** (índice único parcial + candado de sesión), con
  espera tras rechazo, tope de rechazos por semana y rechazo definitivo.
- **Consentimiento registrado con la versión del texto**; si la versión que vio la persona
  no es la vigente, no se registra. Solo inserta; retirar marca `revocadoAt`.
- **Nada de imágenes ni biometría**: el esquema no tiene dónde guardarlas. Del documento
  solo existe un HMAC con pepper (detección de duplicados); del proveedor, su referencia
  **sellada** (AES-256-GCM, ligada a la persona).
- **Mismo documento en dos cuentas**: la segunda no se acredita, queda `en_revision`.
- **Vence a los 36 meses**; vencida deja de valer aunque el barrido no haya corrido.
- **Revocar / revalidar / consultar** son del equipo (`SUPERADMIN`), con motivo y asiento.
  La bitácora usa una lista cerrada de claves, sin datos personales.
- **Doble compuerta**: variables de entorno + interruptor en base de datos (nace apagado). Con una pieza ausente,
  falla cerrada. (La capacidad `VERIFICACION_IDENTIDAD` por empresa no es una tercera compuerta: solo decide si la empresa ve
  la insignia «verificada» en la ficha de sus clientes; la verificación es de la persona, no de una empresa.)

## Para encenderla en un entorno (NO con documentos reales todavía)

1. Aplicar `20261078` y `20261079` (`prisma migrate deploy`), en ese orden.
2. Revisar y aplicar `2026-10-rls-identidad.sql` (lee `docs/RLS.md` antes).
3. Definir `IDENTIDAD_CLAVES_MAESTRAS` e `IDENTIDAD_PEPPER_DEDUPE` (ver `.env.example`;
   una por entorno, nunca la de producción en local).
4. Encender el interruptor con `cambiarInterruptorDeIdentidad` (motivo obligatorio).

En la Fase 1 no hay pantalla para el paso 4 (llega con la Fase 4, administración).

## Pruebas

- `tests/identidad-core.test.ts` — núcleo puro (29).
- `tests/identidad-consentimientos.test.ts` — textos, versiones, plazo de «3 años» (10).
- `tests/identidad-guardas.test.ts` — guardas de código y de migración (10).
- `tests/postgres/identidad.db.test.ts` — contra PostgreSQL real, con concurrencia (39).
  Se verificó por mutación: quitar el candado por documento, aceptar cualquier versión del
  texto o proyectar sin consentimiento rompe una prueba concreta.

## Lo que NO está hecho (fases siguientes) ni pendiente de terceros

- Fase 2: proveedor, webhooks (HMAC + bandeja idempotente), reconciliación, borrado en el
  proveedor, tabla `identidad_eventos_externos` (se deja a propósito para esa migración).
- Fase 3: pantallas web y móvil; sección `#verificacion-identidad` de `/privacy`
  (`RUTA_POLITICA_IDENTIDAD` todavía no existe como ancla).
- Fase 4: panel de administración. Fase 5: reglas por función. Fase 7: validación final.
- **Legal, del dueño:** dictamen escrito sobre Ley 4-23 arts. 58–60 y contrato/DPA con el
  proveedor. Sin ambos, la verificación **no se activa con documentos reales**.
- La supresión de datos (derechos ARCO) en el proveedor se conecta en la Fase 2; borrar a
  la persona ya borra en cascada todo lo de MEMBEGO.
