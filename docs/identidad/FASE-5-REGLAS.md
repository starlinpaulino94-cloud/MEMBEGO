# Verificación de identidad · Fase 5 — Reglas por función

Estado: **construida y probada (núcleo puro, base de datos, guardas de código y mutaciones); sin verla en un navegador con sesión
real de SUPERADMIN ni de un proveedor.** Sigue apagada: no hay ninguna regla encendida (nace vacía), y la verificación no se ofrece
a nadie hasta que se encienda el interruptor (entorno completo + interruptor en base de datos + capacidad). No se usa con
documentos reales hasta el dictamen legal y el contrato con el proveedor. Base: [AUDITORIA-VERIFICACION-IDENTIDAD.md](./AUDITORIA-VERIFICACION-IDENTIDAD.md),
[FASE-1-BACKEND.md](./FASE-1-BACKEND.md), [FASE-2-PROVEEDOR.md](./FASE-2-PROVEEDOR.md), [FASE-3-CLIENTE.md](./FASE-3-CLIENTE.md) y
[FASE-4-ADMINISTRACION.md](./FASE-4-ADMINISTRACION.md).

## La decisión de alcance (y por qué es tan estrecha)

La auditoría dice que la identidad protege la **salida de valor**, no la compra, y limita el nivel con documento y selfie (T2) a cuatro
casos: representante de un comercio antes del primer pago, recompra con tarjeta tras un contracargo, cuenta corporativa a crédito y
anomalías. Al mirar el código de hoy, **solo el primero tiene dónde engancharse**:

| Caso de la auditoría | Estado en el código | Qué se hizo |
|---|---|---|
| Pago a un comercio / proveedor | Existe: `confirmarPagoProveedorEnTx` (Supply v2), el único sitio donde el dinero sale de Membego hacia un tercero | **Puerta construida** |
| Recompra tras contracargo | No existe ningún modelo ni estado de contracargo (solo un comentario en `pagos.prisma`) | Sin puerta: falta el dato |
| Cuenta corporativa a crédito | La cuenta de carwash es crédito del negocio a una flota, sin persona ni límite que se haga cumplir | Sin puerta: no hay a quién verificar |
| Anomalías (dispositivo + tarjeta + canje) | No hay señales de dispositivo ni de velocidad (son de la «Etapa 0», sin biometría) | Sin puerta: no hay señal |

Gift cards, transferencias entre personas y referidos **no** llevan regla de identidad: la auditoría los clasifica como T1+ (contacto,
dispositivo, límites) y dice «nunca identidad del comprador salvo reincidencia». Tampoco existe hoy un crédito retirable ni canjeable
por dinero (el saldo de referidos no tiene salida). Esa decisión se tomó contigo antes de construir.

## Qué hay

**Una regla, una operación.** `PAGO_A_PROVEEDOR`: antes de confirmar un pago a un proveedor de Supply, Membego puede exigir que la persona
que **aceptó el contrato del proveedor** (`SupplyV2Supplier.termsAcceptedById`, quien obliga a la empresa) tenga identidad verificada
con documento. Dos alcances: **solo el primer pago** confirmado a ese proveedor (por defecto) o **todos** (si la verificación vence o se
retira, los pagos se detienen hasta renovarla).

| Pieza | Dónde |
|---|---|
| Decisión pura, catálogos cerrados, mensajes | `src/modules/identidad/reglasCore.ts` |
| Evaluador con base de datos (lee la regla, la verificación y al representante) | `src/modules/identidad/reglas.ts` |
| Leer / cambiar reglas (con motivo y asiento; solo SUPERADMIN) | `identidad.ts` (`leerReglasDeIdentidad`, `cambiarReglaDeIdentidad`), `staff.ts` (`reglasDeLaPlataforma`, `cambiarReglaComoStaff`) |
| Pestaña **Reglas** del panel del equipo | `/superadmin/identidad?vista=reglas` + `cambiarReglaAction` |
| La puerta | `src/modules/supply-v2/finance/payments.ts` (`exigirIdentidadDelRepresentante`, dentro de `confirmarPagoProveedorEnTx`) |
| Camino de la persona en el portal del proveedor | `/admin/supply/identidad` (misma pantalla que un cliente), enlace en Configuración solo para quien aceptó el contrato |
| Migraciones | `20261086_identidad_reglas_enums` (asiento, solo) y `20261087_identidad_reglas` (tabla `identidad_reglas`, CHECK, RLS solo omnisciente) |

## Qué ve cada quien

- **El equipo (SUPERADMIN):** en **Reglas**, la lista corta de operaciones que pueden pedir identidad, el estado de cada una (apagada /
  encendida / encendida *en pausa* si la verificación está apagada), a quién se le pide, el alcance, el último cambio con su motivo, y un
  recuento informativo de los proveedores activos de hoy (con representante verificado, con representante sin verificar, sin nadie que
  haya aceptado el contrato). También ve, escrito, **lo que nunca pide identidad**: compras, promociones, reservas, renovaciones, pago con
  tarjeta, entrada con QR y registro.
- **Al confirmar un pago frenado:** el mensaje dice qué falta y a quién se lo debe pedir (nombre y correo), p. ej. «La persona que aceptó el
  contrato (Ana · ana@proveedor.test) no ha verificado su identidad. Para pagarle al proveedor hace falta que la haga desde «Verificación de
  identidad» en su portal…». El pago queda **pendiente**; no sale dinero. Si nadie aceptó el contrato, lo dice y explica qué hacer.
