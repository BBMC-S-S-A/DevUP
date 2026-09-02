# Propuesta de desarrollo — la página inicial pública

Qué es la landing de DevUP, qué decide, cómo se construye y qué no entra.
Escrito el 2 de septiembre de 2026.

Va después de [`vision-y-mvp.md`](vision-y-mvp.md) —de ahí sale el mensaje— y
de [`plan-interfaz.md`](plan-interfaz.md) —de ahí salen los materiales. No
sustituye a ninguno: aquellos dicen qué es el producto y cómo se dibuja, este
dice qué se le enseña a alguien que llega sin saber nada.

---

## 1. El punto de partida, medido

Hoy `/` no es una página: es un desvío.
[`apps/web/src/app/page.tsx`](../apps/web/src/app/page.tsx) son 32 líneas que
resuelven la sesión en el cliente y hacen `router.replace()` a `/app` o a
`/login`. Su propio comentario lo dice — existe «solo el tiempo de resolver la
sesión».

Eso significa que **DevUP no tiene puerta de entrada**. Quien llega sin cuenta
aterriza en un formulario de acceso y tiene que decidir si se registra en un
producto que todavía no le han contado. El formulario de `/login` hace lo que
puede —rota frases sueltas: «canales, voz y archivos», «todo tu equipo, un solo
sitio»— pero es un parche: son titulares sin página debajo.

Y hay tres cosas más que faltan, todas consecuencia de la misma ausencia:

| Falta | Consecuencia |
|---|---|
| `metadata` real: solo hay `title` y `description` genéricos en el layout raíz | Un enlace de DevUP pegado en WhatsApp o Slack sale como una tarjeta vacía |
| `robots.txt`, `sitemap.ts`, imagen Open Graph | No hay nada que indexar ni que previsualizar |
| Una URL que se pueda enseñar | No se puede compartir el producto sin dar de alta a alguien |

Lo bueno es que **casi todo el material ya está construido**. El sistema visual
de [`globals.css`](../apps/web/src/app/globals.css) tiene los dos temas
completos, la rejilla, la atmósfera y los materiales de cristal. Las tres
tipografías ya se autohospedan con `next/font`. `LogoAnimado.tsx` ya existe.
La landing no inventa lenguaje: lo usa.

---

## 2. Qué tiene que conseguir esta página

Una sola cosa, y conviene escribirla para poder decir que no a lo demás:

> **Que alguien que llega sin contexto entienda en veinte segundos qué es DevUP
> y por qué es distinto, y salga con una acción hecha —entrar, pedir acceso o
> ver la demo.**

De ahí salen tres criterios de aceptación que no son de gusto:

1. **La frase de posicionamiento va sobre el pliegue, sin scroll, en móvil.**
2. **La página se lee entera sin JavaScript.** Todo lo que aporta el script es
   adorno; nada de lo que se entiende depende de él.
3. **Un enlace compartido genera una tarjeta correcta** en WhatsApp, Slack,
   LinkedIn y X.

---

## 3. El mensaje, que ya estaba decidido

No hay que inventarlo. El §2 de `vision-y-mvp.md` lo cierra:

> **No somos un gestor de proyectos. Somos el gestor del *desarrollo* del
> proyecto.**

Y nombra al enemigo, que no es una empresa: **la pérdida de contexto entre
ventanas**. Eso da la estructura entera de la página, porque una landing es un
argumento con forma de scroll:

1. **El problema** — 1.200 cambios de aplicación al día y ~4 horas semanales
   solo en reorientarse. *(Cifra corregida: ver §12.4 — el 40 % que citaba
   `vision-y-mvp.md` no es publicable sin fuente.)*
2. **La tesis** — el sitio donde el trabajo *ocurre*, no donde se representa.
3. **La prueba** — lo que ya funciona: canales, voz por cercanía, archivos,
   tareas, aislamiento por organización.
4. **La postura** — aliado, no competidor. GitHub, Supabase y Vercel son el
   sustrato, no el rival. Esto es una sección, no una nota al pie: es lo que
   desactiva el «¿y esto sustituye a mi stack?».
5. **La salida** — entrar o pedir acceso.

### 3.1 La tensión que hay que resolver antes de dibujar: DevVerse

Es la decisión más importante de esta propuesta y por eso va aquí y no en una
lista de secciones.

