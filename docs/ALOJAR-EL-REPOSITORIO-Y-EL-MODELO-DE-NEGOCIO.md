# Alojar el repositorio, y hacia dónde va el modelo de negocio

11 de septiembre de 2026.

Responde a dos cosas dichas juntas y que conviene separar, porque una es un
diagnóstico y la otra es una decisión de empresa:

1. **La conexión con GitHub es mediocre.** Lo es. Aquí van los números.
2. **Que la plataforma aloje el repositorio y orqueste arquitectura, base de
   datos y despliegue — lo que hacen Railway y Vercel.** Aquí es donde hay que
   hilar fino, porque dentro de esa frase hay dos negocios distintos.

---

## 1. El conector es un lector. Ni más ni menos

Contado contra `connectors/github.ts`, que entero tiene **tres funciones
públicas**:

| Función | Qué hace |
|---|---|
| `fetchGithubStats` | estrellas, ramas, último workflow |
| `fetchGithubTree` | la lista de rutas |
| `fetchGithubFileContent` | el contenido de **un** archivo |

Eso es todo. De ahí salen las cuatro pantallas que se venden.

### Lo que no puede hacer, y no es por falta de acabado

- **No escribe nada.** Ni una rama, ni un commit, ni un PR, ni un issue. La
  única petición de escritura en todo `connectors/` es a Spotify, para pedir un
  token.
- **No hay webhooks. Ni uno.** Todo es sondeo: los datos se piden cuando alguien
  abre la pantalla. No existe «ha pasado algo en tu repositorio»; existe «has
  mirado». Un grafo que se teje con reglas —commit a tarea, despliegue a
  commit— **no puede alimentarse de eso**: necesita el evento, no la visita.
- **No clona.** Sin clon no hay historia, ni diffs, ni quién tocó qué. Todo lo
  que se puede decir de un repositorio se dice leyendo archivos sueltos de la
  punta de la rama.
- **Lee una muestra, no el proyecto.** El cupo de GitHub obliga: 40 migraciones
  con token y **12 sin él**, 20 archivos para el diagnóstico de integraciones.
  La «auditoría» audita una veintena de archivos.
- **El cupo sin token es por IP, y la IP es la de DevUP.** Lo dice el propio
  código: una sola visita desde un repositorio sin token puede dejar sin
  lecturas a **las demás organizaciones** durante una hora. Ese es un límite que
  no escala con clientes.
- **Y depende de un permiso de otra empresa.** Si la organización del cliente
  bloquea los tokens de alcance fino, no hay arreglo nuestro posible. Eso ya
  estuvo a punto de tumbar la demo.

**Conclusión: no es que el conector esté a medio hacer. Es que el techo está
donde está.** Pulirlo da un lector mejor. Sigue siendo un lector.

---

## 2. Alojar el repositorio arregla las seis cosas de golpe

Y esto es lo que hace que tu idea no sea un desvío, sino el camino corto.

Si el repositorio vive en DevUP:

| Hoy, con GitHub | Con el repositorio dentro |
|---|---|
| 12–40 archivos por análisis | **El proyecto entero** |
| Cupo compartido por IP entre clientes | **No hay cupo** |
| Sondeo al abrir la pantalla | **El push *es* el evento** |
| Sin historia ni diffs | **Historia completa** |
| Solo lectura | **Escribir es trivial: es tuyo** |
| Depende del administrador del cliente | **No depende de nadie** |

Dicho de otra forma: **la auditoría y el grafo no están esperando a que
escribamos más código. Están esperando a tener el repositorio delante.** La
auditoría dejaría de ser una muestra de veinte archivos y pasaría a correr en
cada push, sobre todo el proyecto. Eso sí es un producto.

### Y es la parte barata

Alojar git es almacenamiento más HTTP. Ya hay Postgres y ya hay almacén
compatible con S3. **No aparece ninguna clase de riesgo nueva: se guardan bytes,
no se ejecuta nada.** Es trabajo de verdad —semanas, no días— pero es acotado y
conocido.

---

## 3. Donde sí voy a frenar: «lo que hace Railway» es otro negocio

Dentro de la misma frase hay dos cosas que se parecen y no lo son:

| | Qué es | Qué cuesta de verdad |
|---|---|---|
| **Alojar el repositorio** | Guardar y servir git | Almacenamiento. Riesgo: ninguno nuevo |
| **Construir y ejecutar el código del cliente** | Compilar, contenedores, dominios, TLS, registros, secretos, escalado | **Máquinas. Y ejecutar código ajeno** |

Sobre la segunda, tres hechos incómodos y comprobados:

