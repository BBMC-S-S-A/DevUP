# @devup/mcp

La puerta MCP de DevUP: expone el proyecto a un modelo por stdio, para que se
le pueda preguntar «¿en qué va el cobro de la Clínica Santa Ana?» en vez de
reconstruir el contexto a mano.

El porqué de cada decisión —y el plan completo— está en
[docs/HEARTH-Y-LA-PUERTA-MCP.md](../../docs/HEARTH-Y-LA-PUERTA-MCP.md). Aquí
solo está cómo se usa.

**DevUP no compra inferencia.** No hay ninguna clave de un modelo en el
servidor. Cada persona conecta su propio Claude, este proceso corre en su
máquina con sus credenciales, y el aislamiento entre organizaciones lo sigue
poniendo RLS en la base, igual que para el navegador.

## Herramientas

Todas se registran en un solo sitio —`src/registro.ts`— y se sirven por los dos
transportes. Si añades una, `npm run test:mcp` se pone rojo hasta que la
apuntes también en la lista que comprueba el registro.

### Leer

Organizadas por los tres niveles de DevUP —la persona, la organización y el
espacio de trabajo—, porque es como se pregunta: «¿qué tengo yo?», «¿cómo va la
empresa?», «¿qué pasa en este proyecto?».

**Ninguna marca nada como leído.** Lo lee el agente, no la persona: si leer un
canal moviera su contador, al abrir DevUP no sabría qué tiene pendiente.

| Nivel | Herramienta | Qué hace |
|---|---|---|
| Persona | `mi_inicio` | Su portada, cruzando todas sus organizaciones: lo que tiene entre manos, cuánto ha hecho estos días y qué fue lo último. |
| Persona | `mis_tareas` | Las tareas asignadas a quien conectó el agente, con sus imágenes. |
| Persona | `mis_avisos` | La campana: menciones, tareas asignadas, grabaciones, anuncios e invitaciones. |
| Persona | `puntos` | El marcador, con cuánto de cada total se ganó a solas. |
| Organización | `ver_organizacion` | La portada de la organización: cómo va cada proyecto, quién está en qué, lo **atascado** y lo que **no tiene dueño**. |
| Organización | `ver_equipo` | Quién está, a qué se dedica, qué permiso tiene y si está disponible. |
| Organización | `ver_anuncios` | El tablón de anuncios. |
| Organización | `ver_embudo` | El embudo de ventas por etapa, con cliente, responsable e importe. |
| Espacio | `ver_tablero` | El tablero, con sus columnas y tarjetas. |
| Espacio | `ver_tarea` | Una tarea con su detalle y sus imágenes incrustadas. |
| Espacio | `contexto_de_tarea` | Por qué una tarea se hizo así: su historia, sus ramas, sus pruebas. |
| Espacio | `ver_ramas` | Las ramas de trabajo, quién responde de cada una y cuánto está **por repartir**. |
| Espacio | `ver_canales` | Los canales, con lo que tienes sin leer, y quién hay ahora en cada sala de voz. |
| Espacio | `leer_canal` | Los últimos mensajes de un canal, con autor y hora en tu zona. |
| Espacio | `ver_reuniones` | Las reuniones con hora de DevCall: cuándo, cuánto duran y si vas. |
| Espacio | `ver_biblioteca` | Las carpetas y archivos de la biblioteca, o buscar en toda ella por nombre. |
| Espacio | `ver_repositorios` | Los repositorios de GitHub: PRs, issues, CI y últimos commits. |
| Espacio | `ver_arquitectura` | Los componentes del diagrama y cómo se conectan. |
| Espacio | `ver_entornos` | Dónde corre lo que escribe el equipo y cómo quedó el último despliegue. |
| Espacio | `sincronizar_entornos` | Vuelve a preguntar al proveedor por los despliegues. Va aquí aunque escriba: lo que guarda es un reflejo de lo que dijo el proveedor. |
| Espacio | `que_ha_pasado` | La historia de un espacio o de la organización, agrupada por día. Distingue lo que hizo una persona de lo que hizo su asistente. |
| Espacio | `diario` | Cómo ha ido el proyecto por semanas. |
| Todos | `buscar` | Busca a la vez en mensajes, archivos, tareas, clientes, servicios y oportunidades. |

### Escribir

Escriben de verdad y **como la persona**: el equipo no distingue lo que hizo
ella de lo que hizo su agente, así que sus descripciones piden que solo se
escriba lo que ella haya pedido.

| Herramienta | Qué hace |
|---|---|
| `crear_tarea` | Crea una tarea, con responsable, vencimiento, área y categorías. |
| `crear_area` | Una rama de trabajo, con su gerente. Archivar en ella no asigna a nadie. |
| `crear_columna` | Una columna nueva en el tablero. |
| `mover_tarea` | Pasa una tarea de columna. |
| `actualizar_tarea` | Cambia título, descripción, responsable o fecha. |
| `enlazar_rama` | Apunta en una tarea la rama de git donde se trabaja, o cambia su estado. |
| `marcar_hecha` | Cierra una tarea y deja en ella la prueba —PR, commit, enlace o nota—. Las dos cosas caen juntas. |
| `escribir_en_canal` | Publica un mensaje en un canal, con el nombre de la persona. |
| `crear_reunion` | Convoca una reunión con hora. La hora **tiene que llevar su zona** (`2026-09-30T15:00-05:00`): sin ella caería en UTC. |
| `publicar_anuncio` | Publica en el tablón y **avisa a toda la organización**. Lo más ruidoso que se puede hacer desde aquí. |
| `dibujar_arquitectura` | Vuelca un diagrama entero en un espacio. Coloca las cajas ella y reutiliza lo que ya exista. |
| `crear_entorno` | Crea un entorno y lo engancha a un repositorio, leyendo sus despliegues en la misma llamada. |
| `subir_archivos` | Sube archivos a la biblioteca, todos de una llamada. |
| `borrar_archivo` | **La única que borra.** Pide dos llamadas: la primera describe qué se va a borrar, la segunda —con `confirmar: true`— lo borra. |
| `estoy_haciendo` | Dice en DevVerse qué está haciendo el agente. |