DevVerse —el mundo, los avatares, el audio por cercanía— es lo más vistoso que
tiene el producto y la tentación obvia para la portada. **La recomendación es
que no abra la página.** El argumento no es mío, está en el §3.1 de
`vision-y-mvp.md`: la categoría de oficinas virtuales no sostuvo un negocio para
nadie, y todas fracasaron prometiendo «vente aquí a estar». La conclusión que ya
se tomó fue explícita:

> «Si DevVerse fuera la puerta, DevUP heredaría el problema de Gather. Siendo la
> trastienda, no.»

Abrir la landing con avatares es exactamente convertir la trastienda en puerta,
y contradice una decisión que ya está tomada por escrito.

**Dónde va, entonces:** en una sección propia, después de la prueba, contado
como lo que es —la cara social y la recompensa de un producto de trabajo que
funciona sin él—. Ahí suma mucho, porque es lo único de la página que nadie más
tiene. Lo que no puede hacer es ser lo primero.

---

## 4. Las rutas, y por qué hay que tocar el layout

El cambio estructural es pequeño pero real, y conviene entenderlo antes de
empezar.

| Ruta | Hoy | Propuesta |
|---|---|---|
| `/` | Desvío de cliente a `/app` o `/login` | **La landing.** Servidor, estática |
| `/login`, `/invitacion`, `/recuperar`, `/verificar` | Igual | Igual |
| `/app/**` | El producto | Igual, y sigue exigiendo sesión |

Con `/` público, **el desvío no desaparece: se mueve**. Quien ya tiene sesión
abierta y escribe `devup.app` no quiere leer el argumento de venta otra vez.
La propuesta es un botón «Entrar» que cambia a «Ir a mi espacio» cuando hay
sesión, resuelto en un componente de cliente pequeño dentro de una página de
servidor. Un desvío automático desde `/` sería peor: le quita a un cliente la
posibilidad de enseñarle el producto a alguien desde su propio portátil.

**El problema del layout.** El layout raíz envuelve todo en `SessionProvider`,
que en cuanto monta llama a `/auth/me`. En una página pública eso es una
petición a la API por cada visita anónima —incluida la de cada rastreador— para
recibir un 401 previsible. La solución limpia son **dos grupos de rutas**:

```
app/
  (publico)/     layout ligero: temas y fuentes, sin sesión ni toasts
    page.tsx     la landing
  (privado)/     layout de hoy: SessionProvider, Confirmar, Toaster
    app/ login/ invitacion/ recuperar/ verificar/
```

Los grupos con paréntesis no cambian ninguna URL. Es una reorganización de
archivos, no una migración. Y deja la landing como un componente de servidor
puro, que es lo que permite el criterio 2 del §2.

---

## 5. Las secciones, una por una

Ocho bloques. El número importa: una landing de veinte secciones es una que
nadie termina.

> **Pasaron a diez el 2 de septiembre**, al entrar planes y beneficios por
> perfil. La tabla revisada está en el §12.5; esta se conserva porque el
> razonamiento de los ocho originales sigue valiendo.

| # | Bloque | Qué dice | Coste |
|---|---|---|---|
| 1 | **Barra** | Logo, tres anclas, botón de entrar, selector de tema | S |
| 2 | **Portada** | La frase del §3, un subtítulo, dos botones y una imagen del producto | M |
| 3 | **El problema** | 1.200 saltos al día y 4 h semanales, citando el estudio de HBR (§12.1) | S |
| 4 | **La tesis** | Tres columnas: donde ocurre / estado deducido / contexto que no se pierde | S |
| 5 | **Lo que ya funciona** | Rejilla de capacidades reales con captura por cada una | L |
| 6 | **Aliado, no competidor** | Los logos del sustrato y la frase que lo explica | M |
| 7 | **DevVerse** | La trastienda, contada como recompensa | M |
| 8 | **Cierre y pie** | Repetir la acción, enlaces legales, contacto | S |

Dos avisos sobre el bloque 5, que es el caro:

- **Las capturas son el trabajo real de esta landing**, no el código. Una
  captura mala hunde una sección buena. Hay que decidir si se toman de la
  aplicación con datos de demostración —hay `test:world` y `db:reset` para
  montarlos— o se maquetan a mano. **Recomiendo tomarlas de la aplicación
  real**: maquetar pantallas falsas es dibujar dos veces y envejece mal.
- **Solo entra lo que está terminado.** El §1.4 de `vision-y-mvp.md` fija que
  el MVP no es «una maqueta ancha de cosas a medias»; enseñar en la portada algo
  que al entrar no está es la forma más rápida de gastarse la confianza.

