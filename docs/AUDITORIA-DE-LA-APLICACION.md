# Auditoría de la aplicación · 11 de septiembre de 2026

Qué hay construido, qué está mal hecho, y qué le falta para ser viable.
Todo lo de aquí está **contado contra el código**, no contra la documentación.

Cada hallazgo lleva marcado si entra o no en la semana del cliente
([LA-SEMANA-ANTES-DEL-CLIENTE.md](LA-SEMANA-ANTES-DEL-CLIENTE.md)), para que
este documento no compita con aquel plan sino que lo alimente.

---

## 0. La corrección más importante: Infraestructura no está vacía

**Esto contradice lo que yo mismo escribí en el plan de la semana, y hay que
corregirlo antes que nada.**

Dije que las tablas de entornos y despliegues «no las llena nadie». Es falso.
En `routes/infraestructura.ts` está todo el camino escrito:

- `POST /organizations/:orgId/environments` inserta el entorno **y sincroniza
  en la misma petición**.
- `sincronizarEntorno()` pide los despliegues al proveedor con el token de la
  conexión, los filtra por entorno (`producción` no enseña los de `staging`) y
  los guarda con `upsert_deployment`.
- Cuando falla, **anota el fallo en la propia fila del entorno** en vez de
  tirar la petición, con un comentario que explica exactamente por qué.
- `deployments` no tiene política de INSERT ni UPDATE a propósito: solo la
  función `SECURITY DEFINER` la escribe, y hay un caso en `isolation.test.ts`
  que comprueba que un INSERT directo no cuela aunque el entorno sea tuyo.

Eso no es una pantalla sin terminar. Es una de las piezas **mejor construidas
del repositorio**. Lo que la deja vacía es lo mismo que deja vacías a las otras
tres: el token de GitHub.

> **Consecuencia para la semana:** el día 5 no es «trabajo real que puede no
> entrar». Infraestructura sube al grupo de las que se encienden solas cuando
> abra la puerta. El día 5 queda libre.

---

## 1. Lo que hay, y está bien hecho

### El aislamiento entre clientes es la mejor parte del producto

Recontado tabla por tabla:

| Comprobación | Resultado |
|---|---|
| Tablas con RLS activado | **46 de 46** |
| Tablas con al menos una política | **45 de 46** |
| Funciones `SECURITY DEFINER` | **44** |
| …de ellas con `search_path` fijo | **44. Ninguna sin él** |

La única tabla sin política es `user_tokens`, y está **confirmada muerta**:
cero referencias en todo el código. Sin política significa cero filas, así que
ni siquiera es un agujero — es una tabla que no existe para nadie.

Esto importa más de lo que parece: es lo único que permite vender a varias
empresas sobre la misma base. Y no descansa en que alguien se acuerde de
escribir `where organization_id`: descansa en el motor.

### El CI protege lo que de verdad duele

`ci.yml` levanta un Postgres 17 real —la misma versión mayor que producción— y
corre aislamiento, sala del mundo, criterio de migraciones, diagnóstico de
integraciones, y **las migraciones dos veces** para cazar la migración editada
después de aplicarse. Es un CI pensado por alguien que ya se quemó.

### La superficie es real, no una maqueta

18 módulos de API con rutas de verdad: workspaces (21), ventas (15), archivos
(10), cuenta (10), autenticación (9), mundo (8), tareas (8), GitHub (8),
mensajes (6)… Más 27 migraciones y 46 tablas de dominio. Y funciones que el uso
real dio por ausentes **están construidas y desplegadas** — asignar y arrastrar
en el tablero son el caso claro.

---

## 2. Lo que está mal hecho

### 2.1 · La capa de datos se abandonó a medio camino · *fuera de la semana*

Se construyeron `useRecurso` y `useMutacion` para no repetir carga, error y
recarga en cada pantalla. Hoy:

| | Cuenta |
|---|---|
| Archivos que usan `useRecurso`/`useMutacion` | **8** |
| Llamadas crudas a `api.*` en `.tsx` | **95** |
| `useEffect` en la web | **98** |

Y **95 es peor que las 88 de agosto**: no es deuda parada, es deuda creciendo.
Cada llamada cruda es una pantalla que decide por su cuenta qué hacer al
cargar, al fallar y al volver — que es exactamente por qué la experiencia se
siente distinta en cada sitio.

**No se arregla esta semana.** Lo que sí cabe es una regla: **ninguna pantalla
nueva con `api.*` crudo**. Si la deuda deja de crecer, se puede pagar después.

### 2.2 · 44 capturas de error en silencio · *parcial, dentro de la semana*

44 `catch {}` o `.catch(() => {})` entre la API y la web. Cada uno es un fallo
que ocurre y que nadie ve — ni el usuario, ni los registros, ni vosotros.

Esto es lo que hace que un producto se sienta «raro» sin que nadie sepa
señalar dónde: las cosas no fallan, simplemente no pasan.

**En la semana solo interesan los del camino de GitHub**, que son los que van a
aparecer en la demo. El resto es una pasada aparte.

### 2.3 · El responsive casi no existe en las pantallas grandes · *fuera*

