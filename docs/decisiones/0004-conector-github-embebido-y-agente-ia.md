# 0004 · Mejorar el conector de GitHub y sumar un agente de IA para desarrollo

**Estado:** propuesto — pendiente de visto bueno · **Fecha:** agosto de 2026 ·
**Decide sobre:** cómo ampliar lo que hoy se ve del repositorio de GitHub
dentro de DevUP, y cómo dar el primer paso de S10 ("orquestación de
agentes") conectando un asistente de IA (Claude) al flujo de desarrollo.

---

## Resumen para quien no vaya a leer el resto

**Un iframe literal de GitHub no funciona: GitHub bloquea que sus páginas
se embeban.** Lo que ya existe en `apps/api/src/connectors/github.ts` —traer
los datos por la API REST y renderizarlos nativos dentro de DevUP— es la
solución correcta, no un sustituto de segunda categoría. Este documento
propone **ampliar ese mismo patrón** (README renderizado, explorador de
archivos, detalle de PR con diff) en vez de perseguir un embebido que
GitHub no permite.

**Para la IA:** la conexión con Claude para desarrollo es, en esencia,
adelantar la **semana 10** del plan de 12 semanas ("orquestación de
agentes"). Se propone entrar por una semilla pequeña —un asistente de chat
de solo lectura sobre tareas/archivos/canal, con la clave de API que aporta
cada organización (BYOI)— antes de construir el flujo completo de "tarea
asignada a un agente → ejecutada → PR → aprobada".

---

## 1. El "iframe de GitHub": por qué no se puede y qué hacer en su lugar

### 1.1 La razón técnica

Las páginas de `github.com` (repos, PRs, issues, código) se sirven con
cabeceras `X-Frame-Options: deny` y una política de CSP `frame-ancestors`
que impide exactamente lo que un iframe necesita: ser embebido dentro de
otro dominio. Un `<iframe src="https://github.com/owner/repo">` dentro de
DevUP no carga nada — pantalla en blanco, o el navegador rechaza
directamente la conexión con un error visible en la consola. No es un
límite de configuración de DevUP; es una decisión de seguridad de GitHub,
igual de válida que la propia decisión de DevUP de no permitir según qué
cosas embebidas por terceros.

La única excepción real son los **Gists** (`gist.github.com/user/id.js`),
que sí ofrecen un embebido, pero vía `<script>` que hace `document.write` —
no un iframe, exige relajar la política de `script-src` del sitio, y solo
sirve para fragmentos de código sueltos, no para un repositorio completo
con su actividad.

### 1.2 Lo que ya se construyó, y por qué es mejor que un iframe

`apps/api/src/connectors/github.ts` ya resuelve esto de la manera correcta:
trae los datos por la API REST de GitHub (rama por defecto, PRs y issues
abiertas contadas por separado con `search/issues` y `type:pr`/`type:issue`,
los últimos commits, el estado de la última ejecución de CI) y
`apps/api/src/routes/github.ts` los sirve a una pestaña propia en la
organización. Eso es **estrictamente mejor** que un iframe:

- Respeta el tema visual y el idioma de DevUP.
- No depende de que GitHub decida mantener ese embebido disponible.
- Es interactivo con el resto de la app (por ejemplo, se puede enlazar una
  tarea del tablero a un commit).
- Ya tiene resuelto el barrendero de refresco cada 10 minutos y el manejo
  de fallos parciales (si Actions no está habilitado en el repo, ese
  fragmento queda en `null` sin tirar el resto).

### 1.3 Cómo ampliarlo — tres extensiones concretas, mismo patrón

| Extensión | Endpoint de GitHub | Nota |
|---|---|---|
| **README renderizado** | `GET /repos/{owner}/{repo}/readme` (contenido) + `POST /markdown` (para convertir a HTML con el mismo render que usa GitHub) | Hoy no hay ninguna librería de Markdown en `apps/web` — si se prefiere renderizar en el cliente en vez de pedirle el HTML ya hecho a GitHub, hace falta sumar una pequeña (`react-markdown` o similar) |
| **Explorador de archivos** | `GET /repos/{owner}/{repo}/contents/{path}` | Navegar el árbol del repo sin salir de DevUP; es la misma idea que ya usa la biblioteca de archivos propia, aplicada a un árbol ajeno |
| **Detalle de PR/issue con diff** | `GET /repos/{owner}/{repo}/pulls/{number}/files` | Útil de cara a S9 ("migraciones sincronizadas con el repo") y S10 (agentes que abren PRs) — ver la revisión previa a que un agente proponga un cambio |

Ninguna de las tres necesita relajar la CSP actual de la API (`helmet` con
`contentSecurityPolicy: false` porque hoy solo sirve JSON — al añadir HTML
renderizado de terceros conviene revisar esa política antes, no después).

---

## 2. Conector de IA (Claude) para desarrollo

### 2.1 Dónde encaja esto en el plan ya existente

Esto **no es una funcionalidad nueva fuera de alcance** — es exactamente lo
que la semana 10 del plan de 12 semanas ya prevé: *"Tarea asignada a un
agente, ejecutada, aprobada y fusionada"*. `CONTINUAR-AQUI.md` lo pone en
"S8–S12" como lo siguiente después de terminar la vista de infraestructura
(S7). Esta propuesta es adelantar una semilla de esa pieza, con el mismo
criterio que ya usaron para la vista inmersiva (`0002`): entrar con lo
mínimo que prueba la idea, no con la visión completa.

### 2.2 Diseño propuesto, coherente con lo que ya existe

**1. Nuevo proveedor en la bóveda de credenciales.** Añadir `"anthropic"`
al arreglo `PROVIDERS` de `apps/api/src/routes/connections.ts`. Cada
organización (o persona, según convenga) pega su propia clave de API de
Anthropic desde la interfaz, cifrada con AES-256-GCM exactamente igual que
el token de GitHub — mismo patrón de dos tablas (`connections` /
`connection_secrets`) por el mismo motivo que separa `users` de `profiles`:
si el secreto viviera en la fila que se puede listar, cualquier política
que deje ver la lista dejaría ver también el secreto.

Esto es, además, coherente con BYOI: la clave es del cliente, no una
compartida por DevUP — nadie paga el consumo de IA de otro.

**2. Nuevo conector**, `apps/api/src/connectors/anthropic.ts`, usando el
SDK oficial `@anthropic-ai/sdk` (nunca `fetch` a mano — es la práctica que
ya sigue el proyecto de tener un único sitio por integración externa, igual
que `storage/s3.ts` compone toda clave de archivo en un solo lugar).

**3. Alcance de la primera semilla — deliberadamente acotado:**

| Incluye | No incluye (todavía) |
|---|---|
| Chat de solo consulta dentro de un workspace: responde preguntas sobre tareas del tablero, archivos de la biblioteca, mensajes recientes del canal | Ejecutar código, tocar el sistema de archivos del cliente, abrir PRs |
| Usa la clave de API que la organización conectó en la bóveda | Créditos ni facturación compartida de DevUP |
| Pestaña o panel propio, mismo patrón visual que GitHub/Spotify | Automatización sin aprobación humana explícita |

Justo como con la oficina inmersiva: la semilla se puede tirar sin dolor si
nadie la usa, y si engancha, ahí se justifica construir el flujo completo
de "tarea → agente → PR → aprobación" que S10 describe — que si acaso
necesita la misma pieza de bóveda que un futuro GitHub con OAuth para abrir
PRs automáticos (ver `plan-conectores-busqueda-e-interfaz.md` §5.1).

**4. Modelo por defecto:** `claude-opus-5` para tareas de desarrollo reales
— es el modelo recomendado por defecto salvo que se priorice explícitamente
costo/latencia sobre calidad, en cuyo caso `claude-sonnet-5` es la
alternativa razonable (near-Opus en tareas de código y agentic, a menor
coste). La clave de API la aporta cada organización — DevUP nunca decide
cuánto gasta un cliente.

**5. Disciplina de aislamiento, igual que con cualquier tabla nueva.** Si
la semilla guarda algún historial de conversación (recomendable para que el
chat tenga contexto entre mensajes), esa tabla necesita su política de RLS
y su caso en `apps/api/src/db/isolation.test.ts` — es "el único freno
automático contra una fuga entre clientes" y no es negociable según la
propia disciplina que el proyecto ya se impone.

**6. Seguridad de la clave, igual que TURN y GitHub.** La clave de Anthropic
nunca debe viajar a una variable `NEXT_PUBLIC_*` ni exponerse en ninguna
respuesta HTTP — todas las llamadas al modelo pasan por la API, que
descifra la clave con `getDecryptedSecret()` (ya existe en
`connections.ts`) justo antes de la llamada saliente y la descarta después,
igual que ya hace el conector de GitHub.

### 2.3 Lo que se descarta para esta primera semilla, y por qué

- **Un agente que ejecuta código o abre PRs automáticamente** — es
  literalmente el alcance de S10 completo, no de la semilla. Construirlo ya
  exigiría decidir permisos, aprobación humana obligatoria y probablemente
  una GitHub App con OAuth en vez del token de acceso personal actual (el
  propio `plan-conectores-busqueda-e-interfaz.md` ya lo anticipa).
- **Créditos de Anthropic pagados por DevUP** — rompe BYOI de la misma
  manera que alojar la base de datos de un cliente rompería la promesa de
  "no alojamos infraestructura ajena".
- **Reemplazar el uso de Claude Code/Codex por el propio equipo** — la
  semilla es para los *clientes* de DevUP dentro de su workspace, no un
  sustituto de las herramientas de desarrollo que el propio equipo de
  DevUP ya usa para construir DevUP.

---

## 3. Decisiones propuestas

- Ampliar el conector de GitHub con README renderizado, explorador de
  archivos y detalle de PR/issue con diff — mismo patrón que ya existe,
  sin perseguir un iframe que GitHub no permite.
- Sumar `"anthropic"` como proveedor nuevo en la bóveda de credenciales.
- Construir una semilla de asistente de IA de solo consulta (sin ejecutar
  código ni abrir PRs) como primer paso de S10, antes de comprometerse a
  la visión completa de orquestación de agentes.

## Preguntas abiertas

1. ¿La semilla del asistente de IA se limita a un workspace, o conviene que
   sea a nivel de organización desde el principio (como la bóveda ya lo
   permite para GitHub)?
2. ¿Se guarda historial de conversación entre sesiones, o cada conversación
   empieza en blanco? Guardar historial implica una tabla nueva con su
   propia política de RLS.
3. ¿Quién revisa y aprueba la primera GitHub App con OAuth, el día que S10
   necesite abrir PRs automáticos y el token de acceso personal actual ya
   no alcance?
