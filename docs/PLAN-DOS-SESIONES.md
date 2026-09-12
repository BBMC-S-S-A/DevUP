# Plan · el marco vivo y la memoria del trabajo

12 de septiembre de 2026. Sale de usar la aplicación con el riel ya puesto.

Está escrito para **partirse en dos sesiones que trabajen a la vez sin pisarse**.
El reparto está al final, y no es por temas: es por **archivos**, que es lo único
que evita de verdad un conflicto.

---

## 0. Lo que ya está arreglado, antes de planificar nada

**El riel empujaba la aplicación entera 220 px hacia abajo y se iba al
desplazar.** Era una regresión mía y era la trampa que el repositorio ya tenía
documentada: `globals.css` lleva `body > * { position: relative }` fuera de toda
capa CSS, y eso gana a la clase `fixed` de Tailwind. El riel es hijo directo de
`body` —los proveedores que lo envuelven no pintan DOM— y la barra lateral no,
por eso una se movía y la otra no.

**Un solo fallo explicaba tres síntomas** que parecían distintos: el riel
desapareciendo al bajar, el saludo del panel a media pantalla, y DevVerse
descolgado. La barra de llamada y la de música tenían el mismo fallo esperando.
Ya está en [#47](https://github.com/BBMC-S-S-A/DevUP/pull/47).

---

## 1. «Te espera» enseña cosas que ya hiciste

El panel lista **notificaciones sin leer**, no trabajo pendiente. Y una
notificación es un **hecho que ocurrió**, no una tarea: «te han asignado una
tarea» se queda ahí aunque la tarea esté hecha, porque lo que pasó pasó.

Ahora se puede arreglar de verdad, porque `is_terminal` existe desde la 0037:
**«Te espera» se construye de tus tareas en columnas no terminales**, y las
notificaciones vuelven a ser lo que son —la campana—. Una cosa por hacer
desaparece cuando la haces; un aviso desaparece cuando lo lees. No son lo mismo
y no deben compartir sitio.

---

## 2. El panel de una persona, al hacer clic

Lo que pides de Discord, traducido a lo que aquí significa algo:

- **Clic en alguien → su tarjeta.** Nombre, cargo, presencia, en qué espacios
  coincidís, y qué lleva ahora mismo. Eso último es lo que Discord no puede
  tener y aquí sí: **con quién hablar y qué está tocando**, que es la mitad de
  la pérdida de contexto de un equipo.
- **Desde ahí, las acciones**: mencionarle, asignarle algo, entrar a su canal de
  voz si está en uno.
- **Compartir pantalla.** La llamada ya es WebRTC en malla y cifrada extremo a
  extremo; añadir una pista de pantalla es `getDisplayMedia` más una pista más
  en la misma conexión. **Con una advertencia honesta:** en malla, cada quien
  manda su vídeo a todos los demás, así que compartir pantalla con seis personas
  son cinco subidas de vídeo desde un portátil. Hay que poner un tope de sala y
  decirlo, no descubrirlo en una reunión.

---

## 3. El «+» del riel: entrar con un código

Hoy el «+» lleva a la lista. Debería ser: **crear organización, crear espacio, o
entrar con un código.**

Lo de entrar con código es lo interesante y **casi está**: las invitaciones ya
existen con su token y su canje (`POST /invitations/accept`). Lo que falta es un
código corto y legible que se pueda dictar por teléfono, en vez de una URL de
cien caracteres. Es una columna más en `invitations` y un campo donde pegarlo.

---

## 4. La auditoría del tablero: quién hizo qué

Lo pides como una columna más del tablero; yo lo pondría **al lado y no dentro**,
porque una columna del tablero es un estado por el que pasa una tarea y esto es
otra cosa: es la lectura de lo que ya pasó.

**Y aquí está el problema de fondo: hoy no se puede contestar.** Una tarea
guarda su estado actual y nada más. No hay registro de que se movió, ni de
cuándo, ni de quién la movió. Se puede decir «Ana tiene cuatro tareas en Hecho»
—eso sí—, pero no «Ana cerró cuatro esta semana», que es la pregunta de verdad.

Así que esto son **dos pasos y en este orden**:

1. **El registro de actividad.** Una tabla de solo añadir: qué pasó, sobre qué,
   quién, cuándo, y con qué procedencia —persona, regla o agente—. Es la unión 2
   de [PROPUESTA-UNA-SOLA-PLATAFORMA.md](PROPUESTA-UNA-SOLA-PLATAFORMA.md), y
   sirve para mucho más que el tablero: es también lo que permite preguntarle al
   MCP «¿qué ha pasado aquí desde ayer?».
2. **La lectura.** Por persona: qué cerró, cuánto, en qué está ahora.

**Sobre el tiempo de trabajo, voy a frenar.** «Cuánto tiempo lleva alguien
trabajando» tiene dos lecturas y conviene no mezclarlas: *cuánto tardó una tarea
desde que se empezó hasta que se cerró* sale gratis del registro de actividad y
es útil. *Cuántas horas trabaja una persona* es control horario, se mide mal
siempre, y cambia lo que una herramienta significa para quien la usa. La primera
sí; la segunda no la haría sin hablarlo.

---

## 5. La vitrina de proyectos públicos

Ver cómo usan DevUP otros equipos, «sin que ligue nada».

**Esta es la que más cuidado pide, y quiero ser claro:** el producto entero se
apoya en que nada sale de su organización —46 de 46 tablas con aislamiento en el
motor—. Una vitrina es, por definición, contenido que **sí** sale. Hecha como
una excepción al aislamiento, sería la grieta por donde se cae lo único que hace
vendible esto.

La forma segura, y la única que yo construiría:

> **Una vitrina no enseña una organización: enseña una publicación.** Alguien
> elige qué publicar, se genera una **copia congelada** —un diagrama de
> arquitectura, un tablero de ejemplo, una captura—, y esa copia vive en su
> propia tabla, sin una sola clave hacia los datos vivos. Lo que se ve no es una
> ventana a la organización: es un objeto aparte que alguien decidió dejar ahí.

Eso da lo que quieres —ver cómo lo usan otros, sin filtrar nada— y no toca el
aislamiento, porque no hay nada que aislar: esa tabla es pública a propósito.

---

## 6. El reparto en dos sesiones

Por **archivos**, no por temas. Cada sesión es dueña de los suyos y no toca los
de la otra; así se puede empujar a la vez sin conflictos.

### Sesión A · El marco vivo

Lo que se ve y se toca. Frontal casi entero.

| Trabajo | Archivos que toca |
|---|---|
| «Te espera» con trabajo real, no avisos | `app/w/[workspaceId]/panel/**` |
| Tarjeta de persona al hacer clic | `components/perfil/**` (nueva), `components/voice/**` |
| Compartir pantalla, con su tope de sala | `lib/voice/**`, `components/voice/**` |
| El «+» del riel: crear o entrar con código | `components/ui/RielOrganizaciones.tsx`, `app/app/organizaciones/**` |
| Una superficie por nivel, y el acento reservado | `components/ui/Superficies.tsx`, `globals.css` |

### Sesión B · La memoria del trabajo

Lo que el producto sabe. Base de datos y API casi enteras.

| Trabajo | Archivos que toca |
|---|---|
| Registro de actividad: tabla, políticas y su caso de aislamiento | `db/migrations/00XX_*`, `apps/api/src/routes/actividad.ts` (nueva) |
| Escribir actividad al mover, cerrar y asignar | `apps/api/src/routes/tasks.ts` |
| Código corto de invitación | `db/migrations/00XX_*`, `apps/api/src/routes/account.ts` |
| La lectura por persona: qué cerró y cuánto tardó | `app/w/[workspaceId]/auditoria/**` |
| «¿Qué ha pasado aquí desde…?» en el MCP | `apps/mcp/src/herramientas/**` |

### Lo que comparten, y cómo no chocar

Tres archivos los necesitan las dos: `lib/api.ts` (tipos), `docs/PLAN-DE-DESARROLLO.md`
y `apps/api/src/db/isolation.test.ts`.

**La regla: se añade al final y no se reordena nada.** Un tipo nuevo al final del
archivo, un caso nuevo al final de su bloque. Git fusiona dos añadidos en sitios
distintos sin ayuda; lo que no fusiona es que las dos hayan movido lo mismo de
sitio.

Y el orden entre las dos: **la sesión B empieza por el registro de actividad**,
porque es lo que la A necesita para la tarjeta de persona («qué lleva ahora
mismo»). Hasta que exista, la A tiene trabajo de sobra que no depende de ello.

---

## 7. Lo que dejo fuera a propósito

- **Control horario.** Ver el §4. Cuánto tardó una tarea, sí; cuántas horas hace
  una persona, no sin hablarlo.
- **Copiar el panel de Discord.** Lo que vale de ahí es el gesto —clic y ves a
  la persona— no la disposición. Aquí el contenido es otro: en qué está
  trabajando, no en qué juego está.
- **Agrupar por trabajo y estudio en el riel.** Lo dijiste dudando, y creo que la
  duda es correcta: **eso ya lo hacen las organizaciones**. Un nivel más de
  agrupación sobre tres organizaciones es una carpeta con un elemento dentro.
  Cuando haya diez, se revisa.

---

## 8. En una frase

El marco ya está y ya no se rompe al desplazarse. Lo que falta para que esto se
sienta conectado no es más pantalla: es que **el producto recuerde lo que pasa**
—quién hizo qué y cuándo— porque de ahí salen a la vez la auditoría del tablero,
la tarjeta de una persona y el «qué me he perdido» que hace que trabajar en
grupo con IA no empiece de cero cada vez.
