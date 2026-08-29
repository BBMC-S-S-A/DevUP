"use client";

import { AlertTriangle, Files, Hash, Lock, MessageSquare, Volume2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { FileLibrary } from "@/components/files/FileLibrary";
import { ChannelChat } from "@/components/chat/ChannelChat";
import { SpotifyWidget } from "@/components/spotify/SpotifyWidget";
import { VoiceRoom } from "@/components/voice/VoiceRoom";
import { Chip, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { ApiError, type Channel, api } from "@/lib/api";

export default function ChannelPage() {
  const { workspaceId, channelId } = useParams<{ workspaceId: string; channelId: string }>();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChannel(null);
    setError(null);
    void api
      .get<{ channel: Channel }>(`/channels/${channelId}`)
      .then(({ channel }) => setChannel(channel))
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : "no se pudo cargar el canal"),
      );
  }, [channelId]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <EstadoVacio
          icono={<AlertTriangle size={20} />}
          titulo="No se pudo abrir el canal"
          pista={error}
        />
      </div>
    );
  }

  if (!channel) return <CanalCargando />;

  const esVoz = channel.kind === "voice";

  return (
    <div className="alto-util flex flex-col">
      {/* La cabecera se queda pegada arriba porque en un canal largo es lo único
          que dice dónde estás. Sin borde duro: el filo de luz separa y a la vez
          ilumina lo que pasa por debajo. */}
      <header className="filo-luz sticky top-0 z-20 bg-canvas/80 px-8 py-3.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl border ${
              esVoz ? "border-accent/30 bg-accent-soft/50 text-accent" : "border-line bg-raised/60 text-muted"
            }`}
          >
            {esVoz ? <Volume2 size={17} /> : <Hash size={17} />}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{channel.name}</h1>
              {channel.isPrivate && (
                <Chip>
                  <Lock size={9} />
                  privado
                </Chip>
              )}
            </div>
            <Rotulo className="mt-0.5 block">{esVoz ? "Canal de voz" : "Canal de texto"}</Rotulo>
          </div>

          {/* El widget de música solo tiene sentido donde hay sala: se monta
              igual que antes, solo cambia de sitio. */}
          {esVoz && (
            <span className="shrink-0">
              <SpotifyWidget channelId={channelId} />
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-8 pb-14 pt-6">
        {esVoz && (
          <div className="devup-entrada mb-8" style={{ "--retraso": "0ms" } as CSSProperties}>
            <VoiceRoom channel={channel} />
          </div>
        )}

        {/* La conversación también en los canales de voz: hablar y dejar por
            escrito lo acordado es lo mismo que se hace en una reunión. */}
        <section
          className="devup-entrada mb-8"
          style={{ "--retraso": esVoz ? "60ms" : "0ms" } as CSSProperties}
        >
          <CabeceraSeccion icono={<MessageSquare size={12} />} titulo="Conversación" />
          <ChannelChat channelId={channelId} />
        </section>

        <section
          className="devup-entrada"
          style={{ "--retraso": esVoz ? "120ms" : "60ms" } as CSSProperties}
        >
          <CabeceraSeccion icono={<Files size={12} />} titulo="Archivos del canal" />
          <FileLibrary
            workspaceId={workspaceId}
            organizationId={channel.organizationId ?? ""}
            channelId={channelId}
          />
        </section>
      </div>
    </div>
  );
}

/**
 * Rótulo de sección con su regla. La línea que sale del texto y cruza el ancho
 * es lo que convierte dos secciones apiladas en un panel de instrumentos: marca
 * el grupo sin gastar un titular grande en algo que no se lee, se reconoce.
 */
function CabeceraSeccion({ icono, titulo }: { icono: ReactNode; titulo: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-2.5">
      <span className="text-faint">{icono}</span>
      <Rotulo>{titulo}</Rotulo>
      <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
    </h2>
  );
}

/**
 * La espera dibuja la forma de lo que viene, no un giro en medio de la nada:
 * el salto de «pantalla vacía» a «canal entero» es lo que se siente lento,
 * aunque el tiempo sea el mismo.
 */
function CanalCargando() {
  return (
    <div className="alto-util flex flex-col">
      <header className="filo-luz sticky top-0 z-20 bg-canvas/80 px-8 py-3.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <span className="devup-esqueleto size-10 rounded-xl" />
          <span className="space-y-1.5">
            <span className="devup-esqueleto block h-4 w-40 rounded-lg" />
            <span className="devup-esqueleto block h-2 w-24 rounded-lg" />
          </span>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl px-8 pt-6">
        <div className="devup-esqueleto h-[30rem] rounded-2xl" />
      </div>
    </div>
  );
}
