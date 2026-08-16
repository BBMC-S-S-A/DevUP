/**
 * El renderizador.
 *
 * Canvas 2D, sin motor. Para una planta de 40×30 casillas con veinte avatares
 * esto va a 60 fps sin despeinarse, y meter Phaser (~1 MB) en un proyecto que
 * escribe su propio tiempo real para no atarse a nadie sería incoherente.
 *
 * Está aislado a propósito: recibe una escena, unos pares y una cámara, y
 * dibuja. No sabe de React, ni de sockets, ni de WebRTC. Si algún día hace
 * falta WebGL, este es el único archivo que se reemplaza.
 *
 * EL ORDEN DE DIBUJO ES LA MITAD DEL TRABAJO. Primero todo el suelo, que nunca
 * tapa nada. Después todo lo que se levanta —muros, muebles, personas— ordenado
 * por su Y: lo que está más abajo en la pantalla se dibuja después y tapa a lo
 * que está detrás. Eso es lo que convierte una rejilla plana en un espacio con
 * profundidad, y es justo lo que en isométrico costaría planos de pared y
 * cuatro orientaciones por mueble.
 */
import {
  TILE,
  drawAvatar,
  drawDoorway,
  drawFloor,
  drawNameplate,
  drawOuterWall,
  drawWall,
  drawZoneFloor,
  drawZoneLabel,
} from "./atlas";
import { drawProp } from "./furniture";
import type { Prop } from "./props";
import type { Scene } from "./scene";
import type { Avatar, Facing, Peer } from "./types";

export type Camera = { x: number; y: number; scale: number };

export type RenderInput = {
  scene: Scene;
  /** Yo. Se dibuja como los demás, pero con el nombre resaltado. */
  self: { x: number; y: number; facing: Facing; moving: boolean; sitting: boolean; displayName: string };
  peers: Peer[];
  avatars: Map<string, Avatar>;
  selfUserId: string;
  camera: Camera;
  /** Milisegundos desde que arrancó la escena, para las animaciones. */
  time: number;
  /** Radio en casillas dentro del cual se oye a alguien. Se dibuja de guía. */
  audibleRadius: number;
};

/** Algo que se levanta del suelo y por tanto entra en el orden por Y. */
type Standing =
  | { y: number; kind: "cell"; x: number; ty: number; cell: Scene["cells"][number] }
  | { y: number; kind: "prop"; piece: Prop }
  | { y: number; kind: "peer"; peer: Peer; avatar: Avatar; isSelf: boolean };

