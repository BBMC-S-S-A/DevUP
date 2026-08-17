"use client";

import { ArrowLeft, Code2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DevWorkspace } from "@/components/dev/DevWorkspace";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * Entorno de desarrollo embebido (Fase 0). Editor Monaco + terminal xterm.js
 * conectados a un WebContainer — todo corre dentro del navegador de quien lo
 * abre, sin cómputo nuevo en los servidores de DevUP. Ver
 * docs/decisiones/0004-conector-github-embebido-y-agente-ia.md.
 */
export default function DevPage() {
  const { orgId } = useParams<{ orgId: string }>();

  return (
    <div className="min-h-screen">
      <header className="filo-luz relative bg-surface/40">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden />

        <div className="relative mx-auto max-w-5xl px-6 pb-7 pt-5">
          <Link
            href="/app"
            className="presionable inline-flex items-center gap-1.5 text-xs text-faint hover:text-muted"
          >
            <ArrowLeft size={13} />
            Organizaciones
          </Link>

          <div className="mt-5 flex items-center gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-line-strong bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
              <Code2 size={20} />
            </span>
            <div>
              <h1 className="text-xl font-semibold">Entorno de desarrollo</h1>
              <Rotulo className="mt-1 block">Editor y terminal real, dentro de tu navegador</Rotulo>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <DevWorkspace orgId={orgId} />
      </main>
    </div>
  );
}
