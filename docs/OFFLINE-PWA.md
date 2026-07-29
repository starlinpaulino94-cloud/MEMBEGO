# El escáner sin conexión

Cierra el punto **28** del plan de `docs/AUDITORIA-PRODUCCION.md` (*PWA con cola
offline para el scanner de pista*) — Fase 7.

---

## 1. El problema, que es de negocio

El escáner se usa de pie, en la pista, con un móvil, bajo un techo de zinc y con
el wifi del local llegando a duras penas. Cuando la red se cae —y se cae— lo que
pasaba hasta ahora era esto: el empleado escanea, la acción falla, sale un error,
hay un coche esperando y una fila detrás. La salida real no es reintentar: es
**lavar el coche sin registrar la visita**.

Una visita no registrada no es un dato perdido. Es:

- un uso de membresía que el cliente conserva y volverá a gastar,
- un lavado que no aparece en caja,
- una comisión que el lavador no cobra,
- y un reporte del mes que miente.

Es el fallo más caro del sistema y el único que **no produce ningún error en
ningún panel**. Ni Sentry ni las métricas de la Fase 6 lo ven, porque desde el
punto de vista del servidor no pasó nada.

---

## 2. Cómo queda

```
El empleado confirma
        │
        ├─ ¿hay red? ──► se registra normal
        │
        └─ no ──► se guarda en el teléfono
                  el empleado ve "1 pendiente" y sigue atendiendo
                        │
                  vuelve la red ──► se envía sola, en orden
```

### Las piezas

| Archivo | Qué hace |
|---|---|
| `src/modules/scanner/colaOffline.ts` | **La política.** Qué se reenvía, cuándo, en qué orden y qué se abandona. Lógica pura, 23 pruebas |
| `src/modules/scanner/almacenCola.ts` | Dónde se guarda (`localStorage`) |
| `src/components/scanner/useColaOffline.ts` | El bucle de reenvío y el estado de la red |
| `src/components/scanner/IndicadorCola.tsx` | Lo que ve el empleado |
| `public/sw.js` | Que la página **abra** sin red |

---

## 3. Las decisiones que importan

### 3.1 · Orden FIFO, siempre

Se reenvía en el orden en que ocurrieron los lavados, no en el que se logró
enviarlos. No es estética: el ticket lleva número secuencial por empresa y la
sesión de caja tiene apertura y cierre. Reenviar en desorden produce tickets
cuyo número no corresponde a su hora — exactamente el tipo de cosa que hace
impugnable un arqueo.

### 3.2 · Reenviar es seguro, y la garantía no la pone la cola

El servidor invalida el `qrTokenId` dentro de la misma transacción que registra
la visita. Si la red se cortó **después** de que el servidor confirmara —el caso
ambiguo, el que produce cobros dobles en sistemas mal hechos— el reenvío choca
contra ese token ya invalidado y devuelve *"QR ya utilizado"*.

Dicho de otro modo: la idempotencia ya estaba en la base de datos. Lo que hace
esta cola es apoyarse en ella en vez de pelearse.

### 3.3 · Hay errores que no se reintentan

Un QR ya usado, una promoción sin usos o una falta de permisos no mejoran
esperando. Se descartan al primer intento y se muestran para que una persona
decida.

**Ante la duda, se reintenta.** Equivocarse hacia "reintenta" cuesta unos
segundos; equivocarse hacia "descarta" pierde el registro de un lavado que sí se
hizo, y eso no se recupera.

> Un fallo real que encontró una prueba: la primera versión de la lista de
> errores definitivos estaba escrita contra los códigos INTERNOS del servidor
> (`QR_YA_USADO`), pero lo que llega a la cola es el mensaje en español que lee
> el empleado. Ninguna entrada coincidía nunca, así que todos los errores se
> habrían reintentado cinco veces. No era visible con red buena: solo habría
> molestado el día de una caída. Ver el comentario de `MOTIVOS_DEFINITIVOS`.

### 3.4 · Lo descartado no desaparece solo

