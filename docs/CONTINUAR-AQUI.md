# Continuar aquí

Informe de estado. Existe para que quien retome —persona o agente— no tenga que
redescubrir lo que ya se decidió ni volver a discutirlo.

Contexto completo, con los motivos de cada decisión:
[`CONTEXTO-COMPLETO.md`](CONTEXTO-COMPLETO.md). Plan a 12 semanas con 94 tareas:
`DevUP-Plan-de-Desarrollo.pdf`.

---

## Dónde estamos

La iteración en curso —**llamadas de voz y un sitio donde alojar archivos**—
está construida y probada de punta a punta.

**Hecho y verificado**

- Esquema en `db/migrations/`, aplicado contra un Postgres real. `npm run
  test:rls` pasa con 45 comprobaciones de aislamiento, incluidos los workspaces
  personales y los mensajes de canales privados.
- API en Fastify: alta y acceso con scrypt, sesiones con token de refresco
  rotatorio, organizaciones, workspaces, canales, archivos con URLs firmadas y
  señalización por WebSocket.
- Interfaz en Next.js: acceso, selector de organización, barra lateral de
  canales, biblioteca de archivos con etiquetas, búsqueda y previsualización, y
  sala con voz, vídeo, pantalla compartida y duración de la llamada.
- Grabación en el navegador con consentimiento unánime, que acaba como un
  archivo más en la biblioteca del canal.
- Workspaces personales frente a compartidos, y tablero de tareas por workspace
  con arrastrar y soltar.
- Mensajería de texto en tiempo real: hilos, edición, borrado, adjuntos de la
  biblioteca y no leídos en la barra lateral.
- Altas solo por invitación, verificación de correo, recuperación de
  contraseña, límite de intentos y notificaciones con campana.
- CI que corre tipos, migraciones, aislamiento y build en cada push.
- Imágenes de Docker para API y web, y guía de despliegue.
- Prueba en navegador con dos pestañas y micrófono y cámara sintéticos: dos
  pares se conectan, se oyen, se ven, negocian el permiso de grabación, graban,
  guardan el archivo y cuelgan; el historial se cierra solo.

**Lo siguiente**

**Desplegarlo y usarlo dos semanas.** Ya no queda nada que lo bloquee: la lista
de comprobación previa está en [`DESPLIEGUE.md`](DESPLIEGUE.md), con las cuatro
variables sin las cuales la API se niega a arrancar en producción.

El hito que decide el proyecto —que el propio equipo abandone sus herramientas
actuales— no se alcanza con algo que solo corre en localhost. Lo que salga de
ese uso real vale más que seguir añadiendo funcionalidades sobre unos cimientos
que nadie ha estresado.

El cifrado de las salas **ya está decidido**: extremo a extremo siempre,
grabación en el cliente con permiso de todos. El razonamiento completo, con lo
que se descartó y por qué, está en
[`decisiones/0001-cifrado-de-salas.md`](decisiones/0001-cifrado-de-salas.md).

---

## Cambio de arquitectura, agosto

El proyecto empezó sobre Supabase y ya no se apoya en él. Datos, autenticación,
almacenamiento y tiempo real son ahora propios.

Lo que **no** cambió: el aislamiento sigue viviendo en Postgres con RLS, que era
la decisión que importaba. Lo que cambió: `auth.uid()` pasó a ser
`public.current_user_id()` sobre la variable de sesión `app.user_id`, y las
políticas de `storage.objects` se sustituyeron por comprobaciones en la API
antes de firmar cada URL.

Motivo, en una línea: DevUP se vende como la capa que coordina infraestructura
ajena, y depender de un único proveedor para su propio plano de control
contradice el discurso justo en la parte que menos se puede mover después.

---

## Lo que más fácil es romper sin darse cuenta

- **`DATABASE_URL` tiene que ser el rol `devup_app`**, que no es propietario de
  las tablas. Postgres salta RLS para el propietario: apuntar esta variable al
  rol de las migraciones desactiva todo el aislamiento **sin un solo error** en
  los registros. Las consultas seguirían funcionando y devolverían de más.
- **Toda consulta pasa por `withUser()`**, que fija `app.user_id` con alcance
  local a la transacción. Con alcance de sesión, la conexión vuelve al pool con
  la identidad del último usuario dentro.
- **Las funciones de pertenencia son `SECURITY DEFINER` a propósito.** Quitarlo
  provoca recursión infinita en las políticas.
- **Un workspace personal no se protege con una columna.** `can_access_channel`
  y la política de `files` miraban la organización, no el workspace: si vuelven
  a mirar ahí, los canales y archivos de un espacio personal se ven desde todo
  el equipo. Tienen que colgar de `can_access_workspace`.
- **Cada tabla nueva con `organization_id` necesita su política y su caso en
  `apps/api/src/db/isolation.test.ts`.** Es la disciplina que impone elegir RLS,
  y el único freno automático contra una fuga entre clientes.
- **Nunca firmar una URL de almacenamiento sin comprobar antes la pertenencia.**
  La primera carpeta de la clave es la frontera de seguridad, y ya no hay
  políticas en el almacén que la vigilen por nosotros.
- **Nada secreto en una variable `NEXT_PUBLIC_*`.** Se incrusta en el bundle
  durante el build y cualquiera puede leerla. Por eso las credenciales de TURN
  las sirve la API y no el entorno de la web.

---

## Puesta en marcha

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 17 y MinIO
npm run db:migrate
npm run dev          # API en :4000, web en :3000
npm run test:rls     # que esté en verde antes de empezar nada
```