export function render(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { scene, camera, peers, avatars, selfUserId, self, time } = input;
  const canvas = ctx.canvas;
  const viewW = canvas.width / camera.scale;
  const viewH = canvas.height / camera.scale;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(camera.scale, 0, 0, camera.scale, 0, 0);
  ctx.translate(-camera.x + viewW / 2, -camera.y + viewH / 2);

  // Solo se dibuja lo que cae en pantalla. Con una oficina de 20 canales la
  // planta es grande y recorrer 1.200 casillas por fotograma para descartar
  // el 90 % es trabajo tirado.
  const pad = 2;
  const minX = Math.max(0, Math.floor((camera.x - viewW / 2) / TILE) - pad);
  const maxX = Math.min(scene.width - 1, Math.ceil((camera.x + viewW / 2) / TILE) + pad);
  const minY = Math.max(0, Math.floor((camera.y - viewH / 2) / TILE) - pad);
  // Un margen mayor por abajo: un muro alto que empieza fuera de pantalla
  // todavía asoma dentro.
  const maxY = Math.min(scene.height - 1, Math.ceil((camera.y + viewH / 2) / TILE) + pad + 2);

  // --- Suelo --------------------------------------------------------------
  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      const cell = scene.cells[ty * scene.width + tx]!;
      if (cell.kind === "zone-floor") {
        drawZoneFloor(ctx, tx, ty, cell.zone.palette, cell.material);
      } else if (cell.kind === "door") {
        drawDoorway(ctx, tx, ty, cell.zone.palette, cell.material);
      } else if (cell.kind === "wall") {
        // El suelo debajo de un muro no se ve, pero pintarlo evita que asome
        // el vacío por el borde de la casilla al desplazarse la cámara.
        drawFloor(ctx, tx, ty);
      } else {
        drawFloor(ctx, tx, ty);
      }
    }
  }

  // Alfombras y demás objetos planos: sobre el suelo y debajo de todo lo que
  // tenga altura. Si entraran en el orden por Y taparían el sofá que deberían
  // tener encima, porque suelen estar en la parte baja de la sala.
  for (const piece of scene.floorProps) {
    if (piece.x < minX - 3 || piece.x > maxX + 3) continue;
    if (piece.y < minY - 3 || piece.y > maxY + 3) continue;
    drawProp(ctx, piece);
  }

  // --- El halo de lo que se oye -------------------------------------------
  //
  // Se dibuja sobre el suelo y debajo de todo lo demás. No es decoración: sin
  // una pista visible de hasta dónde llega la voz, el audio por proximidad se
  // vive como un fallo — la gente no entiende por qué deja de oír a alguien.
  const selfPx = { x: self.x * TILE, y: self.y * TILE };
  const radius = input.audibleRadius * TILE;
  const halo = ctx.createRadialGradient(
    selfPx.x,
    selfPx.y,
    radius * 0.55,
    selfPx.x,
    selfPx.y,
    radius,
  );
  halo.addColorStop(0, "rgba(91,140,255,0.10)");
  halo.addColorStop(1, "rgba(91,140,255,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(selfPx.x, selfPx.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // --- Todo lo que tiene altura, ordenado por Y ----------------------------
  const standing: Standing[] = [];

  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      const cell = scene.cells[ty * scene.width + tx]!;
      if (cell.kind === "floor" || cell.kind === "zone-floor" || cell.kind === "door") continue;
      standing.push({ y: ty * TILE + TILE, kind: "cell", x: tx, ty, cell });
    }
  }

  for (const piece of scene.props) {
    if (piece.x < minX - 2 || piece.x > maxX + 2) continue;
    if (piece.y < minY - 2 || piece.y > maxY + 2) continue;
    // Se ordena por el pie del mueble, igual que un avatar. Así una persona
    // delante de un sofá lo tapa y detrás queda tapada, sin ningún caso
    // especial: la misma regla para todo lo que se apoya en el suelo.
    standing.push({ y: piece.y * TILE + TILE, kind: "prop", piece });
  }

  const selfPeer: Peer = {
    peerId: "self",
    userId: selfUserId,
    displayName: self.displayName,
    x: self.x,
    y: self.y,
    tx: self.x,
    ty: self.y,
    facing: self.facing,
    moving: self.moving,
    sitting: self.sitting,
    zoneId: null,
  };

  for (const peer of [...peers, selfPeer]) {
    standing.push({
      y: peer.y * TILE + (peer.sitting ? 6 : 0),
      kind: "peer",
      peer,
      avatar: avatars.get(peer.userId) ?? FALLBACK_AVATAR,
      isSelf: peer.peerId === "self",
    });
  }

  standing.sort((a, b) => a.y - b.y);

  for (const item of standing) {
    if (item.kind === "cell") {
      const { cell, x, ty } = item;

      // La cara superior solo se dibuja donde el muro empieza. En un tramo
      // vertical, cada casilla pinta su cara sobre el cuerpo de la de arriba
      // y el muro sale a franjas — parece una valla, no una pared.
      const above = ty > 0 ? scene.cells[(ty - 1) * scene.width + x] : undefined;
      const capped = above?.kind !== cell.kind;

      if (cell.kind === "outer-wall") drawOuterWall(ctx, x, ty, cell.face, capped);
      else if (cell.kind === "wall") drawWall(ctx, x, ty, cell.palette, cell.face, capped);

      // Lo que cuelga de esta pared se pinta justo después de ella: está
      // sobre el muro, no delante. Ordenarlo por Y con el resto lo colocaría
      // por detrás y desaparecería.
      for (const piece of scene.wallProps) {
        if (Math.round(piece.x) !== x || Math.round(piece.y) !== ty) continue;
        drawProp(ctx, piece);
      }
      continue;
    }

    if (item.kind === "prop") {
      drawProp(ctx, item.piece);
      continue;
    }

    const { peer, avatar, isSelf } = item;
    const px = peer.x * TILE;
    const py = peer.y * TILE;

    // Quien no se oye se dibuja atenuado. Es la contrapartida visual del halo:
    // se ve a todo el mundo, se oye solo a quien está cerca, y la diferencia
    // tiene que estar a la vista.
    const distance = Math.hypot(peer.x - self.x, peer.y - self.y);
    const audible = isSelf || distance <= input.audibleRadius;
    ctx.globalAlpha = audible ? 1 : 0.45;

    // Sentado se dibuja un pelín más abajo en el orden por Y para quedar por
    // delante del asiento: si no, la silla tapa a quien está sentado en ella.
    drawAvatar(ctx, px, py, avatar, peer.facing, peer.moving, time, peer.sitting);
    ctx.globalAlpha = 1;
    drawNameplate(ctx, px, py, peer.displayName, isSelf ? "#5b8cff" : audible ? "#e7ebf2" : "#5c6577");
  }

  // --- Rótulos de zona ------------------------------------------------------
  // Al final y sin ordenar: son interfaz, no parte del espacio, y tienen que
  // leerse siempre aunque un muro quede por delante.
  for (const zone of scene.zones) {
    if (zone.x > maxX || zone.x + zone.width < minX) continue;
    if (zone.y > maxY || zone.y + zone.height < minY) continue;
    drawZoneLabel(ctx, zone, zone.channelName, zone.channelKind, zone.channelPrivate);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Para quien todavía no ha elegido nada: gris, sin adornos, reconocible. */
const FALLBACK_AVATAR: Avatar = {
  body: 0,
  hair: 0,
  top: 0,
  bottom: 0,
  skinTone: 2,
  hairTone: 1,
  topTone: 7,
  bottomTone: 7,
  hat: 0,
  glasses: 0,
  beard: 0,
  shoes: 0,
  hatTone: 0,
  shoesTone: 7,
};
