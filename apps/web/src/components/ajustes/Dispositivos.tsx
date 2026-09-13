"use client";

import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import {
  elegirDe,
  guardarDispositivo,
  nombreDe,
  restriccionPara,
  type ClaseDeDispositivo,
  type Dispositivo,
} from "@/lib/dispositivos";

/**
 * Elegir el micrófono y la cámara, y PROBARLOS.
 *
 * QUÉ HABÍA ANTES: un desplegable de micrófonos dentro de la sala de voz, que
 * solo aparecía si había más de uno, sin forma de probar nada y sin recordar la
 * elección — al entrar a la siguiente llamada volvía al del sistema. O sea que
 * la única manera de descubrir que estabas con el micrófono de la webcam era
 * estar ya dentro, hablando, delante de gente.
 *
 * LO QUE ARREGLA ESTA PANTALLA ES EL ORDEN. Probar antes de entrar cuesta diez
 * segundos; descubrirlo dentro cuesta la reunión de todos. Por eso el medidor
 * no es decoración: es la única forma de saber que el micrófono que dice
 * «Jabra» es el que de verdad recoge tu voz, y no uno que se llama igual y está
 * apagado.
 *
 * SE PIDE PERMISO AL PULSAR Y NO AL ABRIR. Una pantalla de ajustes que enciende
 * la cámara sola es exactamente lo que nadie quiere, y además el navegador
 * oculta los nombres de los dispositivos hasta que se concede permiso — así que
 * hasta entonces la lista sería de huecos en blanco. Se dice, y se ofrece el
 * botón.
 *
 * TODO SE APAGA AL SALIR. Un `MediaStream` que sobrevive a la pantalla deja la
 * luz de la cámara encendida, y eso, con razón, asusta.
 */
export function Dispositivos() {
  return (
    <Tarjeta className="p-4">
      <Rotulo>Micrófono y cámara</Rotulo>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Se guardan en este navegador, no en tu cuenta: el micrófono es de la mesa
        en la que estás, no tuyo. En otro ordenador vuelves a elegir.
      </p>

      <div className="mt-4 space-y-4">
        <Prueba clase="microfono" />
        <div className="border-t border-line pt-4">
          <Prueba clase="camara" />
        </div>
      </div>
    </Tarjeta>
  );
}

const TEXTOS: Record<
  ClaseDeDispositivo,
  { titulo: string; probar: string; parar: string; sinPermiso: string }
> = {
  microfono: {
    titulo: "Micrófono",
    probar: "Probar el micrófono",
    parar: "Dejar de escuchar",
    sinPermiso:
      "Para elegir hace falta dar permiso: hasta entonces el navegador no dice ni cómo se llaman.",
  },
  camara: {
    titulo: "Cámara",
    probar: "Probar la cámara",
    parar: "Apagar la cámara",
    sinPermiso:
      "Para elegir hace falta dar permiso: hasta entonces el navegador no dice ni cómo se llaman.",
  },
};

