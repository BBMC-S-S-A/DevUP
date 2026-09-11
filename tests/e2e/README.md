# Pruebas de extremo a extremo, con Playwright

No es lo mismo que [`e2e/`](../../e2e/README.md), que son guiones sueltos en
`.mjs` para mirar la oficina a mano. Esto es una suite de verdad —
`@playwright/test`, con sus aserciones y su corredor— pensada para correr en
cada cambio, el día que se decida traerla a integración continua.

**Portada y adaptada** desde la rama `claude/inicio-desarrollo-nu1ftu` el 5 de
septiembre de 2026, junto con las seis correcciones de flujo del mismo día
(ver [`docs/estudio-viabilidad-y-flujo-2026-09-05.md`](../../docs/estudio-viabilidad-y-flujo-2026-09-05.md)).
Esa rama diverge 132 commits de este punto — no fue un cherry-pick, fue una
verificación selector por selector contra el código de hoy. Lo que se
encontró y se corrigió está anotado en la cabecera de cada archivo; lo más
gordo:

- El tablero ya no nace con tres columnas fijas — nace vacío y cada columna se
  crea a mano (`components/tasks/TaskBoard.tsx`).
- Crear un workspace ya no deja en la lista de `/app`: entra directo al canal
  `general` recién sembrado (la propia corrección del 5 de septiembre).
- La página de búsqueda cambió su placeholder y su mensaje de «sin
  resultados», y ya no tiene un mínimo de dos caracteres.

**No verificada en vivo.** Se escribió y se adaptó sin Docker a mano, así que
nada de esto se ha ejecutado contra una base de datos real — solo se comprobó
que compila (`npm run typecheck:e2e`) y que Playwright sabe listar las 21
pruebas (`npx playwright test --list`). Antes de fiarse de esta suite en serio
hace falta una pasada completa en una máquina con Docker.

## Cómo se corre

Playwright sigue sin ser dependencia del proyecto — es una decisión pendiente,
anotada en [`docs/traspaso-2026-08-29.md`](../../docs/traspaso-2026-08-29.md)
(«¿Instalamos Playwright? cientos de MB en tu máquina»), no tomada aquí. Se
instala aparte, igual que ya se hace para los guiones de `e2e/`:

```bash
npm run db:up                              # Postgres y MinIO
npm run dev                                # API en :4000, web en :3000
npm install --no-save @playwright/test     # no es dependencia del proyecto

npm run test:e2e                           # toda la suite
npm run test:e2e:ui                        # con la interfaz de Playwright
npx playwright test cuenta.spec.ts         # un solo archivo
```

La API tiene que arrancar sin SMTP configurado y con su salida volcada a un
archivo — sin eso, `enlaceDelRegistro()` no tiene dónde leer los enlaces de
invitación y recuperación:

```bash
npm run dev:api > /tmp/api.log 2>&1 &
E2E_API_LOG=/tmp/api.log npm run test:e2e
```

## Qué hay

| Archivo | Qué protege |
|---|---|
| `ayudantes.ts` | Todo lo compartido: altas por invitación, crear organización y workspace, enlaces de correo sin SMTP |
| `global-setup.ts` | La cuenta sembradora — la única que puede darse de alta sin invitación |
| `cuenta.spec.ts` | Alta por invitación, invitación gastada, recuperar contraseña, límite de intentos |
| `espacios.spec.ts` | Workspace personal, tablero, subir archivos, canales de texto y voz |
| `conversacion.spec.ts` | Mensajes en vivo, no leídos, responder, editar, menciones, límite de acceso |
| `busqueda.spec.ts` | Que encuentra lo que toca y no cruza organizaciones |
| `voz.spec.ts` | Llamada en malla, cámara, y el consentimiento explícito para grabar |

Las pruebas comparten una única base de datos y corren en serie a propósito
(`fullyParallel: false`, `workers: 1`): varias cuentan filas, y aislarlas por
organización para paralelizar no compensa la complejidad todavía.
