# Continuar aquí

Informe de estado. Existe para que quien retome —persona o agente— no tenga que
redescubrir lo que ya se decidió ni volver a discutirlo.

**Empieza por aquí, y en este orden:**

1. Este archivo: dónde estamos y qué toca.
2. [`CONTEXTO-COMPLETO.md`](CONTEXTO-COMPLETO.md) — arquitectura y el porqué de
   cada decisión de la base.
3. [`plan-mundo-y-plataforma.md`](plan-mundo-y-plataforma.md) — el plan por
   fases, con estimaciones y la secuencia propuesta.
4. [`decisiones/`](decisiones/) — las dos decisiones cerradas que no se
   reabren sin motivo nuevo.

---

## Dónde estamos

De las **tres promesas** del producto:

| Promesa | Estado |
|---|---|
| **Espacio de trabajo** | Completa. Canales, mensajería, voz, archivos, tareas, grabación, invitaciones, notificaciones — más la vista inmersiva encima |
| **Control de ventas** | Servicios, clientes, embudo y objetivos que avanzan solos. Falta búsqueda global |
| **Infraestructura y agentes** | Sin empezar |

En la definición de «plataforma funcional» del plan (§9), **van cinco de nueve
capacidades**.

### Lo construido en el último tramo

**La vista inmersiva, fases 1 a 4** (decisión
[`0002`](decisiones/0002-vistas-profesional-e-inmersiva.md)):

- Planta por workspace, zonas ligadas a canales, presencia y movimiento
- Renderizador Canvas 2D en ¾ con elevación · 55 muebles · 18 variantes de personaje
- Editor de salas: paleta, colocar, girar, quitar, deshacer, materiales
- Sentarse, avatar por capas con perfil real, hablar y gestos
- Muebles vivos: pizarra→tablero, estantería→archivos, monitor→actividad, reloj
- Tecla **E**: el puente a la vista profesional
- Interruptor por organización para apagarla entera

**Ventas (S4 y S5):**

- Servicios con precio, clientes, oportunidades con embudo de cinco etapas
- Cotización por líneas, con el precio congelado en el momento de ofrecerlo
- Objetivos trimestrales cuyo avance **es una consulta**, no una columna
- Pantalla del embudo con arrastrar y soltar, y franja de objetivos

### Pruebas

| Comando | Qué cubre |
|---|---|
| `npm run test:rls` | **98 comprobaciones** de aislamiento entre organizaciones |
| `npm run test:world` | 13 del socket de la oficina (reparto por tick y zonas privadas) |
| `e2e/` | 11 guiones de navegador y de API. Ver [`e2e/README.md`](../e2e/README.md) |

Los tres tienen que estar en verde antes de empezar nada.

---

## Lo siguiente, y en qué orden

### 1. S6 — Búsqueda global · ~22 puntos · **es el hito que decide el proyecto**

El plan lo dice desde el principio y no ha cambiado:

> Si el propio equipo no quiere abandonar sus herramientas actuales para usar
> DevUP, ningún cliente lo hará tampoco.

Hoy la búsqueda es por workspace. Global significa: mensajes, archivos, tareas,
clientes y ventas desde un solo sitio. Los índices de texto completo ya existen
para mensajes (`spanish`) y archivos (`simple`, y el motivo de esa diferencia
está en `0005_messages.sql`); faltan los de ventas y unificar el resultado.

**Cuidado con lo de siempre:** una búsqueda que cruza cinco tablas es cinco
sitios donde el aislamiento puede escaparse. Cada consulta va sin `where
organization_id`, y cada tabla nueva que entre en la búsqueda necesita su caso
en `isolation.test.ts`.

### 2. S7 — Bóveda y conectores · ~22 puntos

Es la tercera promesa y **desbloquea la mitad de la Fase 4 de la oficina**:
cinco de los nueve muebles vivos no tienen nada que mostrar hasta que existan
conectores (pantalla de despliegue, rack de servidores, tablón de ventas,
vitrina de trofeos).

La bóveda de credenciales es el activo más sensible del producto. No se empieza
sin releer §1 de `CONTEXTO-COMPLETO.md`.

### 3. S8–S12

Base de datos como código, migraciones sincronizadas con el repo, agentes,
DevUP ID y beta. Detalle en el plan de 12 semanas.

### Pendientes sueltos, pequeños

- **Histéresis de tres radios dentro de una sala** (~8 pts). El reparto por
  zonas resuelve veinte personas en cuatro salas; no resuelve doce en una,
  donde la malla vuelve a pedir once conexiones por cabeza. Está descrito en
  §11 bis de la decisión 0002.
- **Ficha de cliente y detalle de cotización.** Hoy las líneas se añaden al
  crear la venta y se ven por API, pero no hay pantalla para editarlas después.
- **Redis** para presencia y límite de peticiones, el día que haya más de una
  instancia de API.

---

## Decisiones cerradas que no se reabren sin motivo nuevo

- **Aislamiento por RLS**, no por esquema por organización.
- **Sin Supabase**: el plano de control es propio.
- **Cifrado extremo a extremo siempre**, grabación en el cliente con
  consentimiento unánime ([`0001`](decisiones/0001-cifrado-de-salas.md)).
