# Estudio de planes y precios

Qué cobra el mercado por lo que DevUP reúne, qué debería cobrar DevUP, y qué
entra en cada uno de los cuatro planes. Escrito el 2 de septiembre de 2026.

Va con [`plan-landing-publica.md`](plan-landing-publica.md) —la landing es donde
esta tabla se enseña— y corrige la estructura de planes de los dos documentos de
Hytrex, que traían cuatro planes distintos de los que se han decidido ahora.

**Los precios de este documento son bandas recomendadas, no tarifa.** Lo que sí
queda cerrado aquí es **qué entra en cada plan**, que es lo que la landing
necesita para poder maquetarse.

---

## 1. La estructura decidida, y el problema que trae

Cuatro categorías, tres de pago:

| # | Categoría | Qué recibe, según lo dictado |
|---|---|---|
| 1 | Desarrollador individual | Todo menos llamadas, DevVerse y «otras por confirmar» |
| 2 | Grupo de desarrolladores | Todo, con llamadas y DevVerse limitados a 4 |
| 3 | Pequeñas startups y pequeñas empresas | Todo |
| 4 | Grupo empresarial | Todo |

**Hay un problema estructural que conviene resolver antes que el precio: los
planes 3 y 4 son idénticos.** Si dos planes ofrecen lo mismo, nadie compra el
caro — y el caro es justamente el que sostiene el negocio. Un plan empresarial
no se vende por tener más funciones de producto, sino por tres cosas que solo
importan cuando la empresa es grande:

- **Gobierno** — inicio de sesión corporativo, roles y permisos, registro de
  auditoría.
- **Garantía** — acuerdo de nivel de servicio, soporte con persona asignada,
  contrato y facturación a medida.
- **Escala** — sin tope de asientos, sin tope de organizaciones, retención larga.

Las tres están ya nombradas en la propuesta de desarrollo como trabajo previsto.
La recomendación es que **el plan 4 se diferencie por ahí y no por funciones**,
y que el plan 3 sea «el producto entero para un equipo que cabe en una sala».

Y hay una segunda decisión escondida en «tres tipos de pago»: **el plan 1 es
gratuito**. Eso choca con los dos documentos de Hytrex, donde el plan libre era
«hasta 4 personas» y existía además un Pro de 7 USD para el freelancer. Con la
estructura nueva, el equipo de 2 a 4 personas deja de tener plan gratis. Es
defendible —el gratis pasa a ser estrictamente individual— pero es un cambio de
estrategia de entrada, no un ajuste, y conviene tomarlo a sabiendas.

---

## 2. Qué cobra el mercado por las piezas que DevUP reúne

Precios de lista, por persona y mes, consultados el 2 de septiembre de 2026.
Donde hay dos cifras, la primera es pago mensual y la segunda anual.

| Pieza | Producto | Precio |
|---|---|---|
| Tareas | Jira Standard | 7,91 USD |
| Tareas | ClickUp Unlimited | 7 USD anual |
| Tareas | Linear Basic · Business | 10 · 16 USD |
| Mensajería | Slack Pro | 8,75 · 7,25 USD |
| Mensajería | Slack Business+ | 18 · 15 USD |
| Documentos | Notion Plus · Business | 12 · 10 · 24 · 20 USD |
| Espacio virtual | Gather | 15 USD — *retiró su plan gratuito permanente a partir de enero de 2026* |
| Espacio virtual | Kumospace Business | 16 · 12,80 USD |
| IA de código | GitHub Copilot Business | 19 USD |
| IA de código | Cursor Business | 40 USD |

### La suma, que es la única comparación que hace un comprador

Un equipo que hoy quiere tareas, mensajería y espacio virtual paga
**entre 27 y 34 USD por persona y mes** (Jira + Slack Pro + Kumospace anual, o
Linear + Slack + Gather). Si además tiene asistente de código, se va **por
encima de 45 USD**.

Ese es el número contra el que se compara DevUP, y es el argumento de la
sección de planes de la landing. No hace falta adornarlo: **la columna de la
izquierda suma treinta y pico dólares y la de la derecha uno solo.**

### Dos lecturas menos obvias

