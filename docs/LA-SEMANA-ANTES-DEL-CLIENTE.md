# La semana antes del cliente

Plan para siete días, con un cliente que espera ver **Infraestructura, Base de
datos, Integraciones y Entorno de desarrollo funcionando con sus propios
datos**.

Escrito el 11 de septiembre de 2026. Complementa
[ESTUDIO-ARQUITECTURA-2026-09-11.md](ESTUDIO-ARQUITECTURA-2026-09-11.md), que
explica por qué esas cuatro pantallas dependen todas de lo mismo.

---

## Lo primero, porque cambia todo lo demás

**Las cuatro pantallas con datos reales del cliente, en una semana, no caben.**
Tres pueden llegar; la cuarta no puede, ni con más tiempo, en su forma actual.
El resto de este documento es qué sí cabe y en qué orden.

Y hay algo que hay que hacer **hoy, antes de escribir una línea de código**,
porque puede invalidar el plan entero:

> ### Preguntar al cliente si su organización de GitHub permite tokens de alcance fino
>
> Si su organización los bloquea —o exige que un administrador los apruebe uno
> a uno—, **ningún cambio en nuestro código lo arregla**. Lo tiene que aprobar
> su administrador, y eso es una gestión con tiempos que no controlamos.
>
> Es un correo. Si la respuesta llega el día 5 y es «no», la demo se cae con
> cinco días gastados. Si llega hoy, hay margen para cambiar lo que se enseña.

Esto no es precaución teórica: está documentado en el propio repositorio como
trampa conocida —«un 404 al añadir un repo casi siempre es que el token no lo
tiene autorizado, o que la organización bloquea esos tokens»— y encaja
exactamente con el fallo que se vio al usarlo.

---

## Por qué las cuatro pantallas son en realidad una

Verificado en el código: las cuatro leen del mismo sitio.

| Pantalla | De dónde saca sus datos |
|---|---|
| GitHub | `/organizations/:orgId/github/repos` |
| Base de datos | esos repos → `/github/repos/:id/migraciones` |
| Integraciones | esos repos → `/github/repos/:id/integraciones` |
| Infraestructura | filtra conexiones por `provider === "github"` |

No están rotas cada una por su lado: **están las cuatro detrás de la misma
puerta cerrada**. Eso es una buena noticia para una semana — hay un solo
arreglo que las enciende — y una mala: si esa puerta no abre, no abre ninguna.

### Y el fallo probablemente no es nuestro, es el mensaje

En `connectors/github.ts`, cuando GitHub rechaza una petición:

```
throw new Error(`GitHub respondió ${response.status} para ${url}`);
```

Eso es todo lo que ve quien conecta: «GitHub respondió 404 para
`https://api.github.com/repos/...`». Un 404 de GitHub en este caso casi nunca
significa «no existe»: significa **«existe y tu token no lo puede ver»**, que
es una cosa completamente distinta y con solución conocida.

Hay además un segundo problema, en `routes/github.ts`: el repositorio se
**inserta en la base antes** de comprobar que se puede leer. Si el refresco
falla, queda una fila de un repositorio que no funciona, y la pantalla arranca
con un repo roto dentro.

---

## Los siete días

### Día 0 — hoy, sin código

- El correo al cliente sobre los tokens de su organización.
- Pedirle **un repositorio de prueba** al que podamos acceder ya, para no
  descubrir el día 4 que no teníamos con qué probar.

### Días 1 y 2 — la puerta

Todo el esfuerzo en el conector, porque es el único camino a las otras tres.

1. **Explicar los fallos de GitHub en vez de reenviarlos.** Los tres casos
   reales, cada uno con qué hacer: token sin ese repositorio autorizado,
   organización que bloquea tokens de alcance fino, y repositorio que de
   verdad no existe.
2. **Comprobar el acceso antes de insertar**, para que un fallo no deje un
   repositorio roto en la lista.
3. **El camino sin token, para lo público.** Pegar el enlace e intentar leerlo
   sin credencial: si el repositorio es público, funciona y el token no hace
   falta. **Ojo con la expectativa**: si el repositorio del cliente es privado
   —lo más probable— el token sigue siendo obligatorio. Esto no elimina el
   token, elimina el token *cuando no hacía falta*.

### Días 3 y 4 — las dos que se encienden solas

Con la puerta abierta, estas dos ya leen del repositorio del cliente:

- **Base de datos.** Es la que está más cerca de funcionar: hoy ya lista
  migraciones de un repositorio. Con GitHub resuelto, hay buenas opciones de
  que funcione con datos del cliente sin escribir casi nada.
- **Integraciones, la mitad que diagnostica.** Lee su repositorio y dice qué se
  está resolviendo a mano. **La otra mitad —montar la integración— no existe y
  no va a existir esta semana**: necesita credenciales de los proveedores. Hay
  que decirlo en la pantalla, no dejar que se descubra en la demo.

### Día 5 — la honestidad, y un día que sobra

> **Corregido el 11 de septiembre.** Aquí decía que Infraestructura era la más
> arriesgada porque «no llena nadie» las tablas de entornos y despliegues. Es
> falso: `routes/infraestructura.ts` inserta el entorno, lo sincroniza en la
> misma petición, lee los despliegues del proveedor y los guarda con
> `upsert_deployment`. Infraestructura está tan lista como Base de datos y se
> enciende con el mismo token. Ver el §0 de
> [AUDITORIA-DE-LA-APLICACION.md](AUDITORIA-DE-LA-APLICACION.md).
>
> **Este día queda libre.** Dedíquese a adelantar el día 6 o el ensayo del 7,
> que es el que más fallos ha encontrado históricamente.

- **Estados vacíos honestos en todo lo que no llegue.** Una pantalla que dice
  «para ver tus entornos, conecta un repositorio con despliegues» no es una
  pantalla rota: es una pantalla sin configurar. En una demo, la diferencia
  entre esas dos cosas es toda la diferencia.

### Día 6 — el tablero, que son horas

Hacer visible lo que ya está construido y nadie encuentra: cursor de arrastre,
agarradera, y el responsable clicable en la tarjeta. Son horas, recupera dos
funciones ya pagadas, y **quita fricción diaria a vosotros mismos**, que lo
estáis usando para trabajar.

### Día 7 — ensayar la demo entera, en otra máquina

Con una cuenta nueva y el repositorio del cliente. La mitad de los fallos de
este producto han aparecido probando de punta a punta y no leyendo código —
está escrito en sus propias trampas conocidas.

---

## Lo que no entra, y hay que sacarlo de lo prometido

### El entorno de desarrollo con datos del cliente

**Este no es un problema de plazo.** El entorno embebido corre sobre
WebContainer, que **solo ejecuta Node dentro del navegador**. Si el proyecto
del cliente no es Node, no puede funcionar: ni esta semana, ni con un mes, ni
con más gente. Y si lo fuera, sigue sin arrancar en la VPS y sigue cambiando de
pestaña al entrar.

La recomendación es **sacarlo de lo que se le enseña al cliente** y decirlo
antes de la demo, no durante. Enseñar las otras tres funcionando es una
posición mucho más fuerte que enseñar cuatro y que una falle en directo.

Si aun así tiene que aparecer: enséñese con un proyecto Node nuestro,
presentado como lo que es —un entorno de pruebas dentro del navegador—, nunca
con el código del cliente.

### Lo demás que se queda fuera esta semana

- **El grafo (nodos y enlaces).** No se empieza. Empezarlo y no terminarlo deja
  el producto peor que ahora, y su aislamiento no está resuelto todavía — ver
  el §2.2 del estudio de arquitectura.
- **DevVerse conectado al grafo.** Va después del grafo, por definición.
- **Perfil de usuario, presencia y notificaciones, jerarquía de la barra.** Son
  el bloque 0 del estudio y siguen siendo correctos; simplemente no compiten
  con una fecha de cliente.

---

## Lo que yo renegociaría, y no es la fecha

La fecha probablemente no se mueve. Lo que sí se puede mover es **qué se
enseña**, y ahí hay una conversación que vale la pena tener antes:

- **Quitar el entorno de desarrollo** de la demo. Es el único que no puede ser
  honesto.
- **Presentar Integraciones como diagnóstico**, que es lo que es y ya tiene
  valor: decirle a alguien qué está resolviendo a mano en su propio
  repositorio, con el archivo y la línea delante, es una demo buena. Prometer
  que además lo monta es prometer lo que no hay.
- **Si el cliente bloquea los tokens**, cambiar la demo a un repositorio
  nuestro y enseñar la mecánica, no sus datos. Menos impresionante y mucho
  mejor que una pantalla en blanco.

---

## El riesgo, en una línea

Todo depende de un token de GitHub que quizá tenga que aprobar el
administrador de otra empresa. **Ese correo sale hoy.**
