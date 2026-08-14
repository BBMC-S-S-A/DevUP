"use client";

import { Hash, Loader2, Lock, Volume2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FileLibrary } from "@/components/files/FileLibrary";
import { ChannelChat } from "@/components/chat/ChannelChat";
import { VoiceRoom } from "@/components/voice/VoiceRoom";
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
      <div className="grid h-screen place-items-center px-6">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="grid h-screen place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6 flex items-center gap-2">
        {channel.kind === "voice" ? (
          <Volume2 size={17} className="text-faint" />
        ) : (
          <Hash size={17} className="text-faint" />
        )}
        <h1 className="text-base font-semibold">{channel.name}</h1>
        {channel.isPrivate && (
          <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-faint">
            <Lock size={9} />
            privado
          </span>
        )}
      </header>

      {channel.kind === "voice" && (
        <div className="mb-8">
          <VoiceRoom channel={channel} />
        </div>
      )}

      {/* La conversación también en los canales de voz: hablar y dejar por
          escrito lo acordado es lo mismo que se hace en una reunión. */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold">Conversación</h2>
        <ChannelChat channelId={channelId} />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold">Archivos del canal</h2>
        <FileLibrary
          workspaceId={workspaceId}
          organizationId={channel.organizationId ?? ""}
          channelId={channelId}
        />
      </section>
    </div>
  );
}