Cada herramienta tiene que estar clasificada como de leer o de escribir en
`apps/api/src/security/fugas.test.ts`: una sin clasificar pone CI en rojo. Las
de leer se llaman todas en esa prueba, que falla si alguna devuelve una
credencial.

## Dos maneras de conectarlo, y cuál elegir

| | Remoto (una URL) | Local (este paquete, stdio) |
|---|---|---|
| Qué hay que instalar | Nada | Node y el repositorio clonado |
| Cómo se configura | Se pega la URL en el conector de Claude | Editando un JSON con la ruta de tu copia |
| Dónde corre | En la API de DevUP | En tu máquina |
| Para quién | Cualquiera del equipo | Quien ya desarrolla aquí |

**El remoto es el camino normal.** Se pega

    https://api-production-7b95.up.railway.app/mcp

en Claude → Conectores → Añadir conector personalizado, y Claude hace el resto:
descubre el servidor de autorización, se registra, y manda a DevUP a pedir el
consentimiento. No hay token que copiar ni archivo que editar.

**La URL es la fea a propósito.** `api.hytrex.co` todavía no sirve: sus
certificados se quedaron atascados en Railway con el DNS ya correcto, y todo
apunta mientras tanto a `*.up.railway.app` — está contado en
`docs/LO-QUE-HAY-Y-LO-QUE-FALTA.md`. El día que el dominio bonito emita, se
cambia aquí y en el `.mcp.json` de la raíz.

**Y es el que usa el repositorio.** El `.mcp.json` de la raíz apunta a esta
misma URL, así que quien abra el proyecto en Claude Code tiene las herramientas
sin instalar ni configurar nada: las autoriza una vez con su propia cuenta y
listo. Antes arrancaba el paquete local, que exige un archivo de token que casi
nadie tiene creado — y el síntoma era «no hay token con el que entrar a DevUP»
sin que nada dijera qué token ni de dónde.

> **Ojo, y es deliberado:** esa URL es **producción**. Una sesión de desarrollo
> que use estas herramientas escribe en el tablero de verdad. Es lo que se
> quiere para trabajar, pero si lo que hace falta es probar la puerta contra
> una API local, entonces sí es el camino de abajo — y entonces el token local
> tiene sentido.

Lo sirve `apps/api` (`src/routes/mcp.ts`), con las herramientas de este mismo
paquete —la lista está en `src/registro.ts` y no se escribe dos veces— y hace
falta `MCP_REMOTE_ENABLED=true` en esa instancia. El flujo OAuth vive en
`apps/api/src/routes/oauth.ts`.

## Conectarlo en local, por stdio

Para desarrollar sobre las herramientas, o para apuntar a una API local. Hace
falta un token de conexión de agente: en DevUP, Ajustes → Conexiones de
agente → crear una. Son sesiones con etiqueta, listables y revocables desde
`/auth/sessions` como cualquier otra.

Con el token en la mano, en la configuración de Claude:

```json
{
  "mcpServers": {
    "devup": {
      "command": "npx",
      "args": ["-y", "tsx", "C:/Users/Juan/DevUP/apps/mcp/src/index.ts"],
      "env": { "DEVUP_TOKEN": "<el token>" }
    }
  }
}
```

`DEVUP_TOKEN` **siembra** el archivo de configuración la primera vez y después
se puede quitar. No lo pises en cada arranque pensando que es lo normal: el
token de refresco **rota** en cada renovación, así que el vivo es el que queda
guardado en `~/.devup/mcp.json`, no el de la variable. Si la variable trae un
token distinto del que sembró, se entiende que es una conexión nueva y se
adopta.

| Variable | Para qué |
|---|---|
| `DEVUP_TOKEN` | Siembra la conexión. Después manda el archivo. |
| `DEVUP_API_URL` | La API. Por defecto `https://api.hytrex.co`. Esta sí pisa siempre. |
| `DEVUP_CONFIG` | Otra ruta para el archivo. Para pruebas, y para no tocar el de verdad. |

## Desarrollo

```bash
npm run test:mcp                       # las pruebas de esta capa
npm run typecheck --workspace apps/mcp
```

Contra la API local, hablándole por stdio como lo haría Claude:

```bash
DEVUP_API_URL=http://localhost:4000 DEVUP_TOKEN=<token> npx tsx apps/mcp/src/index.ts
```

**Nada se imprime por stdout salvo el protocolo.** Un `console.log` de
depuración rompe la conexión sin decir por qué; lo que haya que contar va por
`console.error`.