- **El mundo proyecta, no origina** ([`0002`](decisiones/0002-vistas-profesional-e-inmersiva.md)
  §5). Toda zona es un canal que ya existe; lo único que vive solo en el mundo
  es la decoración. De ahí salen tres consecuencias que ya están en el código y
  conviene no deshacer por descuido:
  - No hay audio ni chat en el pasillo. Sin zona no hay canal donde escribir, y
    una conversación invisible desde la vista profesional es exactamente el
    fallo del que la regla protege.
  - Lo que se dice en una sala **es un mensaje de su canal**, escrito por HTTP
    antes de mandar la burbuja.
  - El servidor del mundo reparte y olvida: no guarda nada de lo que se dice.

## Decisiones aún abiertas

- SFU autoalojado o gestionado, cuando la malla se quede corta. **Ojo:** meter
  un SFU pierde el cifrado extremo a extremo por la puerta de atrás.
- Grabación con vídeo, que hoy es solo audio a propósito.
- Modelo de precios y residencia de datos.
- Si la vista inmersiva llega a fase 5 (inventario, cosméticos, invitados
  externos) o se queda donde está.

---

## Trampas conocidas, añadidas en este tramo

Todas encontradas ejecutando el sistema. Las de la base y la voz siguen en §9
de `CONTEXTO-COMPLETO.md`; estas son nuevas.

| Síntoma | Causa | Salida |
|---|---|---|
| `Maximum update depth exceeded` al abrir la oficina | Un efecto con `leaveChannel` como dependencia, y esa función se recrea en cada renderizado del proveedor de llamada | Guardar las funciones del proveedor en una referencia y dejar el efecto sin dependencias |
| Se ven seis casillas y la oficina parece un pasillo | La cámara a 2× la densidad del dispositivo | 1,2 × densidad. En el renderizador aislado no se nota: allí la cámara la fija la prueba |
| Se aparece en un descampado | El punto de aparición era el centro geométrico de la planta | En el pasillo, frente a la puerta de la primera sala visible |
| El botón de guardar del editor no responde | La barra de llamada persistente es `z-40` y tapaba el panel | El panel del editor va en `z-50` |
| Una capa de avatar se guarda y no vuelve | La consulta de lectura seguía pidiendo solo las columnas viejas | Probar la ida **y la vuelta**, no solo el guardado |
| «Sentarse» no aparece estando al lado de la silla | El radio era 1,4 y la distancia real 1,49 | 1,8. Cinco centésimas de más se ven desde fuera como que la función no existe |
| Un avatar sentado parece hundido en el suelo | Solo se bajaba el cuerpo | Bajar, recoger las piernas y sacar los pies por delante |
| La alfombra tapa el sofá | Entraba en el orden por Y, y está en la parte baja de la sala | Los objetos planos se dibujan con el suelo |
| Un muro sale a franjas | Cada casilla pintaba su cara superior sobre el cuerpo de la de arriba | La cara superior solo donde el muro empieza |
| Una prueba dice que un objetivo «no avanzó» y el código está bien | Reutilizaba una venta ya ganada, que el objetivo ya contaba | Crear datos nuevos en cada prueba; reutilizar estado es cómo se acaba dudando de código correcto |
| El navegador da 404 en todos los recursos | Dos instancias de `next dev` peleándose por `.next` | Matar todas y arrancar una sola |

### Y la lección de método, que vale más que la tabla

**De los fallos de este tramo, ninguno lo vieron los tipos ni las 98
comprobaciones automáticas.** Todos salieron abriendo la aplicación entera en un
navegador — y dos de ellos ni siquiera fallaban, se veían mal. De ahí que
`e2e/` deje capturas y que mirarlas sea parte de la prueba.

Escribir mucho sin ese ciclo es entregar código que no se sabe si funciona.

---

## Puesta en marcha

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 17 y MinIO
npm run db:migrate   # 13 migraciones
npm run dev          # API en :4000, web en :3000

npm run test:rls     # 98 · que esté en verde antes de empezar nada
npm run test:world   # 13
```

Para las pruebas de navegador, ver [`e2e/README.md`](../e2e/README.md): hacen
falta los dos servidores levantados y `npm install --no-save playwright`.

### Lo que más fácil es romper sin darse cuenta

- **`DATABASE_URL` tiene que ser el rol `devup_app`**, que no es propietario de
  las tablas. Apuntarla al rol de las migraciones desactiva todo el aislamiento
  **sin un solo error** en los registros.
- **Toda consulta pasa por `withUser()`**, que fija `app.user_id` con alcance
  local a la transacción.
- **Las funciones de pertenencia son `SECURITY DEFINER` a propósito.**
- **Cada tabla nueva con `organization_id` necesita su política y su caso en
  `isolation.test.ts`.** Es el único freno automático contra una fuga entre
  clientes, y en este tramo ha crecido de 45 a 98 comprobaciones justamente por
  respetarlo.
- **Nada secreto en una variable `NEXT_PUBLIC_*`.**
- **El dinero va en céntimos enteros de punta a punta.** `0,1 + 0,2` no da `0,3`
  en coma flotante, y en una cotización eso es un céntimo que no cuadra.
