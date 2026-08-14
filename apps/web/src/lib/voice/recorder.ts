"use client";

/**
 * Grabación en el navegador de quien graba.
 *
 * El servidor no puede grabar: el audio va cifrado entre pares y no pasa por
 * él. Ver docs/decisiones/0001-cifrado-de-salas.md. La consecuencia práctica
 * es esta clase: se mezclan las pistas de audio de todos los participantes en
 * un único destino con la Web Audio API y se vuelca a un archivo con
 * MediaRecorder.
 *
 * Limitaciones que conviene decir en voz alta, porque son de diseño y no
 * defectos que se vayan a arreglar solos:
 *
 *  · **Solo audio.** Componer varios vídeos en un canvas a 30 fps mientras el
 *    mismo navegador sostiene una malla WebRTC cuesta más de lo que aporta.
 *    Cuando haga falta vídeo, el sitio es este archivo.
 *  · **Depende de quien graba.** Si cierra la pestaña o se le cae la red, la
 *    grabación se pierde: el archivo vive en su memoria hasta que termina.
 *  · **Es lo que esa persona oyó.** Si un participante se conecta tarde o su
 *    audio no llega, tampoco estará en la grabación.
 */
export type RecordingHandle = {
  start: () => void;
  stop: () => Promise<File>;
  addStream: (stream: MediaStream) => void;
  removeStream: (stream: MediaStream) => void;
};

/** El primero que soporte el navegador. Safari solo entiende mp4. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function createRecorder(
  local: MediaStream | null,
  remotes: MediaStream[],
): RecordingHandle | null {
  if (typeof MediaRecorder === "undefined" || !local) return null;

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  const destination = context.createMediaStreamDestination();
  const sources = new Map<MediaStream, MediaStreamAudioSourceNode>();

  const connect = (stream: MediaStream) => {
    if (sources.has(stream) || stream.getAudioTracks().length === 0) return;
    const source = context.createMediaStreamSource(stream);
    source.connect(destination);
    sources.set(stream, source);
  };

  // La pista local se mezcla aunque esté silenciada: `enabled = false` ya la
  // deja en silencio, así que no hay que tratarla aparte, y si se quita el
  // silencio a mitad de grabación su voz entra sin reconectar nada.
  connect(local);
  for (const remote of remotes) connect(remote);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    destination.stream,
    mimeType ? { mimeType, audioBitsPerSecond: 96_000 } : undefined,
  );

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const cleanup = () => {
    for (const source of sources.values()) source.disconnect();
    sources.clear();
    void context.close().catch(() => {});
  };

  return {
    start: () => {
      // Un trozo por segundo: si el navegador se cierra de golpe se pierde
      // todo igualmente, pero mantiene la memoria acotada en llamadas largas.
      recorder.start(1000);
    },

    addStream: (stream) => {
      if (recorder.state !== "inactive") connect(stream);
    },

    removeStream: (stream) => {
      const source = sources.get(stream);
      if (!source) return;
      source.disconnect();
      sources.delete(stream);
    },

    stop: () =>
      new Promise<File>((resolve) => {
        if (recorder.state === "inactive") {
          cleanup();
          resolve(toFile(chunks, mimeType));
          return;
        }
        recorder.onstop = () => {
          cleanup();
          resolve(toFile(chunks, mimeType));
        };
        recorder.stop();
      }),
  };
}

function toFile(chunks: BlobPart[], mimeType: string): File {
  const type = mimeType || "audio/webm";
  const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  return new File(chunks, `Llamada ${stamp}.${extension}`, { type });
}
