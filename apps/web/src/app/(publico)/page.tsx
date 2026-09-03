import Link from "next/link";
import { Companero } from "@/components/landing/Companero";
import { Planes } from "@/components/landing/Planes";
import { Teatro } from "@/components/landing/Teatro";
import { RUTA_ACCESO, RUTA_REGISTRO } from "@/lib/landing/planes";

/**
 * La página inicial de DevUP.
 *
 * Es un componente de SERVIDOR: se lee entera sin JavaScript. Lo único que
 * llega al cliente son tres islas —el conmutador de ciclo, el colapso de
 * ventanas y el acompañante—, y ninguna de las tres hace falta para entender
 * la página ni para registrarse.
 *
 * EL ORDEN ES UN ARGUMENTO. Problema, tesis, a quién le duele, qué existe ya,
 * de qué lado estamos, dónde vive el mundo, y solo entonces el precio: puesto
 * arriba, un visitante que aún no entiende el producto solo ve un número y se
 * va; puesto aquí, lo compara con lo que acaba de leer.
 */
export default function Landing() {
  return (
    <>
      <Companero />

      <div className="hoja">
        <header className="barra">
          <span className="marca">DevUP</span>
          <nav className="navBarra">
            <a href="#producto">Producto</a>
            <a href="#devverse">DevVerse</a>
            <a href="#planes">Planes</a>
          </nav>
          <Link className="btn btnMd btnLinea" href={RUTA_ACCESO}>
            Entrar
          </Link>
        </header>

        <section className="portada">
          <h1 className="titular">
            Seis ventanas.
            <br />
            <span className="acento">Un sitio.</span>
          </h1>
          <p className="bajada">
            El repositorio, la base de datos, el despliegue, el agente y la conversación. El estado
            se deduce de lo que pasó, no de lo que alguien anotó.
          </p>
          <div className="acciones">
            <Link className="btn btnLg btnSolido" href={RUTA_REGISTRO}>
              Empezar gratis
            </Link>
            <a className="btn btnLg btnLinea" href="#producto">
              Ver la demo
            </a>
          </div>
          {/* Los números van sobre el pliegue porque son lo único de la página
              que un comprador no puede fabricar. Salen contados contra el
              código, no contra lo que prometían los planes. */}
          <div className="pruebas">
            <span className="prueba">
              <b className="num">134</b>
              <span className="eti">puntos de API</span>
            </span>
            <span className="prueba">
              <b className="num">44/45</b>
              <span className="eti">tablas aisladas</span>
            </span>
            <span className="prueba">
              <b className="num">231</b>
              <span className="eti">comprobaciones en verde</span>
            </span>
          </div>
        </section>

        <Teatro />

        <section className="tramo" data-tramo="problema">
          <div className="encabezado">
            <span className="eti">01 — El problema</span>
            <h2>No es que falten herramientas. Es que no se hablan.</h2>
          </div>
          <p className="parrafo">
            Un estudio de <strong>Harvard Business Review</strong> instrumentó a 137 personas de
            veinte equipos durante cinco semanas: cambian de aplicación o de pestaña{" "}
            <strong>unas 1.200 veces al día</strong>. Cada salto cuesta poco más de dos segundos,
            pero el acumulado son <strong>casi cuatro horas a la semana</strong> —el 9 % de la
            jornada— dedicadas solo a reorientarse.
          </p>
          <p className="menor">
            Y lo que se pierde en cada salto no es solo tiempo: es el contexto, que hay que
            reconstruir del otro lado. El enemigo de este producto no es una empresa. Es la pérdida
            de contexto entre ventanas.
          </p>
        </section>

        <section className="tramo" data-tramo="tesis">
          <div className="encabezado">
            <span className="eti">02 — La tesis</span>
            <h2>No gestionamos la tarjeta. Gestionamos el desarrollo.</h2>
          </div>
          <p className="parrafo">
            Un gestor de proyectos administra <strong>la representación</strong> del trabajo:
            tarjetas que describen algo que pasa en otro sitio y que alguien tiene que acordarse de
            mover. La tarjeta y el código no se tocan nunca.
          </p>
          <p className="parrafo">
            DevUP vive en el otro lado. Una integración continua en rojo abre una tarea sola. Un
            despliegue se ve sin entrar al panel del proveedor. Un agente trabaja con las
            credenciales de la organización y su resultado lo revisa el equipo.
          </p>
        </section>

        <section className="tramo" data-tramo="perfiles">
          <div className="encabezado">
            <span className="eti">03 — A quién le duele</span>
            <h2>Tres formas de perder el mismo día</h2>
          </div>
          <div className="perfiles">
            <div className="perfil">
              <span className="eti">Trabaja solo</span>
              <h3>Cambias de pestaña 1.200 veces al día</h3>
              <p>
                Nadie a quien pedirle contexto y seis ventanas que no se hablan. Cada salto cuesta
                dos segundos; la suma, cuatro horas a la semana.
              </p>
              <p className="alivio">
                <b>Una sola pestaña</b>, gratis, para siempre. El espacio de trabajo entero y un
                conector.
              </p>
            </div>
            <div className="perfil">
              <span className="eti">Lidera un equipo</span>
              <h3>Pierdes el día respondiendo «¿en qué va el sprint?»</h3>
              <p>
                La información existe, pero repartida en seis sitios. Antes de cada reunión hay que
                pedirla a mano y montarla.
              </p>
              <p className="alivio">
                <b>El estado se deduce</b> de lo que pasó. Una integración en rojo abre una tarea
                sola.
              </p>
            </div>
            <div className="perfil">
              <span className="eti">Decide la compra</span>
              <h3>Pagas licencias que no se hablan entre sí</h3>
              <p>
                Visibilidad partida entre proyectos y clientes, y developers nuevos que tardan
                semanas en aprenderse el stack.
              </p>
              <p className="alivio">
                <b>172 pruebas automáticas</b> verifican que una organización no ve nada de otra.
              </p>
            </div>
          </div>
        </section>

        <section className="tramo" data-tramo="producto" id="producto">
          <div className="encabezado">
            <span className="eti">04 — Lo que ya funciona</span>
            <h2>Escrito a partir del código, no de lo que prometían los planes</h2>
          </div>
          <p className="parrafo">
            Dos de las tres promesas del producto están <strong>completas y en producción</strong>:
            el espacio de trabajo —organizaciones, canales, mensajería, llamadas con voz, vídeo y
            pantalla compartida, grabación con consentimiento, biblioteca de archivos, tablero de
            tareas y búsqueda global— y el control de ventas, con servicios, clientes, embudo,
            cotizaciones y objetivos.
          </p>
          <p className="parrafo">
            La tercera, la infraestructura, ya está en pie: sobre una bóveda de credenciales cifrada
            hay tres piezas desplegadas —la vista de entornos y despliegues, la base de datos como
            código y las integraciones guiadas—.
          </p>
          <p className="menor">
            <strong>El aislamiento entre organizaciones no es una función: es la condición para
            poder usarlo.</strong> Por eso está en la base de datos desde el primer día y no como un
            filtro en el código, y por eso 172 de las 231 comprobaciones automáticas no hacen otra
            cosa que intentar romperlo.
          </p>
        </section>

        <section className="tramo" data-tramo="aliados">
          <div className="encabezado">
            <span className="eti">05 — La postura</span>
            <h2>Aliados, no competencia</h2>
          </div>
          <p className="parrafo">
            GitHub, Supabase, Vercel y los gestores de proyectos son{" "}
            <strong>el sustrato sobre el que corre DevUP</strong>, no la plaza que se le disputa. Si
            el enemigo es la dispersión, cada plataforma integrada es una victoria y no un rival.
          </p>
          <div className="aliados">
            <span>GitHub</span>
            <span>Supabase</span>
            <span>Vercel</span>
            <span>Slack</span>
            <span>Linear</span>
            <span>MCP</span>
          </div>
        </section>

        <section className="tramo" data-tramo="devverse" id="devverse">
          <div className="encabezado">
            <span className="eti">06 — DevVerse</span>
            <h2>Y una trastienda donde el trabajo se convierte en algo</h2>
          </div>
          <p className="parrafo">
            Un espacio recorrible con avatares, cartelera de estados, encuentro por cercanía y
            pizarra compartida. <strong>Nadie entra a DevUP para estar en DevVerse</strong>: entra a
            trabajar, y DevVerse es donde eso se convierte en algo.
          </p>
          <p className="menor">
            Tu guía de esta página vive ahí. Es el mismo avatar, con las mismas proporciones que
            usa el mundo — muévelo con las flechas si quieres.
          </p>
        </section>

        <section className="tramo" data-tramo="planes" id="planes">
          <div className="encabezado">
            <span className="eti">07 — Planes</span>
            <h2>Cuatro planes. El primero, gratis para siempre.</h2>
          </div>
          <p className="parrafo">
            <strong>Hoy pagas entre 27 y 34 USD por persona y mes</strong> para tener tareas,
            mensajería y espacio virtual por separado — Jira 7,91 más Slack 7,25 más Kumospace
            12,80. Con asistente de código, por encima de 45.
          </p>
          <Planes />
          <p className="menor">
            Los importes son <strong>bandas recomendadas y no tarifa cerrada</strong>: salen de 22
            entrevistas de sensibilidad al precio y del coste de lo que DevUP sustituye. Se
            confirman antes de cobrar a nadie.
          </p>
        </section>

        <section className="cierre">
          <span className="eti">Empieza hoy</span>
          <h2>Una persona, una organización, cero euros.</h2>
          <p className="parrafo">
            Sin tarjeta y sin límite de tiempo. Cuando seáis más de uno, ya hablamos.
          </p>
          <div className="acciones">
            <Link className="btn btnLg btnSolido" href={RUTA_REGISTRO}>
              Empezar gratis
            </Link>
            <Link className="btn btnLg btnLinea" href={RUTA_ACCESO}>
              Entrar
            </Link>
          </div>
        </section>

        <footer className="pie">
          <span>DevUP — un producto de Hytrex</span>
          <span>
            <Link href={RUTA_ACCESO}>Entrar</Link> · <Link href={RUTA_REGISTRO}>Crear cuenta</Link>
          </span>
        </footer>
      </div>
    </>
  );
}
