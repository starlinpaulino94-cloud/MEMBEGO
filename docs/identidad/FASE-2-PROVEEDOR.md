# Verificación de identidad · Fase 2 — Integración con el proveedor

Estado: **construida y probada con un Didit simulado; sin activar.** Nada de esto se enciende
solo: la verificación sigue apagada (interruptor + entorno completo) y no se usa con
documentos reales hasta el dictamen legal y el contrato con el proveedor. Base:
[AUDITORIA-VERIFICACION-IDENTIDAD.md](./AUDITORIA-VERIFICACION-IDENTIDAD.md) y
[FASE-1-BACKEND.md](./FASE-1-BACKEND.md).

Proveedor: **Didit** (recomendado por la auditoría). Detrás de la interfaz
`ProveedorDeIdentidad` (`src/modules/identidad/proveedor/contrato.ts`): cambiar de proveedor es
escribir otro cliente y otro verificador de avisos; el servicio, la bandeja y las pantallas no se
enteran.

## El camino de una verificación

```
persona ──▶ POST /api/v1/cliente/identidad/sesion ──▶ crearIntento (reglas de la Fase 1)
                                                  └─▶ Didit: crear sesión (vendor_data = id del intento)
                                                  └─▶ se guarda el id de la sesión SELLADO
         ◀── { url } (lleva un token: no se registra)

persona ──▶ Didit (documento + prueba de vida + rostro) ──▶ vuelve por el enlace

Didit ──▶ POST /api/webhooks/identidad/didit   (aviso FIRMADO)
          1. firma V2 + frescura (±5 min) + secretos (actual y anterior)   ← antes de tocar la base
          2. se registra en la bandeja (único por event_id) y se responde 200
          3. DESPUÉS de responder (after): se le PREGUNTA a Didit la decisión por NUESTRA referencia
          4. aplicarDecision (único escritor del estado)
          5. con el resultado ya guardado: se BORRA la sesión en Didit («procesar y purgar»)
```

Tres ideas mandan:

1. **«Fetch the truth».** Un aviso, el regreso de la persona y el barrido solo dicen «ve a mirar».
   Lo que se aplica es lo que Didit responde al preguntarle por la sesión de ese intento. Un aviso
   falsificado, repetido o mentiroso solo provoca una consulta inocua (probado: un aviso
   «Approved» con Didit diciendo «Declined» no acredita a nadie).
2. **Procesar y purgar.** Se borra la sesión en Didit (documentos, selfie, plantillas) **solo
   después** de guardar el resultado. Si el borrado falla, queda pendiente y el barrido lo
   reintenta; lo que no puede pasar es borrar sin haber guardado. Un intento `en_revision` (por
   Didit o por documento repetido) conserva su sesión: la mira una persona.
3. **La verificación nunca es precondición de nada.** Si Didit se cae, esta capa responde
   «inténtalo en un momento» (interruptor automático tras 5 fallos seguidos, 30 s de enfriamiento).
   Compras, renovaciones y accesos no pasan por aquí.

## Piezas

| Pieza | Dónde |
|---|---|
| Contrato, errores, interruptor automático | `src/modules/identidad/proveedor/{contrato,circuito}.ts` |
| Traducción Didit → MEMBEGO (estados, advertencias → códigos, firma de avisos), pura | `src/modules/identidad/proveedor/diditMapeo.ts` |
| Cliente HTTP de Didit | `src/modules/identidad/proveedor/didit.ts` |
| Crear sesión, sincronizar, purgar, reconciliar | `src/modules/identidad/sincronizacion.ts` |
| Bandeja de avisos + manejador del webhook | `src/modules/identidad/eventos.ts` |
| Supresión (ARCO) y limpieza al eliminar una cuenta | `src/modules/identidad/supresion.ts` |
| Rutas | `api/webhooks/identidad/[proveedor]`, `api/v1/cliente/identidad/{sesion,estado}`, `api/cron/identidad` |
| Migraciones | `20261080_identidad_acciones_proveedor` (2 valores del enum, sola) y `20261081_identidad_proveedor` (bandeja + 3 columnas del intento) |
| RLS manual (ahora incluye la bandeja) | `prisma/migrations_manual/2026-10-rls-identidad.sql` |

## Reglas que el código hace cumplir

- **Autenticidad del aviso:** HMAC-SHA256 sobre el cuerpo (V2 canónico o bytes exactos),
  comparación de tiempo constante, ventana de ±5 min dentro de lo firmado, dos secretos para
  rotar, 404 si no hay secreto, 413 sobre 512 KB. No se acepta `X-Signature-Simple`.
- **De un aviso solo se guarda** el id del evento, su tipo, el estado que decía, el id de
  NUESTRO intento y un hash. Ni el cuerpo ni el id de la sesión (el esquema no tiene dónde).
- **Idempotencia y simultaneidad:** único por proveedor + `event_id` + tipo; seis entregas a la
  vez dejan una fila, una verificación, un asiento. Un aviso pendiente que Didit reenvía se
  reprocesa. Un aviso que llega antes de guardar la sesión queda pendiente y el barrido lo cierra.
