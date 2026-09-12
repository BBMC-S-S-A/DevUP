# El área «Workflow», partida en dos caminos

12 de septiembre de 2026. Dos sesiones trabajando a la vez sobre la misma área
del tablero: **camino A** desde un equipo y **camino B** desde otro. Esto dice
qué es de cada uno y, sobre todo, **qué archivos no puede tocar el otro**.

---

## 0. Por qué esto no está en el tablero todavía

**No es que falte un token. Es que no hay red.** Las sesiones de Claude Code que
escribieron este plan corren en un contenedor en la nube, no en el portátil, y
la política de salida de ese contenedor **deniega** `api.hytrex.co` y el
despliegue de Railway — comprobado: el gateway contesta `403` al CONNECT. La
puerta MCP no puede alcanzar DevUP desde ahí, con token o sin él.

Durante varios días esto se anotó aquí como «falta el token», que era la
explicación cómoda y la equivocada: con el token puesto habría fallado igual, y
el siguiente en intentarlo habría perdido la tarde buscando una credencial que
ya estaba bien.

**Lo que sí funciona**, y las dos son cosas que solo se pueden hacer fuera de
esta sesión:

1. **Ejecutar la siembra desde el portátil**, que es donde hay red:

   ```
   DEVUP_TOKEN=<el de Ajustes → Conexiones de agente> npm run sembrar:caminos -- --ver
   ```

   Con `--ver` no escribe nada y dice qué haría; sin `--ver`, lo hace. Es
   repetible: lo que ya existe no se duplica. El guion
   (`scripts/sembrar-caminos.ts`) usa las mismas funciones que el MCP
   —`crear_area`, `crear_tarea`, `enlazar_rama`— así que siembra exactamente lo
   mismo que sembraría el agente.

2. **O abrir la salida** a `api.hytrex.co` en la configuración del entorno
   remoto, y entonces el MCP conecta solo desde aquí.

Hasta que se haga una de las dos, **este documento es el tablero**: es lo que
evita que las dos sesiones se pisen, y eso no puede esperar.

---

## 1. Por qué dos caminos y no dos tareas

Porque es la misma área y el mismo plan. Partirlo en dos áreas significaría
que «Workflow» deja de leerse de un vistazo, que es justo para lo que sirve un
área. Un plan que se desarrolla por dos vías a la vez tiene **dos ramas**, y
eso es exactamente lo que la 0042 añadió a la tarjeta: una tarea puede llevar
varias, cada una con su estado.

Así que:

| | La lleva | La rama que se apunta en cada tarea |
|---|---|---|
| **Camino A** | el otro equipo | `camino-a` |
| **Camino B** | esta sesión | `camino-b` |

Una tarea del camino B se archiva en el área **Workflow** y se le enlaza la
rama `camino-b`. Desde el tablero, «¿quién está en qué?» se contesta sin
preguntar: la rama sale en la propia tarjeta.

---

## 2. El reparto, y la regla que lo hace funcionar

**LA REGLA: ningún archivo pertenece a los dos caminos.** No es una
recomendación de estilo — es lo único que evita que dos sesiones que no se ven
entre sí produzcan un conflicto de fusión en cada tanda. El reparto de abajo
está hecho **por archivos**, no por temas, y por eso las tareas caen donde
caen aunque temáticamente se parezcan.

### Camino A · el armazón y la navegación

Todo lo que envuelve a una pantalla.

| Tarea | Qué es |
|---|---|
| **Decidir qué pantalla es la portada** | Va ANTES de construir el armazón. Con el registro de actividad ya hecho, la línea de tiempo tiene más papeletas que un panel de tarjetas. Es una decisión, no código. |
| **El armazón de organización, naciendo con cajón para móvil** | Seis pantallas viven hoy sin barra. Construirlo con barra fija y desmontarlo después es justo lo que hay que evitar. |
| **Marco de página: una cabecera, no cinco copiadas** | Y con él los tres finales de una carga: cargando, fallo, vacío. |