- **La persona que aceptó el contrato:** en Configuración del portal, un enlace «aquí» a su verificación, con un aviso de que Membego
  puede pedírsela antes de pagarle a su empresa y de que es su decisión. Vuelve al portal tras verificarse y su aviso de resultado
  (campana, push y correo) la lleva allí, no a la pantalla de clientes. La empresa del proveedor no ve nada de lo que se guarda.

## Reglas que el código hace cumplir

- **Nace vacía y apagada.** Sin fila no se pide nada; la migración no inserta reglas. Encenderla exige motivo y que la verificación esté
  encendida (una regla que nadie podría cumplir no se enciende); apagarla se puede siempre.
- **La verificación apagada suspende las reglas** (el panel dice «en pausa»): no se le pide a nadie algo que no puede hacer, y un pago no queda
  congelado porque el proveedor de verificación esté caído.
- **Lista cerrada, también en la base.** El CHECK de `identidad_reglas` solo admite las operaciones del catálogo; una compra, una renovación o
  un acceso no entran ni escribiendo directo en la tabla. Una prueba cruza el CHECK con el catálogo del código y con la lista de lo que
  nunca pide.
- **Una sola puerta.** Fuera del módulo de identidad, solo `payments.ts` importa las reglas, y las compras, membresías, renovaciones y
  accesos no importan el módulo de identidad en absoluto (guarda de código con la lista exacta de quién sí lo hace). La puerta va dentro de la
  confirmación, **después** de comprobar que el pago se puede confirmar y **antes** de marcarlo confirmado y aplicar el dinero; la confirmación
  repetida (idempotente) no vuelve a preguntar.
- **«No sé» no es «sí».** Si no se puede leer la regla o a la persona, el evaluador lanza y el pago no sale. Con la regla apagada, ni se lee a la
  persona.
- **Cuenta como verificada** solo una verificación vigente con documento o por la vía oficial: la de nivel de contacto, la vencida, la retirada
  o la que pide revalidar no cuentan.
- **«Primer pago»** es el primer pago *confirmado*: dos pagos pendientes de un proveedor nuevo se frenan los dos hasta que haya identidad.
- **El sitio de vuelta sale del rol**, no del formulario (lista cerrada `RUTAS_WEB_DE_RETORNO`), y la pantalla del portal solo muestra la
  verificación de la persona de la sesión. Las acciones web aceptan a un cliente o a alguien del portal de un proveedor; cualquier otro rol, no.
- **Cada cambio de regla deja asiento** (`IDENTIDAD_REGLA_CAMBIADA`: operación, activa, alcance, estado anterior, motivo, quién) sin datos
  personales.

## Pruebas

- `tests/identidad-reglas.test.ts` — 8 pruebas puras: estado de serie, verificación apagada, quién cuenta, sin representante, mensajes, alcances,
  catálogo y lista de lo que nunca pide.
- `tests/postgres/identidad-reglas.db.test.ts` — 9 pruebas contra PostgreSQL con el Didit falso y pagos de Supply reales: solo el equipo, motivo y
  asiento, estado de serie, regla encendida de punta a punta (frena, dice a quién, sale al verificarse), verificación retirada / vencida / solo de
  contacto, alcances, verificación apagada, panel y camino del portal (retorno y aviso).
- `tests/identidad-guardas.test.ts` — +6 guardas: una sola puerta y quién importa la identidad, posición de la puerta en la confirmación, CHECK ↔
  catálogo, camino del portal, evaluador sin `catch`, y que la política y la pantalla digan la excepción.
- **Mutaciones:** se rompió cada protección y se comprobó que alguna prueba falla (ver el resultado en el informe de la fase).

## Texto legal que cambió (para tu revisión con el abogado)

`/privacy` §7 gana un párrafo: «Hay un solo caso en el que MembeGo puede pedírtelo: si aceptaste el contrato de un proveedor de Membego Supply,
podemos pedirte que verifiques tu identidad antes de pagarle a ese proveedor. Sigue siendo tu decisión (si no lo haces, ese pago queda a la
espera) y nunca se pide para comprar, reservar, renovar ni entrar con tu QR.» Condicionar un pago a una verificación biométrica es justo lo que la
auditoría pone en la lista de preguntas para el abogado (Ley 358-05 y Ley 4-23, arts. 58–60): **no se debe encender la regla antes de esa respuesta.**

## Lo que sigue pendiente (no es de esta fase)

- Verlo en un navegador con sesión real (SUPERADMIN y representante de un proveedor).
- Dictamen legal, contrato con Didit y su configuración; `npm run identidad:probar-didit` y «Try Webhook» contra su sandbox.
- No hay «representante legal» como dato propio: se usa a quien aceptó el contrato. Si Membego quiere verificar a un representante distinto (con
  RNC y firma), hay que modelarlo (campo en el proveedor y flujo para designarlo): decisión de producto.
- Contracargo, crédito corporativo y anomalías: sin puerta hasta que existan los datos (modelo de contracargos, persona firmante de una cuenta,
  señales de dispositivo y velocidad). El catálogo está hecho para añadirlas sin tocar el motor.
- Fase 6 (pruebas de seguridad con documentos sintéticos) y 7 (validación final): solo con tu autorización.