**a) DevUP hoy no ejecuta código de nadie.** Ni una llamada a `spawn`, `exec` ni
a un motor de contenedores en toda la API. El entorno de desarrollo embebido
corre **dentro del navegador de quien lo abre** — no en nuestro servidor. No hay
nada sobre lo que construir esto: se empieza de cero.

**b) El aislamiento actual no sirve para esto, ni un poco.** Lo mejor que tiene
el producto —46 de 46 tablas con RLS— protege *filas de una base de datos*.
Ejecutar el código de un cliente es otra categoría de problema: necesita
aislamiento de núcleo, microVMs o equivalente. Nuestro modelo de seguridad no
cubre nada de eso, y no se extiende: se sustituye.

**c) Le da la vuelta al modelo económico, que hoy es la mejor idea del
proyecto.** Está escrito en el plan de producción: *«Nada de servicios de pago.
Todo lo que corre hoy está en capas gratuitas»*. Y la puerta MCP es brillante
justo por lo mismo: el equipo trae su propia suscripción, y la inteligencia
cuesta cero. Un cliente que hoy no cuesta nada **pasaría a costar dinero cada
mes sin haber pagado todavía**. Eso no es una función más: es cambiar de empresa.

**No digo que no. Digo que eso es Railway, y competir con Railway se decide a
propósito, con dinero delante, no como continuación natural de una pantalla.**

---

## 4. Lo que yo sí construiría, y creo que es mejor negocio

**DevUP como el sitio donde vive el proyecto y desde donde se gobierna todo —
sin ser quien corre las máquinas.**

Aloja el repositorio. Aloja el grafo. Y **orquesta** Railway, Vercel, Neon o lo
que use el cliente, a través de sus APIs y con la cuenta del cliente.

Por qué creo que es mejor y no solo más barato:

- **Ese hueco no lo ocupa nadie.** Railway sabe desplegar y no sabe nada de tu
  arquitectura. GitHub guarda el código y no sabe qué despliegue salió de qué
  commit ni qué migración lo acompañaba. **Hoy, en el esquema, un despliegue no
  sabe de qué commit salió** — no hay ni una clave que los una. Esa frase es el
  hallazgo más elocuente de todo el estudio de arquitectura, y describe
  exactamente el hueco del mercado.
- **Mantiene el coste marginal en cero**, que es lo que permite tener clientes
  antes de tener ingresos.
- **No abre la superficie de ejecutar código ajeno.**
- **Y deja la puerta abierta.** Si algún día conviene correr las máquinas, se
  hace teniendo ya el plano de control. Al revés —empezar de PaaS e intentar
  añadir el grafo después— es mucho más difícil, y además ahí compites con
  empresas con años de ventaja en lo único que harías.

La frase que lo resume, y que sí es vendible: **«tu arquitectura, tu
repositorio, tu base de datos y tu despliegue son el mismo objeto, y se gobiernan
desde el mismo sitio».** Ni GitHub ni Railway pueden decir eso.

---

## 5. El orden

| | Qué | Cuándo |
|---|---|---|
| **0** | La semana del cliente, con GitHub tal como está | Ahora. Nada de esto entra |
| **1** | **Alojar el repositorio**: git por HTTP, sobre el almacén que ya hay | Después. Semanas. Es el desbloqueo |
| **2** | **El push como evento**, que es lo que el grafo necesita para tejerse solo | Va pegado al 1: es la razón del 1 |
| **3** | **Auditoría sobre el proyecto entero**, en cada push, sin cupos | Cae casi sola con 1 y 2 |
| **4** | **Orquestar** Railway, Vercel y compañía con la cuenta del cliente | Después. Es el producto |
| **5** | Escribir hacia fuera como PR | Encaja aquí, y ya no hace falta para lo de dentro |
| — | **Construir y ejecutar el código del cliente** | Decisión de empresa, con dinero delante. No se planifica todavía |

**Nada de esto entra en la semana del cliente**, y meterlo la pondría en riesgo.
Para esa semana, GitHub tal como está es suficiente: lo que se enseña es el
diagnóstico, y para diagnosticar veinte archivos bastan.

---

## 6. En una frase

Tienes razón en las dos: el conector es un lector con techo, y alojar el
repositorio es lo que de verdad desbloquea la auditoría y el grafo — además de
ser la parte barata y sin riesgo nuevo. Donde matizaría es en «lo que hace
Railway»: **alojar el repositorio y ejecutar el código del cliente parecen el
mismo paso y son dos empresas distintas**, y la segunda destruye lo que hoy
hace viable a la primera. El sitio donde yo pondría a DevUP es el que nadie
ocupa: **dueño del repositorio y del grafo, y director de orquesta del resto.**