Puntos de ruptura contados por archivo:

| Pantalla | Líneas | Breakpoints |
|---|---|---|
| `ventas/page.tsx` | 1.324 | 2 |
| `TaskBoard.tsx` | 735 | **0** |
| `github/page.tsx` | 665 | 2 |
| `Mesa.tsx` | 279 | **0** |

67 en toda la aplicación. El tablero y la mesa, que son de las pantallas que
más se tocan, **no reaccionan al ancho en absoluto**.

Antes de arreglarlo hay una pregunta de producto que no está contestada: ¿DevUP
se usa en móvil, sí o no? Si la respuesta es «no, es una herramienta de
escritorio», esto deja de ser deuda y pasa a ser una decisión — y hay que
escribirla. Si es «sí», es semanas de trabajo. **Contestarla es gratis y
desbloquea o cancela una partida grande.**

### 2.4 · `ventas` sigue creciendo mientras está marcada para partir · *fuera*

1.273 líneas en agosto, **1.324 hoy**. Lleva un mes marcada para dividirse en
cabecera, embudo, clientes y cotizaciones, y en ese mes ganó 51 líneas. Es el
archivo más grande de la aplicación después de un test.

La razón por la que no se ha partido está escrita y es correcta: mover código
sin pruebas de navegador se hace a ciegas. Lo cual lleva al siguiente punto.

### 2.5 · Cero pruebas de la interfaz · *fuera, pero decide otras cosas*

**0 archivos de test en toda `apps/web`.** Siete suites en la API, ninguna en la
web, y las pruebas de navegador que existen no son dependencia del repositorio.

Consecuencia concreta: **partir `ventas` no se puede hacer con seguridad**, y
por eso no se ha hecho. La falta de pruebas de interfaz no es un lujo pendiente
— está bloqueando activamente el arreglo de 2.4.

### 2.6 · Un tipo de notificación declarado y nunca emitido · *fuera*

`notifications.kind` admite `recording`, y no se emite ni una vez. En
`signaling.ts` sí existe un estado interno `"recording"`, que es probablemente
de dónde salió la intención. Quien grabe una llamada hoy no avisa a nadie.

Es pequeño: o se emite, o se quita del enum.

### 2.7 · El repositorio se inserta antes de comprobar que se puede leer · *dentro*

`routes/github.ts:81` — el `insert into github_repos` va **antes** de intentar
la lectura. Si el token no alcanza ese repositorio, queda una fila de un
repositorio roto y la pantalla arranca con basura dentro. Ya está en el plan
del día 1.

---

## 3. Lo que falta para ser viable

Separado en lo que impide vender y lo que impide crecer.

### Impide vender — y todo es la misma puerta

**Un solo arreglo enciende cuatro pantallas.** GitHub, Base de datos,
Integraciones e Infraestructura leen las cuatro del conector de GitHub. No están
rotas por su lado: están detrás de la misma puerta cerrada. Y con la corrección
del §0, las cuatro están **construidas**, no a medias.

Lo que falta ahí no es código de producto, son tres cosas del conector:
explicar los fallos de GitHub en vez de reenviarlos, comprobar antes de
insertar, y el camino sin token para repositorios públicos.

**Y sigue habiendo una cosa que no está en nuestras manos:** si la organización
del cliente bloquea los tokens de alcance fino, ningún cambio nuestro lo
arregla. Ese correo sale hoy.

### Impide crecer

1. **Perfil de usuario.** No existe. Es lo primero que busca todo el que entra
   y no encuentra nada. *Fuera de la semana, primero después.*
2. **La deuda de la capa de datos (§2.1)**, que hace que cada pantalla se
   comporte distinto.
3. **Pruebas de interfaz (§2.5)**, que desbloquean partir los archivos grandes.
4. **La decisión sobre móvil (§2.3)**, que es gratis y ordena una partida
   entera.
5. **El grafo de nodos y enlaces**, con su aislamiento resuelto antes de crear
   la tabla — ver el §2.2 del
   [estudio de arquitectura](ESTUDIO-ARQUITECTURA-2026-09-11.md).

---

## 4. Lo que yo cambiaría del plan de la semana, a la luz de esto

- **El día 5 se libera.** Infraestructura no necesita trabajo propio: necesita
  el token. Ese día pasa al tablero (día 6) o al ensayo (día 7), que es el que
  más fallos ha encontrado históricamente.
- **Presentar Infraestructura con confianza.** Estaba en la lista de riesgo por
  un diagnóstico mío equivocado. Está tan lista como Base de datos.
- **Añadir al día 0 la pregunta del móvil.** No cuesta nada y cancela o
  desbloquea semanas de trabajo posterior.

---

## 5. En una frase

Los cimientos son sólidos —el aislamiento es de los mejores que he visto contar
tabla por tabla, y el CI protege lo correcto—; lo que está mal es todo de la
capa de arriba: una abstracción de datos abandonada que crece, errores que se
tragan en silencio, y cero pruebas de interfaz que bloquean los arreglos que ya
se sabían necesarios. **Y las cuatro pantallas que se venden están construidas,
no a medias: están esperando un token.**
