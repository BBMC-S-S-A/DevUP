# -*- coding: utf-8 -*-
"""Contenido de la propuesta de desarrollo de DevUP."""

INGENIEROS = [
    "Juan Felipe Medina Orjuela",
    "Juan Esteban Bonilla",
    "Carlos Fernando Cáceres",
]

BLOQUES = [

("h1", "Resumen"),
("p", "DevUP es una plataforma para equipos que construyen software. No gestiona la "
      "representación del trabajo —tarjetas que alguien mueve a mano— sino el sitio "
      "donde el trabajo ocurre: el repositorio, la base de datos, el despliegue, la "
      "conversación y, cada vez más, el agente."),
("p", "Este documento tiene dos mitades. La primera cuenta qué es DevUP, de dónde "
      "salió la idea, qué problema ataca —con las cifras que lo respaldan y sus "
      "fuentes—, a quién va dirigido y cómo pensamos sostenerlo. La segunda es el "
      "plan de desarrollo: todo lo que hay que hacer para que la plataforma exista "
      "de verdad, en web, en escritorio y en móvil."),
("p", "No lleva fechas a propósito. Lleva actividades, en el orden en que conviene "
      "hacerlas y con el motivo de ese orden, que es lo que hace falta para repartir "
      "el trabajo entre tres personas."),
("quote", "El enemigo de este producto no es una empresa. Es la pérdida de contexto "
          "entre ventanas."),

("pagebreak",),
("kicker", "Parte I"),
("h1", "DevUP"),

("h2", "1. De dónde sale esto"),
("p", "La idea no salió de un estudio de mercado. Salió de nuestra propia semana."),
("p", "Trabajamos en remoto y trabajamos bien: el trabajo remoto funciona, y desde que "
      "la inteligencia artificial entró en el día a día, muchas cosas que antes costaban "
      "una tarde cuestan diez minutos. Pero al mirar de cerca en qué se va el tiempo "
      "aparecía siempre lo mismo, y no era escribir código."),
("p", "Era el ir y venir. El repositorio en una pestaña, la base de datos en otra, el "
      "gestor de tareas en una tercera, la conversación en una cuarta, el panel del "
      "proveedor de despliegue en una quinta, y el asistente en una sexta al que hay "
      "que volver a explicarle el proyecto cada vez. Cada salto es barato; la suma no. "
      "Y lo que se pierde en cada salto no es solo tiempo: es el contexto, que hay que "
      "reconstruir del otro lado."),
("p", "Nos pareció que eso era un problema con forma de producto. No un gestor de "
      "proyectos más —de esos hay muchos y son buenos— sino algo que reuniera en un "
      "solo sitio las ventanas entre las que se pierde el hilo."),

("h2", "2. El problema, y lo que se puede medir"),
("p", "La sensación es nuestra, pero la magnitud está estudiada. Tres investigaciones "
      "independientes describen las tres caras del mismo problema."),

("h3", "El coste de saltar entre aplicaciones"),
("p", "Un estudio publicado en <i>Harvard Business Review</i> en 2022 instrumentó a 137 "
      "trabajadores de veinte equipos en tres empresas del Fortune 500 durante cinco "
      "semanas. El resultado: una persona cambia de aplicación o de pestaña unas "
      "<b>1.200 veces al día</b>. Cada cambio cuesta poco más de dos segundos, pero el "
      "acumulado son <b>casi cuatro horas a la semana</b> —el <b>9 % del tiempo "
      "laboral</b>— dedicadas solo a reorientarse después de cambiar de sitio. [1]"),

("h3", "El coste de recuperar el hilo"),
("p", "Mucho antes, en 2005, Gloria Mark, Victor González y Justin Harris observaron en "
      "detalle a 24 trabajadores del conocimiento y describieron el trabajo real como "
      "<b>fragmentado por norma</b>: la gente pasa poco tiempo seguido en una misma "
      "esfera de trabajo antes de cambiar, y el <b>57 % de esas esferas se "
      "interrumpen</b>. Reanudar no es gratis: hay que volver a montar en la cabeza "
      "dónde se estaba. [2]"),

("h3", "Lo que cambió la inteligencia artificial, y lo que no"),
("p", "La encuesta a desarrolladores de Stack Overflow de 2025 muestra las dos cosas a "
      "la vez. La adopción es casi total: el <b>84 %</b> usa o piensa usar herramientas "
      "de IA, frente al 76 % del año anterior. Pero la confianza cae: solo el "
      "<b>29 %</b> confía en que la respuesta sea correcta, frente al 40 % de 2024, y "
      "hay más gente que desconfía activamente (<b>46 %</b>) que gente que confía. El "
      "dolor concreto que más se repite lo dice el <b>66 %</b>: soluciones que están "
      "<i>casi</i> bien y que cuesta más depurar que escribir. Y cuando se pregunta por "
      "qué acudirían a una persona, la primera razón, con el <b>75 %</b>, es «cuando no "
      "me fío de lo que responde la IA». [3]"),

("h3", "Lo que junta las tres"),
("p", "Leídas juntas cuentan una historia sola. La IA no eliminó el cuello de botella: "
      "lo movió. Ya no está en escribir el código; está en <b>sostener el contexto</b> "
      "—para que el agente y la persona sepan de qué proyecto se habla— y en "
      "<b>verificar</b> lo que sale. Y las dos cosas ocurren hoy repartidas entre "
      "ventanas que no se hablan entre sí."),
("p", "Ahí es donde queremos estar."),

("h2", "3. Qué es DevUP"),
("quote", "No somos un gestor de proyectos. Somos el gestor del desarrollo del proyecto."),
("p", "La diferencia no es un juego de palabras. Un gestor de proyectos administra la "
      "<i>representación</i> del trabajo: tarjetas que describen algo que está pasando "
      "en otro sitio, y que alguien tiene que acordarse de mover. La tarjeta y el código "
      "no se tocan nunca."),
("p", "DevUP vive en el otro lado: el repositorio, la base de datos, el despliegue, el "
      "agente y la conversación, en el mismo sitio, de manera que el estado se deduzca "
      "de lo que pasó y no de lo que alguien anotó. Una integración continua en rojo "
      "abre una tarea sola. Un despliegue se ve sin entrar al panel del proveedor. Un "
      "agente trabaja con las credenciales de la organización y su resultado lo revisa "
      "el equipo."),
("p", "De ahí sale la estrategia comercial, y conviene decirla explícitamente: "
      "<b>somos aliados, no competencia</b>. GitHub, Supabase, Vercel y los gestores de "
      "proyectos son el sustrato sobre el que corre DevUP. Si el enemigo es la "
      "dispersión, cada plataforma integrada es una victoria, no un rival."),

("h2", "4. A quién va dirigido"),
("p", "A cualquier organización que construya software. Eso incluye dos perfiles que se "
      "parecen menos de lo que parece: la <b>empresa de desarrollo</b>, que vive de "
      "entregar proyectos a terceros y necesita separación estricta entre clientes; y la "
      "<b>empresa con un área de desarrollo</b>, que construye para sí misma y necesita "
      "que ese área se entienda desde fuera."),
("p", "El aislamiento entre organizaciones no es una función más para el primer perfil: "
      "es la condición para poder usarlo. Por eso está construido en la base de datos "
      "desde el primer día y no como un filtro en el código."),
("p", "Y hay un tercer perfil que no paga y que importa igual: la persona que trabaja "
      "sola o con dos amigos. Es quien más sufre la dispersión y quien menos "
      "herramientas tiene para pelearla."),

("h2", "5. Qué existe hoy"),
("p", "DevUP no empieza de cero. Escrito a partir del código y no de lo que prometían "
      "los planes: hay <b>119 puntos de API</b> en 18 módulos, <b>42 tablas</b> con "
      "política de aislamiento en todas, <b>20 migraciones</b>, <b>16 pantallas</b>, y "
      "<b>156 comprobaciones de aislamiento entre organizaciones</b> en verde en cada "
      "cambio."),
("p", "De las tres promesas del producto, dos están completas y en producción: el "
      "<b>espacio de trabajo</b> —organizaciones, canales, mensajería, llamadas con "
      "voz, vídeo y pantalla compartida, grabación con consentimiento, biblioteca de "
      "archivos, tablero de tareas, búsqueda global— y el <b>control de ventas</b> "
      "—servicios, clientes, embudo, cotizaciones y objetivos—."),
("p", "La tercera —infraestructura y agentes— está empezada: hay bóveda de credenciales "
      "cifrada, conector de GitHub, música compartida por canal y un entorno de "
      "desarrollo embebido en fase inicial. Existe además <b>DevVerse</b>, el espacio "
      "recorrible con avatares, funcional y en beta."),
("p", "Lo que falta es lo que ocupa la segunda mitad de este documento."),

("h2", "6. Cómo se sostiene"),
("p", "La idea es sencilla: <b>quien trabaja solo o casi solo, no paga</b>. Un equipo de "
      "hasta cuatro personas tiene la plataforma completa sin coste. No es generosidad: "
      "es el canal de entrada. Ese equipo es exactamente quien más siente el problema, y "
      "es quien lo va a contar cuando crezca."),
("p", "A partir de ahí, por persona y mes. Los precios de abajo son una <b>estimación "
      "para validar</b>, no una tarifa cerrada."),
("table", [
    ["Plan", "Precio", "Qué incluye"],
    ["Libre", "0 USD",
     "Hasta 4 personas, una organización. Espacio de trabajo completo, llamadas, "
     "archivos, tareas y DevVerse. Un conector."],
    ["Equipo", "≈ 12 USD / persona / mes",
     "Sin tope de personas. Conectores sin límite, bóveda de credenciales, "
     "integraciones guiadas y vista de infraestructura."],
    ["Empresa", "≈ 24 USD / persona / mes",
     "Agentes, roles y auditoría, base de datos como código, inicio de sesión "
     "corporativo y soporte."],
    ["Consumo de agente", "Medido, aparte",
     "Se factura lo que consume, con el gasto visible por organización."],
]),
("h3", "Por qué esos números"),
("p", "Las herramientas que DevUP reúne se pagan hoy por separado, y cada una está en el "
      "orden de entre 7 y 20 dólares por persona y mes: el gestor de tareas, la "
      "mensajería, el espacio virtual, el asistente de código. Doce dólares por el "
      "conjunto queda por debajo de la suma de lo que sustituye, que es la única "
      "comparación que un comprador hace de verdad. El salto a Empresa lo justifican tres "
      "cosas que solo importan cuando hay varios clientes o varios equipos: los agentes, "
      "la auditoría y el aislamiento verificable."),
("p", "El consumo de agente va aparte por honestidad y por supervivencia: tiene un coste "
      "variable real por cada petición. Meterlo en una tarifa plana obliga a una de dos, "
      "y las dos son malas: encarecer a todos para cubrir a los pocos que lo usan mucho, "
      "o poner un tope silencioso que la gente descubre el peor día."),
("p", "Queda para más adelante, y como idea sin cerrar, la venta de artículos cosméticos "
      "para DevVerse. Hoy no entra en el plan."),

("pagebreak",),
("kicker", "Parte II"),
("h1", "Plan de desarrollo"),

("h2", "7. El punto de partida: la interfaz creció por acumulación"),
("p", "Antes de decidir qué añadir conviene decir con precisión qué pasa con lo que ya "
      "hay, porque cambia el orden del trabajo."),
("p", "El <b>sistema visual está bien hecho</b>: hay cuatro niveles de superficie, tres "
      "familias tipográficas con un trabajo cada una, curvas y duraciones de animación "
      "con nombre, tres materiales y tres reglas escritas que explican el resto. Está "
      "atendido el movimiento reducido y la transparencia reducida. Eso no se toca."),
("p", "Lo que no existe es <b>la capa de encima</b>: el armazón, el marco de página y la "
      "navegación entre pantallas. Cada funcionalidad llegó como una pantalla completa e "
      "independiente, y ninguna llegó como una pieza dentro de un marco, porque el marco "
      "nunca se escribió. Dieciséis veces seguidas."),
("p", "Contado con números del código de hoy: las tarjetas se rehacen a mano <b>88 "
      "veces</b> frente a 23 que usan la primitiva; hay <b>55 botones crudos</b> frente "
      "a 97 que usan la del sistema; hay <b>12 desplegables y áreas de texto</b> "
      "escritos uno a uno porque no existe primitiva que importar; y las <b>ocho "
      "acciones irreversibles</b> del producto —borrar un cliente, quitar a alguien de "
      "la organización, desconectar una cuenta— se deciden en el cuadro gris del sistema "
      "operativo, sin el nombre del producto y sin el peligro marcado."),
("p", "La misma cabecera está copiada en cinco pantallas, y ya ha derivado: cuatro "
      "llaman «Organizaciones» al enlace de vuelta y una lo llama «Workspaces» —el mismo "
      "enlace, al mismo sitio, con dos nombres—. No existe armazón de organización, así "
      "que para ir de Ventas a GitHub hay que volver al inicio y volver a entrar. Y hay "
      "<b>33 puntos de ruptura responsive en dieciséis pantallas</b>, con una barra "
      "lateral de ancho fijo: el producto no es que se vea mal en un teléfono, es que no "
      "está construido para que exista un teléfono."),
("quote", "Todas las interfaces se van a rehacer. No el estilo —que está bien— sino el "
          "armazón que nunca se construyó debajo."),

("h2", "8. Lo que hay que hacer"),
("p", "En orden, y con el motivo del orden. La regla es siempre la misma: primero lo que "
      "protege lo que ya existe, después lo que abarata lo siguiente, y al final lo que "
      "solo hace falta cuando duela."),

("h3", "A · Que nada se pierda"),
("p", "Nada de esto añade una función y todo esto evita perder lo que ya hay. Hoy hay "
      "usuarios reales, una organización con su historia dentro, grabaciones de llamadas "
      "y credenciales de terceros cifradas, y <b>no hay ninguna copia de seguridad</b>. "
      "Si el disco falla esta noche no se pierde una demo: se pierde el producto."),
("bullets", [
    "Copias de seguridad de la base de datos y del almacén, fuera de esa máquina, con "
    "retención y con una restauración probada. Una copia que nadie ha restaurado no es "
    "una copia.",
    "Registrar el ejecutor de despliegue, que está descargado y sin configurar, de modo "
    "que los despliegues dejen de hacerse a mano.",
    "Servidor de correo real. Hoy las invitaciones y las recuperaciones de contraseña se "
    "escriben en el registro del servidor en vez de enviarse: sirve para probar y no "
    "sirve para usar.",
    "Custodia y procedimiento de rotación de la clave maestra de la bóveda. Si se pierde, "
    "todas las credenciales guardadas quedan indescifrables para siempre.",
]),

("h3", "B · Cerrar lo que quedó a medias"),
("p", "Cosas empezadas que hoy cuestan más abiertas que cerradas: fusionar el arreglo de "
      "servidor que lleva días en una rama, levantar o contratar el servidor de retransmisión "
      "que hace que las llamadas se oigan fuera de una red local, sacar la integración de "
      "música del modo de desarrollo, y explicar en la interfaz por qué falla a veces "
      "añadir un repositorio —que casi nunca es un fallo nuestro, pero lo parece—."),

("h3", "C · Pruebas que abren un navegador"),
("p", "La integración continua ya cubre lo difícil en cada cambio: tipos, migraciones, "
      "aislamiento entre organizaciones y construcción. Lo que no cubre es nada que abra "
      "un navegador, y ahí es donde viven los fallos que ninguna prueba de tipos puede "
      "ver. El ejemplo lo tenemos: el almacén de archivos nunca llegaba a crearse y pasó "
      "meses sin detectarse, porque solo se manifestaba a mitad de una subida real."),
("p", "La trampa a evitar: una prueba de navegador que falla a veces es peor que ninguna, "
      "porque enseña al equipo a ignorar el rojo. Mejor cinco estables que veinte "
      "inestables."),

("h3", "I · La interfaz: armazón, marco, datos y móvil"),
("p", "Es la respuesta al diagnóstico del apartado 7, y va antes de las pantallas nuevas "
      "por un motivo de coste: la pantalla nueva más grande que queda, si se construye "
      "hoy, sale con su séptima cabecera copiada, su propio código de carga, su propio "
      "desplegable y su propio aviso de error. Y después habrá que migrarla igual, con la "
      "diferencia de que entonces estará en producción."),
("bullets", [
    "<b>Armazón de organización</b>, con la misma factura que el del espacio de trabajo, "
    "y naciendo con cajón para móvil en vez de con una barra fija que luego haya que "
    "desmontar.",
    "<b>Marco de página</b>: un componente que recibe título, rótulo, icono y acciones, y "
    "mata las cinco cabeceras copiadas. Con él, los tres finales posibles de una carga "
    "—cargando, fallo, vacío— dejan de improvisarse en cada pantalla.",
    "<b>Las primitivas que faltan</b>: desplegable, área de texto, menú, pestañas, tabla "
    "y, sobre todo, el diálogo de confirmación que sustituye a los ocho cuadros del "
    "sistema operativo. Es el punto con mejor relación entre esfuerzo y resultado de "
    "todo el plan.",
    "<b>Capa de datos</b>: hoy hay 88 llamadas a la API y 71 efectos escritos "
    "directamente en las pantallas, sin caché, así que volver a una pantalla la recarga "
    "entera. Con una pieza pequeña y propia se acaba esa repetición y se escribe de paso "
    "la regla de errores: el error de un campo va junto al campo, el de una acción va en "
    "un aviso flotante.",
    "<b>Partir las pantallas grandes</b>. La de ventas tiene 1.273 líneas y contiene la "
    "pantalla, sus subcomponentes, sus formularios y su estado. No se puede reutilizar, "
    "ni probar por separado, ni tocar entre dos personas la misma semana.",
    "<b>Muestrario y teclado</b>: una pantalla de desarrollo con todas las primitivas en "
    "todos sus estados —es donde se ve que dos componentes han derivado antes de que lo "
    "vea un usuario— y una paleta de comandos que hace que navegar dieciséis pantallas "
    "deje de doler.",
]),

("h3", "D · Vista unificada de infraestructura"),
("p", "Entornos y despliegues del cliente en una sola pantalla, sobre la bóveda que ya "
      "existe. Cierra la tercera promesa y es lo que más se ve. Y vale doble por un "
      "motivo que no es evidente: es lo que enciende los muebles que están puestos en "
      "DevVerse y no hacen nada —la pantalla de despliegue y el rack de servidores—, que "
      "hoy son decorado."),

("h3", "Integraciones guiadas"),
("p", "La pieza más diferenciadora del producto, y la que menos cuesta enseñar. La forma "
      "corta es esta: «Estás guardando sesiones a mano. Supabase te da autenticación, "
      "base de datos y almacenamiento. ¿Lo monto?» — y si la persona dice que sí, el "
      "trabajo ocurre detrás: crear el proyecto, guardar las claves en la bóveda, "
      "escribir el esquema, conectar el protocolo de contexto y avisar."),
("p", "El diagnóstico de partida está infravalorado: mucha gente no ha descartado esas "
      "herramientas, es que <b>no sabe que existen</b>. Un catálogo donde buscas lo que "
      "ya sabes que quieres no arregla eso; un producto que dice «para lo que estás "
      "haciendo, esto te ahorraría tanto», sí."),

("h3", "Agentes"),
("p", "Aquí sí hay carrera y va rápida. Pero las herramientas que existen son de "
      "escritorio y para una persona: no tienen organización, ni roles, ni canales, ni "
      "bóveda compartida, ni aislamiento entre clientes. DevUP tiene las seis cosas "
      "hechas y probadas."),
("p", "El hueco es <b>el agente en equipo</b>: no «un agente que trabaja por mí» sino uno "
      "que trabaja para la organización, con sus credenciales, y cuyo resultado ve y "
      "aprueba el equipo. Antes de escribir código hay que decidir dos cosas: qué puede "
      "tocar un agente y con qué credenciales. La respuesta al primero probablemente sea "
      "el aislamiento por copia de trabajo, que es lo que hace que dos agentes no se "
      "pisen; la del segundo es la bóveda, y por eso conviene que llegue después de que "
      "la vista de infraestructura la haya puesto a prueba con algo más que dos "
      "conectores."),
("p", "Y una regla de producto que no es negociable: <b>el agente propone y la persona "
      "aprueba</b>. El cambio se revisa dentro de DevUP antes de que salga."),

("h3", "Base de datos como código"),
("p", "Migraciones del cliente sincronizadas con su repositorio, con el mismo criterio "
      "que ya aplicamos aquí: solo se añaden, son idempotentes, y la política de "
      "aislamiento es parte de la migración y no un paso aparte. Hay una ventaja injusta "
      "que conviene aprovechar: ese criterio ya existe y se aprendió a base de un fallo "
      "silencioso que costó una migración entera encontrar. Ese criterio es el producto, "
      "no un detalle interno."),

("h3", "Identidad propia y apertura"),
("p", "Identidad de DevUP y la apertura a gente de fuera del equipo. No se puede empezar "
      "sin el bloque A: abrir a usuarios ajenos un sistema sin copias de seguridad y sin "
      "correo real no es una beta, es pedirle a alguien que se registre por un enlace que "
      "no le llega para guardar su trabajo en un disco que nadie respalda."),

("h3", "Escalar, cuando toque"),
("p", "Nada de esto hace falta hoy y hacerlo antes de tiempo es trabajo tirado. Va "
      "escrito para que cuando duela se sepa dónde mirar: un almacén compartido para "
      "presencia y límites de peticiones, el día que haya una segunda instancia de la "
      "API; y el reparto de la malla de voz dentro de una misma sala, que hoy resuelve "
      "veinte personas en cuatro salas pero no doce en una."),

("h2", "9. Las tres superficies"),
("p", "La plataforma tiene que existir en web, en escritorio y en móvil. No son tres "
      "proyectos."),
("h3", "Web, con el responsive bien hecho"),
("p", "Es la base y es requisito de las otras dos. Hoy no existe, y por eso el armazón "
      "del bloque I nace con cajón en vez de con una barra de ancho fijo: construirlo dos "
      "veces es justo lo que este plan existe para evitar."),
("h3", "Escritorio"),
("p", "Envolver la web para tener un icono no vale la pena. Lo que solo puede hacer una "
      "aplicación de escritorio, sí: <b>abrir los repositorios de verdad en el disco y "
      "ejecutar procesos de verdad</b>, en vez del entorno embebido que corre dentro del "
      "navegador con sus límites. Ese es el salto, y es además donde está la competencia. "
      "Añade también notificaciones del sistema —que la integración continua en rojo "
      "llegue sin tener la pestaña abierta— y presencia real."),
("h3", "Móvil"),
("p", "La misma tecnología compila a móvil, así que la web bien hecha es la mayor parte "
      "de las tres. Conviene saber que el soporte móvil de esa tecnología es bastante "
      "más joven que el de escritorio, y probarlo con algo pequeño antes de apostar el "
      "calendario."),
("p", "Y conviene tener claro cuál es la función móvil que de verdad importa, porque no "
      "es «todo más pequeño»: es <b>aprobar</b>. El agente propone, la persona va en el "
      "autobús y da el visto bueno. Es corta, es frecuente y es exactamente lo que un "
      "teléfono hace bien."),
("p", "Lo que no baja a móvil es DevVerse. Un espacio recorrible en un teléfono no es la "
      "misma cosa hecha más pequeña."),

("h2", "10. Cuatro decisiones técnicas ya tomadas"),
("p", "Cuatro puntos del proyecto se estudiaron a fondo porque condicionan lo que se "
      "puede construir. Quedan cerrados así."),

("h3", "La música compartida no puede sonar sincronizada entre plataformas"),
("p", "No es cuestión de esfuerzo. Reproducir en el navegador exige una suscripción de "
      "pago por oyente en un servicio, un programa de desarrollador de pago en otro, y en "
      "un tercero no hay interfaz oficial. No existe ninguna forma de que dos personas en "
      "servicios distintos estén en el mismo segundo de la misma canción."),
("p", "Lo que sí se puede, y es casi todo lo que se quería: la cola es <b>agnóstica</b>. "
      "Se guarda la canción —su identificador internacional de grabación, título y "
      "artista—, no el enlace de un servicio, y cada persona la reproduce en el suyo. Se "
      "gana una sola lista de verdad; se pierde la escucha simultánea al segundo. Y "
      "guardar la canción en vez del enlace es lo correcto aunque solo hubiera un "
      "servicio: el enlace es de una plataforma, la canción es del equipo."),

("h3", "El encuentro por cercanía no rompe el cifrado"),
("p", "Las llamadas van cifradas de extremo a extremo y esa decisión no se reabre. La "
      "idea de que acercarse a alguien encienda la cámara automáticamente sí chocaba con "
      "ella: en un espacio con mucha gente el vídeo obliga a un servidor de medios en "
      "medio, que es exactamente lo que rompería el cifrado."),
("p", "La versión acordada no tiene ese problema, y además es mejor diseño. Acercarse abre "
      "un menú —<i>saludar</i> o <i>llamar</i>—, y las cámaras se encienden solo si los "
      "dos aceptan. Una llamada individual son dos navegadores y una sola conexión, "
      "cifrada por definición, sin nada en medio. La pizarra compartida va por el canal "
      "de datos de esa misma conexión, así que <b>el servidor nunca ve lo que se "
      "dibuja</b>, y guardarla funciona como ya funciona grabar: uno de los dos exporta y "
      "sube el resultado."),

("h3", "La gamificación se puntúa por ritos de calidad, no por volumen"),
("p", "Puntuar volumen —confirmaciones de código, líneas, tareas cerradas— produce "
      "exactamente lo que se puntúa: muchas confirmaciones pequeñas, tareas troceadas, y "
      "la persona que arregló el fallo difícil en tres líneas la última de la tabla."),
("p", "Se puntúan en cambio los ritos que cuestan y que nadie quiere hacer: una migración "
      "con su política de aislamiento y su caso de prueba, una revisión de código con "
      "comentarios de fondo, un fallo con prueba de regresión, la integración continua "
      "devuelta a verde. Sin clasificación pública individual, y con recompensa siempre "
      "cosmética: en cuanto los puntos abren puertas, dejan de ser un juego."),
("p", "Eso resuelve además el riesgo obvio, que es que dos personas se monten una "
      "organización, se inventen tareas y se las marquen como hechas. La defensa no está "
      "en separar niveles por organización —eso reparte el problema en vez de "
      "impedirlo— sino en <b>qué acuña moneda</b>: solo un hecho que la plataforma pueda "
      "verificar contra un sistema externo que la persona no controla. Marcar una tarea "
      "no acuña nada. Una integración continua en verde sobre un repositorio real no se "
      "puede falsificar."),

("h3", "No construimos infraestructura de despliegue propia"),
("p", "Sería competir con los proveedores grandes en su terreno y con su curva de costes, "
      "y contradice el posicionamiento del apartado 3. Lo coherente es <b>orquestar</b>: "
      "guardar la credencial en la bóveda, disparar el despliegue en la plataforma que el "
      "cliente ya usa, y enseñar el estado en una sola pantalla."),

("h2", "11. DevVerse"),
("p", "DevVerse es el espacio recorrible con avatares: salas, zonas, muebles, audio por "
      "cercanía. Conviene decir qué papel juega, porque es la parte del producto que más "
      "fácil se malinterpreta."),
("p", "La categoría de oficinas virtuales existe desde hace años y no le ha ido bien a "
      "nadie: su referente se escindió en 2026 como pyme sin capital riesgo. Pero todas "
      "fracasaron prometiendo lo mismo —ser el sustituto de la oficina, «vente aquí a "
      "estar»—. DevVerse no promete eso. Es <b>la recompensa y la cara social de un "
      "producto de trabajo que ya funciona sin él</b>."),
("p", "De ahí sale la decisión que ordena lo demás: la plataforma y DevVerse se separan "
      "en dos mundos, con un contrato mínimo entre ellos —<b>el trabajo genera puntos, "
      "los puntos se gastan en DevVerse</b>— y nada más cruza. Que el contrato sea "
      "pequeño es lo que hace la separación real y no un dibujo: hoy los dos comparten "
      "sesión, socket y media barra lateral, y por eso tocar uno rompe el otro. Es "
      "también lo que permite que la plataforma baje a móvil sin arrastrarlo."),
("p", "Un hallazgo que cambia el presupuesto de todo este apartado: el mundo <b>ya está "
      "amueblado</b>. Hay 55 muebles dibujados, y entre ellos están la máquina "
      "recreativa, el futbolín, la mesa de mezclas, el estante de discos, la pizarra, la "
      "vitrina de trofeos y el mobiliario completo de un apartamento. Y el avatar ya es "
      "un catálogo de índices por capas. Casi nada de lo que se quiere hacer pide dibujar "
      "un mundo nuevo: pide <b>enchufar el que hay</b>. La tienda de ropa, por ejemplo, "
      "es una tabla de desbloqueos sobre un catálogo que ya existe."),
("p", "Lo que sí falta, y es el trabajo real: el menú al acercarse, la pizarra, la "
      "economía de monedas con su libro de cuentas, los atuendos guardados por "
      "organización, y la cartelera sobre cada personaje con nombre, rol y estado. De los "
      "estados, el que importa es el tercero —<b>ocupado, pero abierto a llamadas</b>—, "
      "que ninguna herramienta de trabajo tiene y que es la verdad la mayor parte del "
      "tiempo."),

("h2", "12. Riesgos, y lo que no se toca"),
("bullets", [
    "<b>Una tabla nueva sin política de aislamiento.</b> El aislamiento falla en "
    "silencio: no da error, devuelve cero filas y sigue. Ya pasó una vez y costó una "
    "migración encontrarlo. Toda tabla nueva necesita su política y su caso de prueba, y "
    "toda actualización que importe comprueba cuántas filas tocó, no que no haya "
    "excepción.",
    "<b>La clave maestra de la bóveda.</b> Si cambia o se pierde, todas las credenciales "
    "guardadas quedan indescifrables. Es el bloque A y va antes de que la bóveda guarde "
    "nada más.",
    "<b>El despliegue automático y la carpeta de trabajo.</b> Con el ejecutor activo, una "
    "edición a medio hacer puede irse a producción sin estar confirmada. O se asume, o el "
    "despliegue pasa a clonar aparte.",
    "<b>Pruebas de navegador inestables.</b> Cinco estables antes que veinte que fallan a "
    "veces.",
    "<b>La entrada al entorno de desarrollo embebido</b> necesita una navegación dura por "
    "el aislamiento que exige el navegador. Convertirla en un enlace normal lo rompe, y "
    "no es evidente por qué.",
]),
("p", "Y una zona restringida: el sistema visual base y el interior de DevVerse no se "
      "tocan de camino a otra cosa. Se tocan cuando se pidan, con las referencias "
      "delante."),

("h2", "13. Lo que falta decidir"),
("bullets", [
    "Dónde van las copias de seguridad. Una copia en el mismo disco no protege del caso "
    "que importa, y es la única decisión que bloquea el bloque A entero.",
    "Si el servidor de retransmisión de voz se levanta o se contrata.",
    "Los tres ritos concretos que acuñan moneda al empezar, y el techo semanal por "
    "persona. Es media hora de conversación y define la economía entera.",
    "El tamaño definitivo del avatar y cuántos cuerpos base hay de salida.",
    "Si el tema claro entra ahora —que son unos cuantos valores de color— o no entra "
    "nunca. Dentro de seis pantallas más deja de ser barato.",
]),

("pagebreak",),
("kicker", "Parte III"),
("h1", "Bocetos del avatar"),
("p", "Las imágenes que siguen son <b>bocetos</b>, no el personaje definitivo ni el "
      "acabado con el que saldría. Están para fijar la dirección y para poder discutir "
      "sobre algo concreto en vez de sobre una descripción."),
("p", "La decisión que ilustran sí es firme: el personaje se <b>modela en tres "
      "dimensiones</b> —con volumen, esqueleto y luz reales— y lo que entra al juego es "
      "un <b>render</b> de ese modelo. El motor sigue siendo el mismo lienzo de dos "
      "dimensiones que ya existe, así que ni el renderizador ni la red se enteran."),
("p", "Esa tubería es lo que hace viable el catálogo que se quiere: las cuatro "
      "direcciones salen de girar el modelo y volver a renderizar, el andar sale del "
      "esqueleto en vez de dibujarse fotograma a fotograma, y una prenda nueva se modela "
      "una vez en vez de dibujarse a mano en cuatro vistas. Con diez o quince skins y "
      "varias piezas por accesorio, esa diferencia es la que decide si el catálogo es "
      "posible."),
("p", "El render de estas páginas está hecho con volúmenes simples, así que la cabeza se "
      "ve cúbica y el pelo es un casquete. Con una herramienta de modelado real el mismo "
      "personaje lleva la forma esculpida y la silueta trabajada: <b>cambia la calidad "
      "del modelo, no la tubería ni lo que el juego recibe</b>."),
]
