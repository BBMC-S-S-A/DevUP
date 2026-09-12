# Reparto de tareas · tres categorías, tres responsables

12 de septiembre de 2026. Es lo que va al tablero de DevUP en cuanto la puerta
MCP tenga token — ver el final.

Las categorías son **etiquetas** del tablero, que es la pieza que ya existía:
`tags`, de la organización, con color. Desde este cambio se pueden crear desde
el propio tablero y **filtrar por ellas**, que es lo que faltaba para que
tuvieran sentido.

| Categoría | Responsable |
|---|---|
| **Workflow y flujos** | Juan Medina |
| **DevVerse** | Carlos Cáceres |
| **Profundización de funcionalidades** | Juan Bonilla |

**Regla de reparto, la que pediste:** todo lo que toque **base de datos,
migraciones o variables de entorno** va a Juan Bonilla, sea del área que sea.
Por eso su categoría es la más cargada: es donde vive el trabajo que no se puede
hacer desde la interfaz.

---

## Ya hecho — entra al tablero directamente en «Hecho»

No para dar por cerrado nada, sino porque un tablero que empieza vacío hace
pensar que no se ha hecho nada, y hay tres semanas de trabajo detrás.

**Workflow y flujos**

- El riel de organizaciones, que sobrevive a navegar
- `/app` deja de ser un menú de menús y te devuelve donde estabas
- El ancho se elige por la forma del contenido, no pantalla a pantalla
- Buscar en todas las organizaciones, desde ⌘K y desde el MCP
- «Te espera» enseña trabajo sin terminar, no avisos ya leídos
- Pulsar a alguien enseña quién es y en qué anda
- Categorías en el tablero, con filtro

**Profundización de funcionalidades**

- Que «hecha» exista: estado terminal en las columnas (migración 0037)
- El embudo y el panel pintaban el día anterior en Colombia
- Grabar una llamada dejó de ser invisible
- El perfil, que no existía: nombre y cargo
- Siete rutas sin llamantes, tres eran agujeros
- Las capturas de error mudas: de 42 a 5
- Las primeras pruebas de `apps/web`: 47 comprobaciones

**Y un fallo que no era de nadie más:** el riel empujaba la aplicación 220 px y
se iba al desplazar. Era la trampa de `body > *` documentada en el repositorio.

---

## Workflow y flujos · Juan Medina

Lo que se decide antes de construir, y lo que se ve.

1. **Decidir si DevUP se usa en móvil.** Gratis, y desbloquea o cancela una
   partida de semanas: `TaskBoard` y la mesa tienen **cero** puntos de ruptura.
   Un «no, es de escritorio» convierte eso en una decisión escrita en vez de
   deuda.
2. **Decidir la moneda.** Está escrita a mano en el código. El modelo la
   soporta a medias —`services.currency` existe, `opportunity_items` no la
   copia— y hay que elegir: **una sola moneda** (entonces es un ajuste de la
   organización) o **varias** (entonces las líneas la llevan y sumar deja de ser
   una suma).
3. **Una superficie por nivel, y el acento reservado.** Hoy hay tarjeta dentro
   de tarjeta dentro de panel: tres sombras contando la misma jerarquía tres
   veces, que es de donde viene el «se ve todo apilado».
4. **Qué se le enseña al cliente**, y qué no. La recomendación escrita está en
   `LA-SEMANA-ANTES-DEL-CLIENTE.md`.

---

## DevVerse · Carlos Cáceres

1. **Compartir pantalla en la llamada.** La llamada ya es WebRTC en malla y
   cifrada; es `getDisplayMedia` más una pista en la conexión que ya existe.
   **Con tope de sala y dicho por delante:** en malla cada quien manda su vídeo
   a todos, así que compartir pantalla con seis personas son cinco subidas desde
   un portátil.
2. **La sala del agente**, que ya está en marcha.
3. **DevVerse conectado al grafo.** Va después del registro de actividad, por
   definición: sin él no hay nada que conectar.
4. **Pulsar a alguien dentro de DevVerse** abre su ficha, la misma del panel.

---

## Profundización de funcionalidades · Juan Bonilla

Todo lo que toca base de datos, migraciones o variables de entorno.

### Primero, porque lo demás cuelga de ello

1. **El registro de actividad.** Tabla de solo añadir: qué pasó, sobre qué,
   quién, cuándo, y con qué procedencia —persona, regla o agente—. Con su
   política y su caso en `isolation.test.ts` en el mismo commit.
   **Es lo que hoy hace imposible la auditoría del tablero**: una tarea guarda
   su estado actual y nada más, así que se puede decir «Ana tiene cuatro en
   Hecho» pero no «Ana cerró cuatro esta semana».
2. **Escribir actividad** al mover, cerrar y asignar una tarea.

### Después

3. **La auditoría por persona**: qué cerró, cuánto tardó cada tarea desde que se
   empezó. *Cuántas horas trabaja alguien no entra: eso es control horario, se
   mide mal siempre, y no se hace sin hablarlo.*
4. **«¿Qué ha pasado aquí desde…?»** como herramienta del MCP. Es lo que
   convierte el registro en contexto compartido sin que ningún agente tenga que
   emitir nada.
5. **Código corto de invitación.** Las invitaciones ya existen con su token y su
   canje; falta un código que se pueda dictar por teléfono. Una columna más.
6. **La vitrina de proyectos públicos.** **No enseña una organización: enseña
   una publicación** — una copia congelada, en su propia tabla, sin una sola
   clave hacia los datos vivos. Hecha como excepción al aislamiento sería la
   grieta por donde se cae lo único que hace vendible esto.
7. **Alojar repositorios** (`apps/git`). Diseño completo en
   `DISENO-ALOJAR-REPOSITORIOS.md`. **Sin respaldo del volumen no se enciende
   para nadie:** es el primer sitio donde DevUP guarda algo que no se puede
   volver a generar.

### Infraestructura y entorno

8. **Respaldo del almacén de archivos**, que hoy no existe — el volcado
   automático es solo de la base.
9. **Rehacer el respaldo de la base**, que apunta a Supabase, de donde ya nos
   fuimos.
10. **Los dominios bonitos de Railway**, y reconstruir la web después:
    `NEXT_PUBLIC_*` se incrusta al compilar y cambiarlas en el panel no hace
    nada.
11. **`hytrex.co` apunta a un túnel que ya no existe** y da 530.

### Deuda que bloquea

12. **Partir `ventas`** (1.324 líneas). Pide pruebas de navegador: mover código
    sin red se hace a ciegas, y por eso lleva un mes sin moverse.
13. **Las cinco capturas mudas de `signaling.ts`**, que son de tiempo real y
    piden mirarse con el protocolo delante.

---

## Cómo se cargan

La puerta MCP no tiene token en esta máquina, así que el tablero no se ha tocado
todavía. Para abrirla, en DevUP: **Ajustes → Conexiones de agente → crear una**,
y pegar el token en `C:\Users\Alien corp\.devup\mcp.json`:

```json
{ "apiUrl": "https://api.hytrex.co", "refreshToken": "<el token>" }
```

**El token se pega en ese archivo, no aquí.** En cuanto exista, esto se carga de
una vez: las tres categorías, las tareas de cada una con su responsable, y las
ya terminadas directamente en la columna de hecho.

Todo lo que entre por ahí quedará además con la etiqueta **«agente»**, que la
puerta pone sola y no se puede desactivar — para que se vea de un vistazo qué
salió de un modelo y se pueda revisar o deshacer en bloque.