---

## 6. El sistema visual, y la regla que hay que romper a propósito

La landing **no define paleta nueva**. Usa los tokens de `globals.css`, hereda
los dos temas y el morado de acento. Un visitante que entra después tiene que
reconocer el mismo producto.

Pero hay una regla del sistema que no aplica aquí, y conviene romperla
conscientemente y dejarlo escrito. La regla 3 dice:

> «Nada se mueve más de 300 ms […] Una interfaz de trabajo se mira ocho horas:
> la animación que encanta la primera vez estorba la número doscientos.»

El argumento es correcto **y su premisa no se cumple en una landing**: esta
página se mira una vez, cuarenta segundos, y su trabajo es justamente encantar
la primera vez. Así que:

- **Dentro de `/app` la regla sigue intacta.** No se toca.
- **En `(publico)` se permite movimiento más largo** —entradas al hacer scroll,
  el trazo del logo, un degradado que respira—, con dos límites: nada bloquea la
  lectura, y todo se apaga entero bajo `prefers-reduced-motion`.

Que esta excepción viva en su propio grupo de rutas no es casualidad: es lo que
impide que se filtre al producto.

---

## 7. Rendimiento, indexación y lo que se mide

Lo que hace que una landing funcione no se ve:

- **Componente de servidor, sin `"use client"`** salvo en el botón que mira la
  sesión y en el selector de tema.
- **`metadata` completa**: `openGraph`, `twitter`, `canonical`, y una imagen OG
  generada con `opengraph-image.tsx` de Next —se dibuja en el `build` desde los
  mismos tokens, así que no hay un PNG que se quede viejo cuando cambie la
  marca.
- **`robots.ts` y `sitemap.ts`**, y `robots` en `noindex` para todo `/app`.
- **`JSON-LD` de `SoftwareApplication`**, que es lo que rellena la ficha en los
  buscadores.
- **Presupuesto**: LCP por debajo de 2 s en 4G, cero desplazamiento de diseño,
  y las capturas en AVIF y WebP servidas por `next/image` con tamaños
  explícitos.
- **Analítica**: sin cookies de terceros. Aquí hay decisión legal —conviene
  pasar la elección de proveedor por `legal-radar` antes de instalar nada, y
  redactar aviso de privacidad, porque el pie de la página va a enlazarlo.

---

## 8. Qué no entra

Decir esto ahora es lo que impide que la landing se coma dos semanas:

- **Blog, changelog, documentación pública.** Cada uno es otro proyecto.
- **Multi-idioma.** Se deja la puerta abierta —`lang="es"` ya está en el layout
  y las rutas permiten prefijo—, pero se lanza en español.
- **Formulario de contacto propio.** Un `mailto:` o un enlace a un formulario
  externo hasta que haya demanda; un formulario propio arrastra datos
  personales, almacenamiento y aviso legal.
- **Demo interactiva embebida.** Un vídeo corto hace el mismo trabajo por una
  décima parte, y no se rompe cuando cambie el producto.

---

## 9. Fases

Cada fase deja algo que se puede enseñar. Eso es deliberado: si se corta a la
mitad, lo hecho sirve igual.

**Fase 1 — La estructura (lo que desbloquea todo lo demás)**
Grupos de rutas `(publico)` y `(privado)`, la landing como componente de
servidor, barra y portada con la frase del §3, botón que reconoce la sesión, y
un pie. Metadata, OG, `robots` y `sitemap`. Al terminar esto, **DevUP ya tiene
una URL que se puede compartir**, aunque la página sea corta.

**Fase 2 — El argumento**
Bloques 3, 4 y 8. Es texto y maquetación, sin dependencias externas. Al
terminar, la página ya convence.

**Fase 3 — La prueba**
El bloque 5, con las capturas reales, y el 6. Es la fase larga y la que depende
de montar los datos de demostración.

**Fase 4 — El brillo**
DevVerse (bloque 7), las animaciones de scroll del §6, el vídeo si se decide
grabarlo, y la pasada de rendimiento y accesibilidad contra el presupuesto.

---

## 10. Lo que hay que decidir antes de escribir código

> **Actualizado el 2 de septiembre de 2026.** Los dos documentos de Hytrex
> —`DevUP-Propuesta-de-Desarrollo` y `DevUP_Definicion_Conceptual_Modelo_Negocio`—
> cierran tres de estas cuatro preguntas. Lo que dejan abierto, y lo que dejan
> en contradicción, está en el §12.

