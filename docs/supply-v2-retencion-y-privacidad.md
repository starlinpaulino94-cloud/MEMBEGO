# Supply 2.0 · retención de datos y privacidad

> **Las dos reglas, primero, porque todo lo demás son consecuencias:**
>
> 1. **Un registro financiero o de auditoría no se borra nunca.** Se anula, se
>    corrige con un asiento nuevo, se marca resuelto. Nunca desaparece.
> 2. **El panel de operaciones trabaja con identificadores, no con personas.**
>    Quien opera ve `clienteId`, no un correo ni un teléfono.
>
> Lo que sigue es cómo están garantizadas —no cómo deberían estarlo—.

---

# Parte I · Retención (§22)

## 1 · La política

| Clase de dato | Retención | Qué se puede hacer con él |
|---|---|---|
| **Financiero** — compras, pagos, derechos, economía, liquidaciones, obligaciones, conciliaciones, incidentes | **Indefinida** | Anular con transición y motivo. Nunca borrar |
| **Auditoría** — `audit_logs`, transiciones de estado, bitácora operativa | **Indefinida** | Nada. Solo se escribe y se lee |
| **Eventos externos** (`supply_v2_external_events`) | **Indefinida** | Reintentar. Son la prueba de que la pasarela avisó |
| **Efectos del outbox** (`supply_v2_outbox_events`) | Indefinida hoy; **candidata** a purga de los `DELIVERED` con más de 180 días | Reintentar |
| **Alertas operativas** resueltas | Indefinida hoy; candidata a purga a los 365 días | Reconocer |
| **Notificaciones in-app** leídas | Indefinida hoy; candidata a purga a los 180 días | Marcar leída |
| **Métricas** | No se guardan | Son un evento estructurado que cuenta el recolector |

**No hay ninguna purga implementada, y es deliberado.** Un trabajo que borra
filas en automático es la clase de cosa que hace daño silencioso: se descubre
cuando alguien pide un histórico que ya no existe. Las tres filas marcadas
«candidata» se dejan documentadas y **apagadas** hasta que haya una razón
medida —un coste de almacenamiento real, no una intuición— y, cuando la haya,
se implementa con tope, con registro de lo purgado y detrás de un interruptor
del Centro de Operaciones, como todo lo demás.

Lo que hoy existe y se llama parecido no es esto:

- `src/modules/riesgo/retencion.ts` es retención **de clientes** (abandono),
  no de datos.
- `src/modules/superadmin/purgar.ts` borra **un cliente a petición** (§ 3).

## 2 · Lo que lo garantiza: el esquema, no la política

Un documento no impide un `DELETE`. Lo que lo impide son las claves foráneas.
En las tablas de Supply 2.0, todo lo que apunta a un usuario está declarado
así:

```
39 × onDelete: Restrict    ← la base RECHAZA el borrado
30 × onDelete: SetNull     ← la fila SOBREVIVE sin el actor
 1 × onDelete: Cascade     ← SupplyV2ReferralCode.owner (un código, no dinero)
```

En concreto, cada uno de estos lleva `Restrict` sobre su cliente:
`SupplyV2CustomerOrder`, `SupplyV2Entitlement`, `SupplyV2Voucher`,
`SupplyV2Redemption`, `SupplyV2CustomerBenefit`,
`SupplyV2BenefitReservation`, `SupplyV2Coupon`, `SupplyV2CouponRedemption`.

**Consecuencia práctica:** intentar borrar un usuario que tiene una sola compra
de Supply 2.0 **falla en la base de datos**. No hay forma de perder ese dinero
por descuido, ni con un script, ni con una consola abierta a las tres de la
mañana. Esa es la garantía, y es por eso que es de la base y no del código.

Y `audit_logs.userId` es un `SetNull`: borrar al actor **no borra lo que hizo**.
Se pierde el nombre, no el hecho.

Esto está comprobado por `tests/supply-v2-retencion.test.ts`, que lee los
esquemas y falla si alguien añade un `Cascade` sobre una tabla financiera. Es
una puerta, no una recomendación.

## 3 · El borrado a petición de un cliente