- **Una aprobación sin documento + prueba de vida + rostro aprobados NO acredita**: va a revisión
  (`FLUJO_INCOMPLETO`). El flujo se configura en la consola de Didit, fuera del repositorio;
  esta red impide que un flujo mal armado dé identidad.
- **Mismo documento en dos cuentas:** el hash (HMAC con pepper) lo detecta; la segunda va a
  revisión, conserva su sesión y la reconciliación no insiste.
- **Códigos:** lo que dice Didit se traduce al catálogo propio. Los ataques y documentos
  alterados no se explican a la persona ni admiten reintento. Lo que no se reconoce cae en
  «rechazo genérico»: nunca se muestra texto del proveedor.
- **Nada sensible a un log:** ni la clave, ni la dirección con token, ni el número del documento
  (los fallos se anotan con códigos; una guarda impide `console.*` en el módulo).
- **Cliente HTTP:** sin redirecciones, tiempo máximo de 8 s, id de sesión validado antes de
  entrar en una ruta, dirección de destino obligatoriamente `https` y de `didit.me`.
- **Red de seguridad de los avisos perdidos:** Didit solo reintenta un aviso dos veces. La pantalla
  que sondea el estado pregunta a Didit si el intento lleva 15 s sin novedad, y el cron diario
  reconcilia los que llevan más de 5 minutos y reintenta los borrados pendientes.
- **Supresión y eliminación de cuenta:** primero el asiento de la solicitud, luego el borrado en
  Didit (cada sesión con `privacy_erasure`, que purga también las plantillas, y las personas que
  creó), y **solo si Didit confirmó** se borra lo local. Si Didit falla, no se borra nada local y
  se repite sin problema. Eliminar una cuenta (4 caminos: la app, el superadmin ×2 y el equipo de
  una empresa) purga antes lo del proveedor y, si no puede, **no elimina** y lo dice.

## Para configurar Didit (antes de encender nada)

1. **Flujo (workflow)** en la consola, con: documento de identidad + prueba de vida + comparación
   facial, solo cédula/pasaporte/residencia, **retención mínima**. Copiar su id a `DIDIT_WORKFLOW_ID`.
2. **Clave de API** con permisos `read:sessions` y `delete:sessions` en `DIDIT_API_KEY`.
3. **Destino de webhook** a `https://<dominio>/api/webhooks/identidad/didit` con el evento
   `status.updated`; su `secret_shared_key` en `DIDIT_WEBHOOK_SECRET`. Para rotarlo, el actual
   pasa a `DIDIT_WEBHOOK_SECRET_ANTERIOR` mientras convivan.
4. Probar el contrato con el **entorno de pruebas de Didit**: `npm run identidad:probar-didit`
   (crea una sesión, la lee, la traduce y la borra; no usa documentos). Y «Try Webhook» desde la
   consola: un 200 confirma firma, frescura y bandeja.

Las variables están documentadas en `.env.example` y `faltantesIdentidad()` las exige: sin ellas
el interruptor no se puede encender.

## Pruebas

- `tests/identidad-proveedor.test.ts` — traducción, firma, circuito (21).
- `tests/postgres/identidad-proveedor.db.test.ts` — el camino completo contra PostgreSQL con un
  Didit falso: empezar, avisos (firma, duplicados, simultáneos, adelantados, mentirosos),
  aprobar/rechazar/revisar, reconciliación, borrado, supresión, eliminación de cuenta, cliente
  HTTP, interruptor automático y registros sin datos sensibles (41).
- `tests/identidad-guardas.test.ts` — ampliado con las guardas de la Fase 2 (17).
- Por mutación: quitar la verificación de firma, la comparación de sesión o de referencia, la
  purga, el tragarse el fallo del proveedor al suprimir o saltar referencias ilegibles rompe una
  prueba concreta.

## Lo que NO se pudo probar aquí

- **Contra el Didit real.** El Didit falso se escribió a partir de su documentación pública
  (22-oct-2026). Hasta correr `identidad:probar-didit` y «Try Webhook» con las claves de pruebas,
  los supuestos sobre los campos exactos de sus respuestas y la firma son eso: supuestos.
- **La firma V2 con cuerpos de Didit reales.** Se canoniza como describe su documentación
  (claves ordenadas, sin espacios). Para números con exponente JavaScript y Python difieren; por eso
  también se acepta la firma sobre los bytes exactos (`X-Signature`).
- **El flujo en un teléfono** (cámara, NFC de la cédula nueva): es la Fase 3.

## Pendiente (siguientes fases y del dueño)

- Fase 3: pantallas web y móvil que usan estas rutas; el aviso de privacidad (`/privacy#verificacion-identidad`).
- Fase 4: panel del equipo (revisión de `en_revision`, revocar, supresión, interruptor).
  Un caso `en_revision` conserva su sesión hasta que alguien lo resuelva allí.
- Seguimiento de supresiones vencidas (10 días hábiles, Ley 172-13): hay asiento de solicitud y de
  completada; la alerta de «solicitada sin completar» es del panel.
- **Legal, del dueño:** dictamen sobre Ley 4-23 arts. 58–60, contrato/DPA con Didit y que Didit
  declare la fuente de su consulta a la JCE. Sin ello, no se activa con documentos reales.