- **Gather retiró su plan gratuito permanente** con efecto en las renovaciones
  desde enero de 2026, y se quedó en 15 USD. La categoría de oficina virtual se
  está encareciendo justo cuando DevUP la regala dentro de otra cosa. Es una
  ventana, y no va a durar.
- **El precio de la IA se está volviendo medido, no plano.** GitHub pasó en
  junio de 2026 de peticiones premium fijas a créditos de IA consumibles. Eso
  respalda la decisión que ya está tomada en la propuesta de desarrollo —que
  DevUP sea servidor MCP y el agente lo ponga el equipo con su propia
  suscripción—: nos quita de encima el coste variable justo cuando el mercado
  descubre que no sabe cubrirlo.

---

## 3. Qué precio poner

Tres anclajes, y los tres apuntan al mismo sitio:

1. **La investigación propia.** Las 22 entrevistas con la técnica de Van
   Westendorp del documento de negocio situaron el óptimo para equipos técnicos
   **entre 10 y 14 USD**, y el 68 % de los decisores corporativos consideró
   **24 USD razonable sin negociar**.
2. **La suma de lo que sustituye**, del §2: entre 27 y 34 USD.
3. **El techo del mercado por pieza suelta**: nadie del sustrato pasa de 20 USD
   salvo la IA.

De ahí salen las bandas. La regla es que **cada plan quede por debajo de la suma
de lo que reemplaza**, porque es la comparación que el comprador hace de verdad.

| Categoría | Banda recomendada | Por qué esa |
|---|---|---|
| 1 · Individual | **0 USD** | Es el canal de entrada, no un plan. Quien trabaja solo es quien más sufre la dispersión y quien lo cuenta cuando crece |
| 2 · Grupo de desarrolladores | **8 – 10 USD** | Por debajo del óptimo validado, porque el producto va topado a 4 en llamadas y DevVerse. Un plan recortado no se cobra al precio del entero |
| 3 · Startups y pequeñas empresas | **12 – 14 USD** | El óptimo validado, y menos de la mitad de la suma que sustituye |
| 4 · Grupo empresarial | **22 – 26 USD** | El 68 % lo aceptó a 24. Por encima de 26 empieza la negociación y hace falta un vendedor |

**Anual: dos meses gratis** (multiplicar por 10), que es lo que ya proponían los
dos documentos y lo que hace el mercado.

### El punto que falta en los dos documentos: Colombia

Hytrex es colombiana y sus primeros clientes probablemente también. Las tarifas
de arriba son de mercado estadounidense. El índice de paridad de poder
adquisitivo de Colombia ronda el 0,34, y la recomendación habitual para la
región es un descuento de entre el 30 y el 40 % sobre el precio base — hay casos
documentados de subidas de conversión del 65 % en Latinoamérica aplicando un
35 %, con ingreso neto al alza pese al descuento.

**No es una rebaja: es un precio distinto para un mercado distinto.** Lo que sí
obliga es a decidirlo antes de publicar la landing, porque cambia si la tabla
enseña un precio o dos, y si detecta el país o lo pregunta.

---

## 4. Qué entra en cada plan

Esto es lo que la landing necesita cerrado, y no depende de los precios.
Las filas salen de lo que existe hoy según el §5 de la propuesta de desarrollo.

| | 1 · Individual | 2 · Grupo devs | 3 · Startups y pymes | 4 · Empresarial |
|---|---|---|---|---|
| **Personas** | 1 | hasta 4 | hasta 25 | sin tope |
| **Organizaciones** | 1 | 1 | 3 | sin tope |
| Canales y mensajería | ✓ | ✓ | ✓ | ✓ |
| Tablero de tareas | ✓ | ✓ | ✓ | ✓ |
| Biblioteca de archivos | ✓ | ✓ | ✓ | ✓ |
| Búsqueda global | ✓ | ✓ | ✓ | ✓ |
| Control de ventas | ✓ | ✓ | ✓ | ✓ |
| **Llamadas de voz y vídeo** | — | hasta 4 | sin tope | sin tope |
| Grabación con consentimiento | — | — | ✓ | ✓ |
| **DevVerse** | — | hasta 4 | sin tope | sin tope |
| Bóveda de credenciales | — | ✓ | ✓ | ✓ |
| Conectores | 1 | 3 | sin tope | sin tope |
| Vista de entornos y despliegues | — | ✓ | ✓ | ✓ |
| Integraciones guiadas | — | ✓ | ✓ | ✓ |
| Base de datos como código | — | — | ✓ | ✓ |
| Servidor MCP para agentes | — | ✓ | ✓ | ✓ |
| **Roles y permisos** | — | — | — | ✓ |
| **Registro de auditoría** | — | — | — | ✓ |
| **Inicio de sesión corporativo** | — | — | — | ✓ |
| **Acuerdo de nivel de servicio** | — | — | — | ✓ |
| **Soporte** | Comunidad | Comunidad | Correo | Persona asignada |
| Retención de historial | 90 días | 1 año | 2 años | Sin límite |

