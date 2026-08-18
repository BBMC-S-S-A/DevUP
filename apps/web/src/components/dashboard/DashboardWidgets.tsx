"use client";

import { AtSign, Bell, Link2, Mail, Megaphone, Music, Plus, Radio, SquareCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type Announcement,
  type DashboardWidget,
  type Notification,
  type OrganizationLink,
  api,
} from "@/lib/api";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * El catálogo de widgets del panel.
 *
 * Vive en el cliente y no en la base de datos a propósito (ver preferences.ts
 * en la API): añadir un widget nuevo el día de mañana es una entrada más
 * aquí y un componente, no una migración.
 */
export const CATALOGO_WIDGETS: Record<
  DashboardWidget,
  { titulo: string; icono: typeof Music; descripcion: string }
> = {
  spotify: { titulo: "Spotify", icono: Music, descripcion: "Lo que suena en la sala" },
  noticias: { titulo: "Noticias", icono: Megaphone, descripcion: "Lo último publicado" },
  notificaciones: { titulo: "Notificaciones", icono: Bell, descripcion: "Tu bandeja" },
  enlaces: { titulo: "Enlaces", icono: Link2, descripcion: "Los fijados por la organización" },
};

const ICONOS_NOTIFICACION = {
  mention: AtSign,
  task_assigned: SquareCheck,
  invitation: Mail,
  recording: Radio,
  announcement: Megaphone,
} as const;

/** Estado vacío o de carga, del mismo tamaño en los tres widgets para que la
 *  columna no dé saltos mientras llegan las tres respuestas por separado. */
function CuerpoWidget({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5 px-4 py-3">{children}</div>;
}

function LineaVacia({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-3 text-center text-[11px] text-faint">{children}</p>;
}

export function NoticiasWidget({ organizationId }: { organizationId: string }) {
  const [items, setItems] = useState<Announcement[] | null>(null);

  useEffect(() => {
    void api
      .get<{ announcements: Announcement[] }>(`/organizations/${organizationId}/announcements`)
      .then(({ announcements }) => setItems(announcements.slice(0, 3)))
      .catch(() => setItems([]));
  }, [organizationId]);

  return (
    <CuerpoWidget>
      {items === null ? (
        <div className="devup-esqueleto h-14 rounded-lg" />
      ) : items.length === 0 ? (
        <LineaVacia>Nada publicado todavía.</LineaVacia>
      ) : (
        <ul className="space-y-2">
          {items.map((noticia) => (
            <li key={noticia.id} className="rounded-lg border border-line/70 bg-canvas/40 px-2.5 py-2">
              <p className="truncate text-xs font-medium text-ink">{noticia.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-faint">{noticia.body}</p>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={`/app/o/${organizationId}/noticias`}
        className="presionable block pt-0.5 text-center text-[11px] text-accent hover:text-accent-bright"
      >
        Ver todas
      </Link>
    </CuerpoWidget>
  );
}

export function NotificacionesWidget() {
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    void api
      .get<{ notifications: Notification[] }>("/notifications?limit=5")
      .then(({ notifications }) => setItems(notifications))
      .catch(() => setItems([]));
  }, []);

  return (
    <CuerpoWidget>
      {items === null ? (
        <div className="devup-esqueleto h-14 rounded-lg" />
      ) : items.length === 0 ? (
        <LineaVacia>Sin notificaciones.</LineaVacia>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const Icono = ICONOS_NOTIFICACION[item.kind] ?? Bell;
            return (
              <li key={item.id}>
                <Link
                  href={item.link || "#"}
                  className="presionable flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-raised/60"
                >
                  <Icono size={13} className="mt-0.5 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink">{item.title}</span>
                    {item.body && (
                      <span className="block truncate text-[10px] text-faint">{item.body}</span>
                    )}
                  </span>
                  {!item.readAt && (
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </CuerpoWidget>
  );
}

export function EnlacesWidget({ organizationId }: { organizationId: string }) {
  const [links, setLinks] = useState<OrganizationLink[] | null>(null);

  useEffect(() => {
    void api
      .get<{ links: OrganizationLink[] }>(`/organizations/${organizationId}/links`)
      .then(({ links }) => setLinks(links))
      .catch(() => setLinks([]));
  }, [organizationId]);

  return (
    <CuerpoWidget>
      {links === null ? (
        <div className="devup-esqueleto h-14 rounded-lg" />
      ) : links.length === 0 ? (
        <LineaVacia>
          La organización no ha fijado ningún enlace todavía. Se añaden desde Ajustes.
        </LineaVacia>
      ) : (
        <ul className="space-y-1">
          {links.map((link) => (
            <li key={link.id}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="presionable flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-ink hover:bg-raised/60"
              >
                <Link2 size={12} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{link.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </CuerpoWidget>
  );
}

/** El renglón para volver a añadir un widget que se había quitado del panel. */
export function AnadirWidget({
  ocultos,
  onAnadir,
}: {
  ocultos: DashboardWidget[];
  onAnadir: (id: DashboardWidget) => void;
}) {
  if (ocultos.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Rotulo>Añadir al panel</Rotulo>
      {ocultos.map((id) => {
        const { titulo, icono: Icono } = CATALOGO_WIDGETS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onAnadir(id)}
            className="presionable inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line
              px-2.5 py-1.5 text-[11px] text-faint hover:border-line-strong hover:text-muted"
          >
            <Plus size={11} />
            <Icono size={12} />
            {titulo}
          </button>
        );
      })}
    </div>
  );
}