**Archivos del camino A** (nadie más los toca):

- `apps/web/src/app/**/layout.tsx` — los seis
- `apps/web/src/components/ui/Armazon.tsx`
- `apps/web/src/components/ui/Pagina.tsx`
- `apps/web/src/components/ui/ItemNav.tsx`
- `apps/web/src/components/ui/NavegacionOrganizacion.tsx`
- `apps/web/src/components/ui/RielOrganizaciones.tsx`
- `apps/web/src/components/ui/PaletaComandos.tsx`

### Camino B · los datos y las piezas

Todo lo que va dentro de una pantalla.

| Tarea | Qué es |
|---|---|
| **Las primitivas que faltan, empezando por el diálogo de confirmación** | Ocho acciones irreversibles se deciden hoy en el cuadro gris del sistema operativo. Es lo que mejor relación esfuerzo/resultado tiene de todo el plan. |
| **Capa de datos: acabar con los `api.*` y los efectos sueltos** | **En marcha.** Ver §2ter. |
| **Partir las pantallas grandes** | Ventas tiene 1.273 líneas. Después de la capa de datos, no antes. |

**Archivos del camino B** (nadie más los toca):

- `apps/web/src/lib/datos.tsx` y `apps/web/src/lib/api.ts`
- `apps/web/src/components/ui/Confirmar.tsx`
- `apps/web/src/components/ui/Field.tsx`, `Boton.tsx`, `Superficies.tsx`
- `apps/web/src/components/dashboard/**`
- Los **cuerpos** de las pantallas: `apps/web/src/app/**/page.tsx`

### La frontera que hay que mirar dos veces

`page.tsx` es del camino B y `layout.tsx` del A, y están en las mismas
carpetas. Es la única línea del reparto que se puede cruzar por descuido, así
que va dicha aquí: **el camino A no abre un `page.tsx` y el camino B no abre un
`layout.tsx`**, aunque lo que quieran arreglar esté a tres líneas.

Si una tarea de verdad necesita tocar el otro lado, no se toca: se apunta en la
tarjeta y se espera. Una tanda bloqueada cuesta una hora; un conflicto de
fusión en seis archivos cuesta la tarde de los dos.

---

## 2bis. Lo que ya estaba hecho y se retira de la lista

Comprobado contra `mainline` antes de empezar, que es de lo que va este
documento. Tres cosas de la lista original **ya están fusionadas**:

- **«Te espera» con trabajo real** — hecho en `2f04d83`. Listaba notificaciones
  sin leer, y un aviso no es una tarea: «te han asignado X» se queda ahí aunque
  X esté cerrada, porque lo que pasó pasó.
- **El «+» del riel para entrar con un enlace** — hecho en `9385634`.
- **El riel marcando dónde estás** — hecho en `381e133`.

Y una que **casi choca**: `006c33e` añadió una barra encima del tablero para
filtrar por **etiquetas**, y la llamó «categorías». Al mismo tiempo, la 0039
añadió las **áreas**, que son otra cosa —una sola por tarea, con dueño— y
también se filtran desde el tablero. Fusionarlo tal cual habría dejado dos
barras apiladas y dos ejes llamados igual.

Resuelto en la fusión: **una sola barra con los dos grupos**, el de áreas
rotulado «Área» y el de etiquetas rotulado «Etiquetas» —ya no «Categorías»—. Y
se cruzan con «y»: entre etiquetas se suma, entre el área y las etiquetas se
multiplica. Sumarlo todo haría que elegir un área **ensanchara** el tablero,
que es lo contrario de lo que hace un filtro.

---

## 2ter. La capa de datos: por dónde va

