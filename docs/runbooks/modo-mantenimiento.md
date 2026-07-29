# Runbook · Cerrar y reabrir la aplicación

**Para qué sirve:** dejar MembeGo en un estado donde **nadie escribe**. Es el
paso 0 de toda restauración y de toda migración peligrosa.

---

## Por qué importa cerrar de verdad

Restaurar o migrar mientras la aplicación acepta escrituras produce una mezcla:
encima del estado de las 14:00 se van escribiendo visitas y pagos de las 14:05,
y después nadie puede separar qué fila vino de dónde. Un cliente canjea dos
veces el mismo beneficio; una transacción de caja existe sin su sesión.

Eso no se arregla con otra restauración. Por eso el interruptor existe.

---

## Preparación (una sola vez, hazlo ANTES de necesitarlo)

En Vercel → Settings → Environment Variables, para **Production**:

| Variable | Valor |
|---|---|
| `MODO_MANTENIMIENTO` | `false` |
| `MANTENIMIENTO_PASE` | una cadena aleatoria de **32 caracteres o más** |

Genera el pase con:

```bash
openssl rand -base64 32
```

**El pase NO puede ser el mismo que `BOOTSTRAP_SECRET`.** El pase viaja en una
cookie de tu navegador: es un secreto que se expone a propósito. Si fuera el
mismo que autoriza `/api/bootstrap-superadmin`, filtrarlo pasaría de "alguien
puede usar la app cerrada" a "alguien puede crear un superadministrador".

Un pase de menos de 16 caracteres **se ignora**: el código lo trata como si no
existiera y no habrá puerta. Es a propósito (`src/modules/mantenimiento`).

---

## Cerrar

1. Vercel → Environment Variables → `MODO_MANTENIMIENTO` = `true`.
2. Redesplegar (Deployments → el último → *Redeploy*). Las variables no se
   propagan a las instancias que ya están corriendo.
3. Comprobar desde una ventana de incógnito: cualquier página debe devolver la
   pantalla *"Estamos haciendo un mantenimiento"*.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<dominio>/cliente/inicio   # 503
curl -s https://<dominio>/api/health                                        # sigue respondiendo
```

`/api/health` está **exento** a propósito: si el monitor de uptime viera caída
en cada mantenimiento planificado, en dos meses nadie distinguiría su alerta de
una caída real.

---

## Trabajar con la aplicación cerrada

Abre en tu navegador:

```
https://<dominio>/?pase=<MANTENIMIENTO_PASE>
```

El pase se guarda en una cookie (2 horas) y se te redirige a la misma ruta sin
el parámetro — para que no quede en el historial, ni en el `Referer`, ni en un
enlace que copies de la barra de direcciones.

A partir de ahí navegas con normalidad mientras el resto del mundo ve la
pantalla de mantenimiento. Es lo que permite **verificar antes de reabrir**
(`docs/RECUPERACION.md` § 4, paso 4).

Si se te acaban las 2 horas, vuelve a entrar con `?pase=` otra vez.

---

## Qué pasa mientras está cerrado

| Sistema | Comportamiento |
|---|---|
| Navegación web | 503 + pantalla de mantenimiento |
| `/api/jobs` (QStash) | 503 → **QStash reintenta** con espera creciente. Los trabajos salen solos al reabrir |
| `/api/pagos` (CardNET) | 503 → **CardNET NO reintenta**. Los avisos recibidos en esta ventana se pierden y hay que conciliar → [`pagos-cardnet.md`](pagos-cardnet.md) |
| `/api/health` | Responde normal |
| Buscadores | 503 con `Retry-After: 300`. Google no desindexa por esto; sí lo haría un 404 o un 200 con la página vacía |

**Consecuencia operativa:** cierra en la ventana más corta que puedas y avisa
al personal de la pista antes. Un mantenimiento de 20 minutos un martes a las
10 de la mañana no es lo mismo que uno un sábado a las 11.

---

## Reabrir

1. `MODO_MANTENIMIENTO` = `false`.
2. Redesplegar.
3. Verificar en incógnito que la página de inicio carga.
4. Concilia lo que se perdió: pagos de CardNET, lavados cobrados a mano.
5. Anota en la bitácora de `docs/RECUPERACION.md` § 7.

---

## Si el interruptor no responde

**Síntoma:** pusiste `true`, redesplegaste, y el sitio sigue abierto.

- ¿El valor es exactamente `true` o `1`? Cualquier otra cosa —`TRUE ` con
  espacio sí vale; `si`, `on`, `yes` **no**— deja el sitio abierto. Es
  deliberado: una variable con un valor raro no puede tirar MembeGo.
- ¿La cambiaste en el entorno **Production** y no en Preview?
- ¿Redesplegaste? Sin redespliegue las instancias calientes siguen con el valor
  viejo.
- ¿Estás mirando con la cookie del pase puesta? Prueba en incógnito.

**Al revés — el sitio se cerró y no querías:** pon `MODO_MANTENIMIENTO=false`,
redespliega. Si no puedes entrar a Vercel, borrar la variable entera también
sirve: sin valor, el modo queda apagado.