`purgarClienteRow` existe porque un cliente puede pedir que se borren sus
datos. Lo que hace, y lo que **no**:

- **Anula, no borra, el dinero.** Las transacciones `APPLIED` pasan a
  `CANCELLED` con motivo y transición, **antes** del borrado —porque el
  `SetNull` del esquema las desvincula y después ya no habría forma de saber
  cuáles eran suyas—. Los cierres y reportes históricos no cambian hacia atrás.
- **Borra lo operativo:** visitas, tokens QR, membresías, comprobantes,
  referidos, tickets, vehículos.
- **No puede tocar Supply 2.0.** Si ese cliente tiene una compra de Supply 2.0,
  el `Restrict` hace fallar la operación. Es correcto y es incómodo a la vez:
  significa que una petición de borrado de un cliente con compras **no se
  resuelve automáticamente** y necesita una decisión documentada. No se ha
  inventado un camino automático para eso: inventarlo sería elegir entre borrar
  dinero o incumplir, y eso no lo decide el código.

---

# Parte II · Privacidad (§23)

## 4 · Dónde podía filtrarse, y qué se comprobó

| Sitio | Qué podía acabar ahí | Qué hay |
|---|---|---|
| **Cuerpo del webhook** | Firma, cabeceras de autorización, datos de tarjeta | `sanear()` tapa las claves prohibidas y **no se guarda el cuerpo crudo**. Un volcado de `supply_v2_external_events` no puede contener una firma |
| **`lastError` de una fila** | El error de un cliente HTTP trae la petición entera | `sanearError()` pasa por el mismo filtro y recorta a 500 caracteres. Comprobado: un error con `token=abc123` se guarda sin el token |
| **Payload del outbox** | El correo o el teléfono del destinatario | Lleva `userId`, no la dirección. **La dirección se resuelve al entregar** y no se escribe en ninguna fila. El payload se VE en el panel |
| **Avisos operativos agregados** | Las direcciones de las personas de operaciones | El payload lleva la cuenta (`incidentes: 20`), nunca un correo. Comprobado en la suite |
| **Métricas** | Un id de orden o de cliente como etiqueta | Solo números y etiquetas cortas sin dígitos largos; el validador de etiquetas rechaza lo demás. Comprobado: todos los valores emitidos son números finitos |
| **Búsqueda de operaciones** | Nombre, correo y teléfono del cliente | Devuelve `clienteId` y nada más. Quien opera no necesita saber de quién es, y por eso no se le dice |
| **Logs (`anotarSupply`)** | Cualquiera de los anteriores | Campos fijos: evento, pasarela, `correlationId`, `inboxId`, código de error saneado |
| **Los avisos del cliente en pantalla** | Datos de otra persona | `/cliente/novedades` consulta por `userId` con el contexto de plataforma: cada quien ve los suyos, y la ruta exige rol `CLIENTE` |
| **Errores en el frontend** | Un detalle interno en el mensaje de una acción | Los mensajes son del dominio y no llevan trazas |

## 5 · La excepción, dicha en voz alta

El Centro de Operaciones **sí** muestra una dirección de correo en un caso: la
del **operador**, cuando reconoció una alerta, resolvió un incidente o cambió
un interruptor y su cuenta no tiene nombre puesto. Es el apellido de una firma,
no el dato de un cliente, y sin él la bitácora diría «alguien lo resolvió». El
panel es solo para `SUPERADMIN`.

Lo que **nunca** aparece ahí es el correo o el teléfono de un cliente.

## 6 · Lo que esta parte NO cubre

- **El resto de Membego.** Esto audita el camino de Supply 2.0. El aislamiento
  general está en [`SEGURIDAD-DATOS.md`](SEGURIDAD-DATOS.md) y
  [`RLS.md`](RLS.md).
- **Lo que un proveedor de correo guarda.** Cuando el correo sale, la dirección
  está en los registros de ese proveedor. Que Membego no la escriba no la hace
  desaparecer del mundo.
- **WhatsApp.** No está configurado y la pasarela responde `NOT_CONFIGURED`:
  hoy no hay por dónde filtrar un teléfono porque no se manda ninguno. Cuando
  se configure, esta tabla necesita una fila más.
