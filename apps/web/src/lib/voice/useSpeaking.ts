"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Detección de quién está hablando, por energía de la señal (RMS).
 *
 * Dos detalles que parecen menores y no lo son:
 *
 *  · Se usa histéresis, con un umbral para empezar a hablar más alto que el de
 *    dejar de hablar. Con un solo umbral, una voz que ronda el límite hace
 *    parpadear el indicador varias veces por segundo y resulta insoportable.
 *
 *  · El AudioContext arranca suspendido hasta que hay un gesto del usuario:
 *    los navegadores lo bloquean para impedir reproducción automática. Como
 *    esto se monta después de pulsar «entrar», ya hay gesto, pero se llama a
 *    resume() igualmente por si el navegador lo suspendió al cambiar de
 *    pestaña.
 */
const SPEAKING_ON = 0.045;
const SPEAKING_OFF = 0.02;
const HOLD_MS = 320;

export function useSpeaking(stream: MediaStream | null, enabled = true): boolean {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);

  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) {
      setSpeaking(false);
      return;
    }

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    void context.resume().catch(() => {});

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let quietSince = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(samples);

      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);

      const now = performance.now();
      if (!speakingRef.current && rms > SPEAKING_ON) {
        speakingRef.current = true;
        quietSince = 0;
        setSpeaking(true);
      } else if (speakingRef.current && rms < SPEAKING_OFF) {
        // Se mantiene «hablando» un instante más: las pausas entre palabras
        // no deberían apagar el indicador.
        quietSince ||= now;
        if (now - quietSince > HOLD_MS) {
          speakingRef.current = false;
          setSpeaking(false);
        }
      } else if (speakingRef.current) {
        quietSince = 0;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => {});
      speakingRef.current = false;
    };
  }, [stream, enabled]);

  return speaking;
}