1. **¿A quién le habla la página?** ~~Abierta.~~ **Cerrada.** Son tres
   segmentos, y están perfilados: la persona técnica dentro de un equipo
   pequeño (Mateo, tech lead, 2-15 personas), la empresa con área de desarrollo
   o software factory (~30 developers, decide el CTO o el director de
   operaciones) y la startup de producto (6 personas, decide el fundador y cada
   dólar compite con el runway). **La página tiene que hablarle a los tres sin
   partirse en tres**, y eso se resuelve con la tabla de planes: cada columna es
   uno de ellos.

2. **¿Registro abierto o por invitación?** ~~Abierta.~~ **Cerrada.** El modelo
   de negocio lo fija: «autoservicio para Free y Pro, soporte dedicado para Team
   y Enterprise», y el primer canal listado es «landing page y prueba gratuita».
   Así que la portada pide **registro**, no acceso — y la puerta de la aplicación,
   hoy cerrada por defecto, tiene que abrirse para el plan libre. Eso es trabajo
   de API, no de landing, y conviene saberlo ahora.

3. **¿Marca DevUP o marca Hytrex?** ~~Abierta.~~ **Cerrada.** Hytrex es la
   empresa —«ingeniería digital con propósito», y su lema es *Clarity. Purpose.
   Impact.*—; DevUP es el producto. La landing es de DevUP y Hytrex firma en el
   pie.

4. **¿Hay dominio?** **Sigue abierta.** La metadata, el `canonical` y el
   `sitemap` necesitan una URL absoluta. Si todavía no hay, se parametriza con
   `NEXT_PUBLIC_SITE_URL` y se decide después.

---

## 11. Riesgos

| Riesgo | Por qué pasa | Qué lo contiene |
|---|---|---|
| Las capturas envejecen | El producto se mueve rápido | Tomarlas de la aplicación real con un guion repetible, no maquetarlas |
| La landing promete lo que `/app` no da | La tentación de enseñar lo que viene | Regla del §5: solo entra lo terminado |
| El movimiento se filtra al producto | Copiar y pegar entre rutas | La excepción vive en `(publico)`, y está escrita aquí |
| La reorganización de rutas rompe enlaces | Mover archivos | Los grupos con paréntesis no cambian URLs; verificar con los `e2e` que ya existen |
| DevVerse se come la portada | Es lo más vistoso | La decisión del §3.1, que no es nueva: ya estaba tomada en `vision-y-mvp.md` |

---

## 12. Lo que fijan los dos documentos de Hytrex

> Añadido el 2 de septiembre de 2026 tras leer
> `DevUP-Propuesta-de-Desarrollo` (v1) y
> `DevUP_Definicion_Conceptual_Modelo_Negocio_Hytrex` (v1).

Los dos documentos aportan tres cosas que la landing necesitaba y no tenía:
**el argumento con sus fuentes**, **la prueba en números** y **la estructura de
los planes**. También dejan dos contradicciones entre sí que hay que resolver
antes de publicar nada, porque las dos acabarían impresas en la página.

### 12.1 El argumento, ahora con fuente citable

El §2 de la propuesta de desarrollo trae tres investigaciones, y son mejores
que lo que teníamos:

| Dato | Fuente | Dónde va |
|---|---|---|
| ~1.200 cambios de aplicación al día; ~4 h semanales (**9 %** de la jornada) solo en reorientarse | Harvard Business Review, 2022 — 137 personas de 20 equipos en tres empresas del Fortune 500, cinco semanas | Bloque 3, el problema |
| El 57 % de las esferas de trabajo se interrumpen; reanudar obliga a reconstruir el contexto | Mark, González y Harris, 2005 | Bloque 3, el remate |
| El 84 % usa IA pero solo el 29 % confía en la respuesta (frente al 40 % en 2024), y **el 46 % desconfía activamente**; el 66 % señala «soluciones casi correctas» como su mayor dolor | Stack Overflow Developer Survey 2025 | Bloque 4, la tesis |

**El tercero es el mejor gancho que tiene este producto y no estaba en el plan.**
Dice que el cuello de botella ya no es escribir código: es sostener el contexto
y verificar lo que sale. Eso es exactamente lo que DevUP vende, dicho por
90.000 desarrolladores y no por nosotros.

### 12.2 La prueba, en números verificados contra el código

El §5 de la propuesta los da ya contados, y el propio documento avisa de que
están «escritos a partir del código y no de lo que prometían los planes»:

- **134 puntos de API** en 18 módulos
- **45 tablas**, 44 con política de aislamiento
- **21 pantallas** y **24 migraciones**
- **231 comprobaciones automáticas en verde** en cada cambio, de las cuales
  **172 son de aislamiento entre organizaciones**

Ese último número merece un sitio propio en el bloque 5. Para el perfil de
software factory, el aislamiento entre clientes no es una función: es la
condición para poder usar el producto. «172 pruebas automáticas verifican que
una organización no ve nada de otra» es una frase que ningún competidor de
tablero de tarjetas puede escribir.

### 12.3 Conflicto 1 — las dos tablas de precios no son la misma

| Plan | Documento de negocio | Propuesta de desarrollo |
|---|---|---|
| Libre / Free | 0 USD, hasta 4 personas | 0 USD, hasta 4 personas, una organización, **un conector** |
| **Pro** | **7 USD/mes · 70 USD/año** — freelancer | **No existe** |
| Equipo / Team | 12 USD/mes · 120 USD/año | 12 USD/persona/mes |
| Empresa / Enterprise | 24 USD/mes · cotización anual | 24 USD/persona/mes |
| Consumo de agente | No aparece | «Medido, aparte» |

Los precios coinciden donde se solapan. **La discrepancia real es si el plan Pro
de 7 USD existe**, y no es cosmética: decide si la tabla tiene tres columnas o
cuatro. Con tres, la del medio se marca como recomendada y la página respira;
con cuatro, en móvil hay que apilarlas y el bloque se hace largo.

Hay además un detalle que resuelve el propio documento: **la línea de consumo de
agente ya está derogada**. El §10 de la propuesta explica que DevUP pasó a ser
un servidor MCP en vez de cliente de un modelo —el agente lo pone el equipo con
su propia suscripción— y dice literalmente que ese renglón de la tabla
desaparece. La landing no debe mostrarlo.

**Sobre «los precios están por decidirse»:** conviene saber que el documento de
negocio **ya hizo la validación**. Son 22 entrevistas con la técnica de Van
Westendorp, y movieron los números: Pro bajó de 9 a 7 USD por alta sensibilidad
al precio en freelancers, Equipo bajó de 15 a 12 para caer dentro del rango
óptimo de 10-14, y Empresa se confirmó en 24 porque el 68 % de los decisores lo
consideró razonable sin negociar. La propuesta de desarrollo, que dice «una
estimación para validar, no una tarifa cerrada», es anterior a ese trabajo.

**Lo que la landing necesita para arrancar no son los precios: es el número de
columnas.** El bloque se puede diseñar y maquetar con los importes como
variables, y rellenarlos el día que se cierren.

### 12.4 Conflicto 2 — el 40 % contra el 9 %

`vision-y-mvp.md` afirma que «un índice de 2026 cifra en más del 40 % de la
semana productiva» lo que se pierde entre sistemas desconectados. La propuesta
de desarrollo cifra en **4 horas semanales, el 9 %**, lo que se va en
reorientarse, con el estudio de HBR detrás.

No son el mismo dato —el 40 % mide «trabajo sobre el trabajo» en sentido amplio
y el 9 % mide solo la reorientación tras cada salto—, pero **en una página
pública no se pueden publicar los dos**, y publicar el 40 % sin poder enseñar la
fuente exacta es el tipo de cifra que un CTO comprueba antes de comprar.

**Recomendación: usar el 9 % con la cita de HBR.** Es más bajo, es más
defendible, y va acompañado de las 1.200 veces al día, que es la cifra que de
verdad se siente al leerla.

### 12.5 Qué cambia en las secciones del §5

La estructura de ocho bloques aguanta. Se le añaden dos y se reordena uno:

| # | Bloque | Cambio |
|---|---|---|
| 5 | Lo que ya funciona | Añadir la fila de números del §12.2, con el 172 destacado |
| 6 | Aliado, no competidor | Sin cambio; el documento lo confirma palabra por palabra |
| 7 | **Beneficios por perfil** | **Nuevo.** Tres tarjetas —persona, empresa, startup— cada una con su dolor y su alivio, sacados de los mapas de empatía |
| 8 | DevVerse | Baja un puesto |
| 9 | **Planes** | **Nuevo.** Tres o cuatro columnas según el §12.3, con la mensual/anual conmutable |
| 10 | Cierre y pie | Hytrex firma aquí |

