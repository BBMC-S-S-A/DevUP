# Diseño · Alojar repositorios en DevUP

11 de septiembre de 2026. Continúa
[ALOJAR-EL-REPOSITORIO-Y-EL-MODELO-DE-NEGOCIO.md](ALOJAR-EL-REPOSITORIO-Y-EL-MODELO-DE-NEGOCIO.md),
que explica **por qué**. Esto es el **cómo**.

Alcance: `git clone`, `git push` y `git pull` contra DevUP, con el push
disparando la auditoría. **No** incluye construir ni ejecutar nada — eso sigue
siendo otra empresa, y el documento anterior explica por qué.

---

## 1. La decisión, primero

> **Un servicio aparte, con su disco, sirviendo `git http-backend`, que no
> decide nada: pregunta a la API por cada petición.**

Cuatro piezas:

| Pieza | Dónde | Qué hace |
|---|---|---|
| `apps/git` | Servicio propio en Railway, con volumen | Habla el protocolo git por HTTP. **Cero lógica de permisos** |
| La API | Como hoy | Es quien dice sí o no, con RLS detrás |
| Postgres | Como hoy | El catálogo: qué repositorios existen y de quién son |
| El disco | Volumen de Railway | Los repositorios desnudos (`--bare`) |

Esto no inventa una arquitectura: **es exactamente la que ya tiene el
proyecto.** Tiempo real y el almacén ya son servicios aparte, y el almacén ya
tiene su volumen. Uno más no cambia la forma de nada.

### Por qué un servicio aparte y no dentro de la API

Tres razones, en orden de peso:

1. **La API no tiene git y no debería tenerlo.** Su imagen es `node:22-alpine` y
   corre como usuario `devup`, sin privilegios. Meter el binario de git y un
   disco dentro convierte un proceso que solo habla SQL y HTTP en uno que además
   escribe archivos de clientes.
2. **Un volumen ata el servicio a una instancia.** Es la contrapartida honesta
   de esta decisión: mientras los repositorios vivan en un disco, ese servicio
   no se replica. La API sí debe poder replicarse, y hoy puede. Si van juntos,
   se pierde.
3. **Un push es largo y pesado.** Un `clone` de un repositorio grande ocupa una
   conexión durante minutos. No debe competir por el mismo proceso que atiende
   el chat.

### Lo que descarté, y por qué

- **Git en JavaScript puro sobre S3** (`isomorphic-git` y compañía). Evitaría el
  volumen, que es tentador. Pero implementar `upload-pack` y `receive-pack`
  —negociación de paquetes incluida— es escribir un servidor git; y un servidor
  git a medias corrompe repositorios de clientes en vez de dar un error. **Lo
  que aquí se guarda no se puede volver a generar.** No es el sitio para ser
  original.
- **Meterlo en la imagen de la API.** Ver arriba.
- **Un Forgejo/Gitea al lado.** Resuelve esto y trae con él usuarios, permisos,
  issues y PRs propios — un segundo modelo de identidad al lado del nuestro, con
  su propia idea de quién puede ver qué. Eso es precisamente lo que el
  aislamiento por RLS existe para evitar. Se descarta por el modelo, no por el
  tamaño.

---

## 2. Lo que de verdad hay que resolver: el aislamiento

Esta es la parte que puede hundir el diseño, así que va antes que el resto.

**El sistema de archivos no sabe nada de RLS.** Todo lo bueno que tiene DevUP
—46 de 46 tablas con aislamiento en el motor, y no en el `where` de nadie— se
queda en la puerta. Un directorio es un directorio.

La regla, entonces:

> **El servicio de git no decide. Pregunta, y solo sirve exactamente lo que la
> respuesta le autorizó.**

### El flujo de una petición

```
git push  ──► apps/git
                │  Basic auth: usuario cualquiera, contraseña = llave de DevUP
                │
                ├─► POST /interno/git/autorizar   (a la API)
                │     { llave, ruta: "acme/tienda.git", operacion: "escribir" }
                │
                │   La API resuelve la llave a una persona y pregunta por RLS
                │   si esa persona puede escribir en ese repositorio.
                │
                ◄─┤ { ok: true, repositorioId: "uuid", rutaEnDisco: "…" }
                │
                └─► sirve git-http-backend SOBRE LA RUTA QUE VINO EN LA RESPUESTA
```

Los tres detalles que hacen que esto sea seguro y no decorativo:

1. **La ruta en disco la manda la API, no la calcula el servicio de git.** El
   servicio nunca concatena nada que venga del cliente. Sin esto, `../` sería
   una fuga a través de toda la plataforma, y sería el fallo más caro posible.
2. **Los directorios se nombran por identificador, no por nombre.**
   `/repos/<organizacion_id>/<repositorio_id>.git`. Renombrar es gratis, y el
   nombre del cliente no acaba siendo una ruta del sistema de archivos.
3. **La decisión se toma con `withUser`**, como todo lo demás. La pregunta «¿puede
   esta persona escribir aquí?» la contesta la misma política que contesta
   «¿puede ver este canal?». No hay un segundo modelo de permisos.

### La llave

Se reutiliza lo que ya existe: `sessions` guarda `refresh_token_hash` y ya sabe
distinguir una sesión de agente (`is_agent`), con `session_consume` en
`security definer` porque la tabla no tiene política de inserción. Una llave de
git es una fila más de esa familia, marcada como tal.

No se guarda la llave, se guarda su huella — igual que hoy. Y se enseña **una
sola vez, al crearla**, que es la misma decisión que ya se tomó con las llaves
del MCP.

---

## 3. El catálogo

Una migración, `00XX_repositorios_alojados.sql`.

```sql
create table public.hosted_repositories (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- El nombre que se escribe en la URL de clonado. Único dentro de la
  -- organización, no globalmente: dos empresas pueden tener su «tienda».
  name            text not null check (name ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  default_branch  text not null default 'main',
  -- Para el cupo. Lo actualiza el gancho de recepción, que es el único momento
  -- en que el tamaño puede cambiar.
  size_bytes      bigint not null default 0,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);
```

Cuelga del **workspace**, no de la organización, por la misma razón que la
migración 0035 movió allí GitHub, la base de datos y la infraestructura: cada
proyecto tiene lo suyo, y «los repositorios de la organización» dejó de ser una
pregunta con sentido.

Y una segunda tabla para lo que de verdad justifica todo esto:

```sql
create table public.push_events (
  id            uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.hosted_repositories(id) on delete cascade,
  ref           text not null,          -- refs/heads/main
  before_sha    text not null,
  after_sha     text not null,
  pushed_by     uuid references public.users(id) on delete set null,
  pushed_at     timestamptz not null default now()
);
```

**Esta tabla es la razón del proyecto entero.** Es la que convierte «has mirado»
en «ha pasado algo», que es lo que el conector de GitHub no puede dar y lo que
el grafo necesita para tejerse solo.

### Lo que no se puede olvidar

La trampa está escrita en el propio repositorio y ya costó horas: **una tabla sin
política no da error, devuelve cero filas.** Así que las dos tablas llevan RLS,
sus políticas, **y su caso en `isolation.test.ts`** en el mismo commit. Sin el
caso, no entra.

`push_events` se escribe desde el gancho, no desde una petición de persona. Sigue
el patrón que ya usa `deployments`: **sin política de INSERT**, escrito solo por
una función `security definer`, con un caso que comprueba que un INSERT directo
no cuela aunque el repositorio sea tuyo.

---

## 4. El push dispara la auditoría

El gancho `post-receive` de cada repositorio hace una sola cosa: avisar.

```
post-receive ──► POST /interno/git/recibido
                   { repositorioId, ref, antes, despues }
```

La API registra el evento y encola la auditoría. **No se audita dentro del
gancho**: un gancho lento hace que el `git push` de una persona se quede
colgado, y nadie va a tolerar eso dos veces.

### Y aquí está el regalo: la auditoría no hay que reescribirla

Los analizadores no saben de GitHub. `diagnosticar()` recibe
`{ rutas, archivos }` y ya está. El de migraciones recibe el texto de un archivo.
Ninguno de los dos sabe de dónde salió.

Lo único que hay que introducir es una fuente:

```ts
type FuenteDeCodigo = {
  arbol(ref?: string): Promise<{ path: string; type: "blob" | "tree" }[]>;
  archivo(ruta: string, ref?: string): Promise<string>;
};
```

GitHub ya la cumple —`fetchGithubTree` y `fetchGithubFileContent` tienen
exactamente esa forma— y un repositorio alojado la cumple leyendo del disco.
**Los analizadores no cambian ni una línea**, y las pantallas de Base de datos,
Integraciones y Auditoría funcionan sobre repositorios alojados el día que
exista la fuente.

Con una diferencia que es todo el punto:

| | GitHub | Alojado |
|---|---|---|
| Archivos por análisis | 12–40 | **todos** |
| Cuándo | al abrir la pantalla | **en cada push** |
| Historia | no | **sí** |

---

## 5. Los cupos y el respaldo, que no son un detalle

**Esto no es una función más: es el primer sitio donde DevUP guarda algo que no
puede volver a generar.** Un archivo subido se vuelve a subir. Un repositorio
perdido es el trabajo de alguien.

- **Respaldo del volumen desde el primer día.** El respaldo automático de hoy es
  solo de la base de datos, y el del almacén está pendiente. Aquí no se puede
  quedar pendiente: **sin respaldo, esto no se enciende para nadie.**
- **Cupo por organización**, comprobado en el gancho de pre-recepción, que es el
  único punto donde se puede rechazar antes de escribir. Sin cupo, el
  almacenamiento es un gasto sin techo — y todo lo que corre hoy está en capas
  gratuitas.
- **Tope por push y por archivo.** Alguien subirá un vídeo a un repositorio; pasa
  siempre.
- **Nada de `--force` sobre la rama por defecto** al principio. Reescribir la
  historia de la rama principal es la forma más rápida de que el cliente pierda
  trabajo y la culpa sea nuestra.

---

## 6. Lo que este diseño NO hace

Dicho a propósito, para que no se venda antes de existir:

- **No construye ni ejecuta nada.** Sigue sin haber una sola llamada a `spawn`,
  `exec` ni a un motor de contenedores en la API, y este diseño no añade
  ninguna.
- **No hay PRs, ni issues, ni revisiones.** Es alojamiento, no un GitHub. Las
  revisiones, si llegan, llegan sobre el grafo — que es donde tendrían algo que
  las demás no tienen.
- **No migra tus repositorios de GitHub solo.** Un `git push --mirror` a mano
  funciona desde el primer día; el botón viene después.
- **No sustituye al conector.** Los dos conviven: hay clientes que no van a mover
  su código, y para ellos GitHub tal como está sigue siendo el camino.
- **No se replica.** El volumen ata el servicio a una instancia. Hay que saberlo
  antes, no descubrirlo con carga.

---

## 7. En qué orden se construye

| | Qué | Señal de que está |
|---|---|---|
| **1** | `apps/git` con `http-backend`, autorización contra la API, y las dos tablas con sus políticas y sus casos de aislamiento | `git clone` de un repositorio vacío, y `git push` de un commit |
| **2** | El gancho `post-receive` escribiendo `push_events` | Un push aparece en la base sin que nadie abra una pantalla |
| **3** | `FuenteDeCodigo`, con GitHub adaptado detrás **sin cambiar su comportamiento** | Base de datos e Integraciones siguen exactamente igual |
| **4** | La fuente local, leyendo del repositorio alojado | La Auditoría corre sobre el proyecto entero, en cada push |
| **5** | Cupos, respaldo y la pantalla para crear repositorios y llaves | Se puede enseñar a alguien de fuera |

El 3 es el paso que parece burocrático y es el que decide si esto sale bien: **si
la fuente se introduce con GitHub detrás y nada cambia, el 4 es casi gratis.** Si
se salta, acaban existiendo dos auditorías que divergen, que es la enfermedad que
este repositorio ya se curó una vez pasando de veintiocho documentos a dos.

---

## 8. Lo que hace falta decidir antes de escribir código

Tres cosas que no puedo decidir yo:

1. **¿Dónde vive?** `git.hytrex.co` pide un dominio y su certificado — y los
   dominios bonitos de Railway ya se atascaron una vez. Sale antes que el código.
2. **¿SSH además de HTTPS?** HTTPS con llave es más simple y basta. SSH es lo que
   la gente espera, y pide gestionar claves públicas y un puerto propio. **Mi
   recomendación: HTTPS primero**, SSH cuando alguien lo pida de verdad.
3. **¿Cuánto espacio por organización?** Es una decisión de precio, no técnica,
   pero el número tiene que existir antes del primer push.

---

## 9. En una frase

Un servicio aparte que habla git y no decide nada; la API decidiendo con las
mismas políticas que ya protegen todo lo demás; y un gancho de recepción que
convierte cada push en un hecho registrado. **Lo que lo justifica no es alojar
código: es que la auditoría y el grafo pasan de mirar una muestra de veinte
archivos cuando alguien abre una pantalla, a ver el proyecto entero cada vez que
cambia.**