Las primitivas ya estaban (`useRecurso`, `useMutacion`, `invalidar`, `sembrar`
en `lib/datos.tsx`); lo que falta es **migrar**, pantalla por pantalla. Y el
diálogo de confirmación de la lista original resultó estar **terminado**: cero
`confirm`, `alert` o `prompt` del sistema en toda la web y catorce sitios
usando `useConfirmar`.

| | api.* sueltos | efectos | por la capa |
|---|---|---|---|
| Al empezar | 125 | 117 | 46 |
| Ahora | 121 | 113 | 57 |

Hecho:

- **El tablero** (`TaskBoard.tsx`), que era el peor caso con 16 llamadas
  sueltas. Lo optimista del arrastre se queda, pero **encima** de la caché y con
  una regla que lo hace seguro: lo optimista nunca sobrevive a un dato fresco.
- **Ajustes de organización**, con sus cuatro lecturas a mano. Cero efectos.

Lo que queda por orden de tamaño: `ventas/page.tsx`, `cuenta/page.tsx`,
`github/page.tsx`, `organizaciones/page.tsx`, y después los componentes
(`FileLibrary`, `ChannelChat`, Spotify).

**LA TRAMPA QUE APARECIÓ MIGRANDO, y que vale para las que quedan:** al pasar de
estado local a caché hay que **invalidar aunque la escritura salga bien**. Antes
el estado moría con la pantalla y pintar a mano bastaba; ahora lo pintado vive
encima de algo guardado, y sin marcarlo viejo, volver a la pantalla dentro de la
ventana de frescura enseña lo de antes. No falla nada: simplemente miente.

---

## 3. Lo que hace cada sesión al terminar una tarea

Con la 0042 ya desplegada, el gesto es uno y deja constancia:

1. `enlazar_rama` con `camino-b` (o `camino-a`) — si no estaba ya.
2. `marcar_hecha` con la prueba: el PR que la cierra, o una nota de qué se
   comprobó.

Eso es lo que permite que la otra sesión pregunte `que_ha_pasado` y se entere
de lo que hizo la primera sin que nadie tenga que contárselo.

---

## 4. Qué siembra el guion

El área **Workflow** y seis tareas —cuatro del camino A, dos del camino B—, cada
una con su tipo, su prioridad, su contexto, su criterio de terminada y su rama
(`camino-a` o `camino-b`) ya enlazada. Las listas viven en
`scripts/sembrar-caminos.ts` y son las mismas del §2.

Se escriben ahí y no se leen de este markdown a propósito: analizar una tabla
para sacar tareas es un analizador más que mantener, y la primera vez que
alguien reordenara una columna, el guion sembraría basura sin fallar. Cuando
este documento cambie, esa lista sale en el mismo `git diff`.

**Las del camino A también las crea quien tenga el token primero.** Un tablero
donde solo está la mitad del plan es peor que uno vacío, porque parece completo.

---

## 5. Lo único que el camino B necesita del camino A

**Una entrada de menú, y nada más.** La portada global vive en
`/app/inicio` —página, API y todo— pero el menú lateral es del camino A y
ahora mismo lo estás reescribiendo: meter mano ahí sería el conflicto más caro
que hay en el reparto. Así que queda pedido en vez de hecho.

Donde están hoy «Panel», «Mesa», «Archivos»…, encima de todos ellos —porque no
es de este espacio, es de todos—:

```tsx
<li>
  <ItemNav
    href="/app/inicio"
    icono={<Home size={15} />}
    activo={pathname === "/app/inicio"}
    indice={0}
  >
    Inicio
  </ItemNav>
</li>
```

(y `Home` de `lucide-react`; los `indice` de abajo suben uno.)

**VA ENCIMA Y NO DEBAJO, y es lo único que pido que no se cambie.** Todo lo
demás de esa lista es de un espacio de trabajo concreto. Inicio no: es lo que
contesta «¿qué tengo, en todos?». Ponerlo entre los de un espacio lo convierte
en una pantalla más de ese espacio, que es justo lo que no es.
