# Endurecer el acceso (Supabase Auth)

Complemento del arreglo C-05 de `docs/AUDITORIA-PRODUCCION.md`.

## Lo que ya está hecho en el código

El inicio de sesión pasó del navegador a una server action
(`src/modules/auth/loginActions.ts`). Antes de tocar Supabase aplica el
limitador distribuido con **dos claves**:

- **por IP** — frena a quien prueba muchas cuentas desde un sitio;
- **por correo** — frena a quien prueba muchas contraseñas de una cuenta
  repartiendo el ataque entre muchas IP.

Y el mensaje de credenciales es siempre el mismo ("Correo o contraseña
incorrectos"), nunca "ese correo no existe": el formulario deja de ser un
comprobador de qué cuentas están registradas.

## Lo que hay que hacer a mano en Supabase

**Sin estos tres pasos, el trabajo está a medias.** La clave anónima es pública
por diseño (viaja en el navegador), así que un atacante decidido puede llamar
al endpoint de Auth de Supabase **directamente** y saltarse la aplicación
entera. Ese camino solo se cierra en el panel del proyecto:

1. **CAPTCHA en Auth.** Authentication → Settings → *Enable Captcha protection*
   (hCaptcha o Cloudflare Turnstile). Es lo único que encarece de verdad un
   ataque automatizado contra el endpoint directo.
2. **Bajar el rate limit de Auth.** Authentication → Rate Limits → *Sign in /
   Sign up*. El valor por defecto es generoso para una plataforma con este
   perfil de uso.
3. **Protección contra enumeración.** Authentication → Settings → activar la
   opción que uniforma las respuestas de "usuario no encontrado".

Conviene revisar también:

- **Longitud mínima de contraseña** y detección de contraseñas filtradas
  (Auth → Password settings).
- **Caducidad del enlace mágico y del token de recuperación** (por defecto una
  hora; 15 minutos es más razonable).

## Cómo comprobar que funciona

Con `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` configuradas, hacer
seis intentos fallidos seguidos contra el mismo correo desde el formulario: el
sexto debe responder "Demasiados intentos de acceso" **sin llegar a Supabase**.
Repetir desde otra IP con el mismo correo: la clave por correo debe seguir
frenando.

Sin esas variables el limitador cae al modo local por instancia, que frena
menos pero sigue frenando. En producción **tienen que estar puestas**.