### Las decisiones que hay dentro de esa tabla

- **«Otras por confirmar» del plan individual, resueltas.** Fuera: llamadas,
  DevVerse, grabación, y todo lo que solo tiene sentido con más de una persona.
  Fuera también la bóveda de credenciales y la vista de infraestructura, no por
  mezquindad sino porque **cuestan dinero real por usuario** y un plan gratuito
  ilimitado en recursos no sobrevive. Dentro: el espacio de trabajo entero, un
  conector y el control de ventas.
- **El plan gratuito se limita por recursos, no por funciones.** Un conector,
  una organización, 90 días de historial. Así el individual prueba el producto
  de verdad y choca con el techo cuando su proyecto crece, que es cuando debe
  chocar.
- **El salto de 2 a 3 es «se acabó el tope de 4».** Ese es el disparador de
  compra más limpio que tiene el producto: el día que el equipo ficha a la
  quinta persona, la llamada deja de caber. No hay que explicarlo.
- **El salto de 3 a 4 no es producto, es gobierno.** Roles, auditoría, inicio de
  sesión corporativo y una persona al teléfono. Nada de eso le importa a un
  equipo de ocho, y sin nada de eso no entra en una empresa de trescientos.

---

## 5. Lo que queda por decidir

1. **¿El individual es gratuito o cuesta 5-7 USD?** Si es gratuito, es canal de
   entrada y hay que aceptar su coste. Si cuesta, se recupera el Pro de 7 USD
   que ya validaron las entrevistas — pero entonces DevUP **no tiene plan
   gratuito**, y el primer canal listado en el modelo de negocio es «landing
   page y prueba gratuita». Recomiendo gratuito, con prueba de 14 días del plan
   3 para todo el mundo.
2. **¿Precio para Colombia y Latinoamérica, o precio único?**
3. **¿Los topes son de asientos o de uso?** «Hasta 25 personas» es fácil de
   entender y fácil de esquivar. Sin tope de asientos y con precio por asiento
   es más honesto y más caro de explicar.
4. **¿Cuánto historial retiene el gratuito?** Es la única fila de la tabla que
   toca coste de almacenamiento directamente.

---

## Fuentes

Consultadas el 2 de septiembre de 2026.

- [Jira Pricing 2026](https://costbench.com/software/project-management/jira/) ·
  [tech.co](https://tech.co/project-management-software/jira-pricing)
- [ClickUp vs Jira 2026](https://www.zenpilot.com/blog/clickup-vs-jira/)
- [Linear Pricing 2026](https://costbench.com/software/developer-tools/linear/)
- [Notion Pricing 2026](https://costbench.com/software/project-management/notion/)
- [Slack Pricing 2026](https://costbench.com/software/communication/slack/) ·
  [Slack Business+](https://slack.com/pricing/businessplus)
- [Kumospace Pricing 2026](https://costbench.com/software/video-conferencing/kumospace/) ·
  [Alternativas a Gather](https://www.sowork.com/blog/best-gather-town-alternatives-remote-teams)
- [GitHub Copilot Pricing 2026](https://costbench.com/software/ai-coding-assistants/github-copilot/) ·
  [Cursor Pricing 2026](https://automationatlas.io/answers/cursor-pricing-explained-2026/)
- [SaaS Pricing by Country · índice PPA](https://priceparity.net/blog/saas-pricing-by-country-guide) ·
  [PPP para SaaS](https://fungies.io/ppp-pricing-saas-boost-global-revenue-2026)