Las entradas enviadas se limpian a los diez minutos. Las **descartadas no se
limpian nunca**: cada una puede ser un lavado sin registrar, y que desaparezca
sola del historial es cómo se pierde dinero sin que nadie se entere. Se van
cuando alguien las quita a mano, después de mirarlas.

### 3.5 · `localStorage` y no IndexedDB

IndexedDB es la respuesta de manual y aquí sería peor: la cola son unas decenas
de entradas de texto en el peor día imaginable, contra un límite de 5 MB, y a
cambio traería una API asíncrona con transacciones y versiones de esquema para
guardar un array.

Además, ser síncrono es aquí una **ventaja**: la escritura ocurre en el mismo
instante en que se pulsa "confirmar". Con una API asíncrona hay una ventana
—pequeña, real— en la que el móvil se bloquea entre el "confirmar" y el
guardado.

**Dónde deja de servir:** si algún día el escáner tiene que guardar **fotos** sin
conexión (las evidencias antes/después), esto se queda corto y hay que pasar a
IndexedDB. Ese día solo cambia `almacenCola.ts`: la política no sabe dónde se
guarda nada.

### 3.6 · El service worker hace UNA cosa

Que el escáner **abra** sin red. No cachea datos: los de MembeGo cambian cada
minuto y servir un saldo de membresía viejo sería peor que no servir nada.

Un service worker mal hecho es la forma más rápida de romper un sitio, y de la
peor manera: para quien ya lo visitó, sin que se arregle desplegando. Por eso:

- **Red primero** para todo lo navegable; la caché solo si la red falló.
- **Solo GET del mismo origen.** Las server actions son POST y no pasan por ahí.
- **`/api/` nunca** se cachea.
- **Interruptor de emergencia** escrito al final de `public/sw.js`: sustituir el
  archivo por ese código desregistra el service worker en todos los dispositivos.
  Borrarlo no sirve — los navegadores que ya lo tienen seguirían usando su copia.

---

## 4. Cómo probarlo a mano

Esto **no** está cubierto por pruebas automáticas: simular una caída de red real
en un navegador controlado es posible pero frágil, y el valor está en verlo con
un teléfono de verdad.

1. Despliega y abre `/empleado/scanner` **en producción** (el service worker no
   se registra en desarrollo, a propósito).
2. Escanea un QR válido y confirma: se registra normal.
3. **Pon el móvil en modo avión.**
4. Escanea otro QR y confirma. Debe salir *"Sin conexión. La visita se enviará
   sola…"* y la franja *"1 registro pendiente"*.
5. Repite con dos o tres coches más.
6. **Quita el modo avión.** En unos segundos el contador baja solo hasta
   desaparecer.
7. Comprueba en `/admin/registros` que las visitas están, **en el orden en que
   las escaneaste**.

Y el caso que más importa:

8. Con el móvil en avión, **cierra la aplicación del todo** y vuelve a abrirla.
   Los pendientes tienen que seguir ahí.

Para probar que la página abre sin red: con el modo avión puesto y la app cerrada,
ábrela. Debe cargar el escáner (o la pantalla de sin conexión), no el error del
navegador.

---

## 5. Lo que no cubre

1. **El canje de promociones no encola desde su formulario.** La cola sabe
   manejar `tipo: 'canje'` y el reenvío está conectado, pero `ConfirmPromo` no
   tiene todavía el envoltorio que atrapa el fallo de red — solo lo tiene
   `ConfirmVisit`. Es el mismo patrón, unas veinte líneas.
2. **Las fotos de evidencia** no se pueden tomar sin conexión (§ 3.5).
3. **La caja** (`/empleado/caja`) no tiene cola. Abrir y cerrar una sesión de
   caja sin conexión es un problema distinto y más delicado: el arqueo depende
   de que el estado del servidor sea el que se ve.
4. **No hay pruebas automáticas del comportamiento sin red**, solo de la política
   (23 pruebas). El paso 8 del § 4 hay que hacerlo a mano.