function Prueba({ clase }: { clase: ClaseDeDispositivo }) {
  const textos = TEXTOS[clase];
  const [disponibles, setDisponibles] = useState<Dispositivo[]>([]);
  const [elegido, setElegido] = useState<string>("");
  const [encendido, setEncendido] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nivel, setNivel] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const cuadro = useRef<number | null>(null);

  /**
   * Apagar del todo.
   *
   * En su propia función porque hay que llamarla desde tres sitios —el botón,
   * el cambio de dispositivo y el desmontaje— y olvidarse en uno solo deja la
   * cámara encendida.
   */
  const apagar = useCallback(() => {
    if (cuadro.current !== null) cancelAnimationFrame(cuadro.current);
    cuadro.current = null;
    void audio.current?.close();
    audio.current = null;
    for (const pista of stream.current?.getTracks() ?? []) pista.stop();
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setNivel(0);
    setEncendido(false);
  }, []);

  // Al salir de la pantalla, todo apagado. Sin esto, cambiar de sección deja la
  // luz de la cámara encendida hasta recargar.
  useEffect(() => apagar, [apagar]);

  const encender = useCallback(
    async (deviceId?: string) => {
      setError(null);
      apagar();
      try {
        const previo = deviceId
          ? ({ deviceId, label: "" } as Dispositivo)
          : elegirDe(clase, disponibles);
        const restriccion = restriccionPara(clase, previo);
        const medio = await navigator.mediaDevices.getUserMedia(
          clase === "microfono" ? { audio: restriccion } : { video: restriccion },
        );
        stream.current = medio;
        setEncendido(true);

        // La lista solo trae nombres DESPUÉS de conceder permiso; pedirla antes
        // devuelve entradas mudas. Por eso se refresca aquí y no al montar.
        const todos = await navigator.mediaDevices.enumerateDevices();
        const clasePedida = clase === "microfono" ? "audioinput" : "videoinput";
        const lista = todos
          .filter((d) => d.kind === clasePedida)
          .map((d) => ({ deviceId: d.deviceId, label: d.label }));
        setDisponibles(lista);

        // Cuál salió de verdad, que no tiene por qué ser el pedido: con `ideal`
        // el navegador puede coger otro, y enseñar el que pedimos sería mentir.
        const enUso = medio.getTracks()[0]?.getSettings().deviceId ?? "";
        setElegido(enUso);
        const suyo = lista.find((d) => d.deviceId === enUso);
        if (suyo) guardarDispositivo(clase, suyo);

        if (clase === "camara" && video.current) {
          video.current.srcObject = medio;
          await video.current.play().catch(() => {
            // Un navegador que se niega a reproducir sin gesto no es un error
            // que enseñar: la imagen aparecerá al primer clic.
          });
        }

        if (clase === "microfono") medirNivel(medio);
      } catch (fallo) {
        apagar();
        setError(mensajeDe(fallo));
      }
    },
    // `disponibles` entra a propósito: al reencender tras cambiar de
    // dispositivo hace falta la lista actual para reconocer el recordado.
    [apagar, clase, disponibles],
  );

  /**
   * El medidor.
   *
   * ES LA MITAD DE LA FUNCIÓN, no un adorno. Un desplegable dice qué micrófono
   * está elegido; solo una barra que se mueve dice que ESE micrófono te está
   * oyendo. La diferencia entre las dos cosas es justo lo que se descubre tarde.
   *
   * Se mide con el dominio del tiempo y no con frecuencias: lo que interesa es
   * «¿cuánta señal hay?», que es la amplitud, y un análisis por bandas cuesta
   * más para contestar peor.
   */
  const medirNivel = (medio: MediaStream) => {
    const contexto = new AudioContext();
    audio.current = contexto;
    const analizador = contexto.createAnalyser();
    analizador.fftSize = 1024;
    contexto.createMediaStreamSource(medio).connect(analizador);

    const muestras = new Uint8Array(analizador.fftSize);
    const tick = () => {
      analizador.getByteTimeDomainData(muestras);
      // Pico y no media: la media de una voz normal se queda cerca del silencio
      // y la barra parecería rota. El pico es lo que se percibe como «sonido».
      let pico = 0;
      for (const m of muestras) pico = Math.max(pico, Math.abs(m - 128));
      setNivel(Math.min(1, pico / 90));
      cuadro.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const Icono = clase === "microfono" ? (encendido ? Mic : MicOff) : encendido ? Video : VideoOff;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Icono size={13} className={encendido ? "text-live" : "text-faint"} />
        <Rotulo>{textos.titulo}</Rotulo>
      </div>

      {disponibles.length > 0 ? (
        <select
          value={elegido}
          aria-label={textos.titulo}
          onChange={(e) => {
            setElegido(e.target.value);
            void encender(e.target.value);
          }}
          className="mt-2 w-full rounded-lg border border-line bg-canvas/60 px-2.5 py-1.5 text-sm text-ink"
        >
          {disponibles.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {nombreDe(d, clase)}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">{textos.sinPermiso}</p>
      )}

      {clase === "microfono" && encendido && (
        <div className="mt-2.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-line"
            role="meter"
            aria-label="Nivel del micrófono"
            aria-valuenow={Math.round(nivel * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-live transition-[transform] duration-75"
              style={{ transform: `scaleX(${nivel})`, transformOrigin: "left" }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-faint">
            {nivel > 0.04
              ? "Te está oyendo."
              : "Di algo: si la barra no se mueve, este no es el micrófono que usas."}
          </p>
        </div>
      )}

      {clase === "camara" && (
        <video
          ref={video}
          muted
          playsInline
          hidden={!encendido}
          className="mt-2.5 aspect-video w-full max-w-xs rounded-xl border border-line bg-canvas object-cover"
        />
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      <Boton
        variante="fantasma"
        tamano="sm"
        className="mt-2.5"
        onClick={() => (encendido ? apagar() : void encender())}
      >
        {encendido ? textos.parar : textos.probar}
      </Boton>
    </div>
  );
}

/**
 * Qué salió mal, dicho para quien lo lee.
 *
 * Los nombres que lanza el navegador —`NotAllowedError`, `NotFoundError`— son
 * exactos y no ayudan: quien los ve no sabe si tiene que dar permiso, enchufar
 * algo o cerrar otra aplicación. Y son las tres causas de casi todo.
 */
function mensajeDe(fallo: unknown): string {
  const nombre = (fallo as { name?: string }).name;
  if (nombre === "NotAllowedError" || nombre === "SecurityError") {
    return "El navegador no dio permiso. Se cambia en el candado de la barra de direcciones, al lado de la dirección.";
  }
  if (nombre === "NotFoundError" || nombre === "OverconstrainedError") {
    return "No encuentro ese dispositivo. ¿Sigue enchufado?";
  }
  if (nombre === "NotReadableError") {
    return "Otra aplicación lo está usando. Ciérrala y vuelve a probar.";
  }
  return "No se pudo abrir el dispositivo.";
}
