"use client";

import { AtSign, Bell, Link2, Mail, Megaphone, Radio, SquareCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type Announcement, type Notification, type OrganizationLink, api } from "@/lib/api";
import { Rotulo } from "@/components/ui/Superficies";

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
