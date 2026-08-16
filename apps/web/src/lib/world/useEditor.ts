"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { PROP_SPECS, type Prop, type PropKind, prop } from "./props";
import { furnish } from "./rooms";
import type { Zone } from "./types";

/**
 * El editor de una sala.
 *
 * SE EDITA LA SALA EN LA QUE ESTÁS, no la planta entera. Es la simplificación
 * que hace que todo lo demás encaje: las coordenadas son relativas a esa sala,
 * no hay que decidir qué pasa al arrastrar un mueble de una sala a otra, y el
 * permiso es el del canal que se está pisando. Además es lo que espera
 * cualquiera: se decora la habitación en la que se está.
 *
 * EL PRIMER CAMBIO VUELCA EL AMUEBLADO DEDUCIDO. Mientras `customized` sea
 * falso, la sala se amuebla sola y la tabla está vacía; si al entrar en modo
 * edición la sala se vaciara, nadie lo abriría dos veces. Así que al abrir el
 * editor se parte de lo que ya se veía —deducido o guardado— y solo al guardar
 * se escribe.
 */
export type EditorState = {
  /** Muebles en coordenadas RELATIVAS a la sala. Es lo que se guarda. */
  items: Prop[];
  /** Índice del mueble seleccionado en `items`, o −1. */
  selected: number;
};

const MAX_HISTORY = 40;

export function useEditor(zone: Zone | null, onSaved: () => Promise<void> | void) {
  const [active, setActive] = useState(false);
  const [state, setState] = useState<EditorState>({ items: [], selected: -1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Mueble elegido en la paleta, pendiente de colocar. */
  const [brush, setBrush] = useState<PropKind | null>(null);
  const [tone, setTone] = useState(0);

  const history = useRef<EditorState[]>([]);
  const dirty = useRef(false);

  /** Lo que se ve ahora mismo en la sala, ya sea deducido o guardado. */
  const currentItems = useCallback((z: Zone): Prop[] => {
    if (z.customized) {
      return z.props.flatMap((s) => {
        if (!PROP_SPECS[s.kind as PropKind]) return [];
        return [prop(s.kind as PropKind, s.x, s.y, { facing: s.facing, tone: s.tone })];
      });
    }
    // Deducido: viene en coordenadas de planta, y aquí todo va relativo.
    return furnish(z).map((p) => ({ ...p, x: p.x - z.x, y: p.y - z.y }));
  }, []);

  const open = useCallback(() => {
    if (!zone) return;
    history.current = [];
    dirty.current = false;
    setState({ items: currentItems(zone), selected: -1 });
    setError(null);
    setActive(true);
  }, [zone, currentItems]);

  const close = useCallback(() => {
    setActive(false);
    setBrush(null);
    setState({ items: [], selected: -1 });
  }, []);

  /** Aplica un cambio guardando el estado anterior para poder deshacerlo. */
  const commit = useCallback((next: (current: EditorState) => EditorState) => {
    setState((current) => {
      history.current.push(current);
      if (history.current.length > MAX_HISTORY) history.current.shift();
      dirty.current = true;
      return next(current);
    });
  }, []);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (previous) setState(previous);
  }, []);

  /**
   * Coloca en una casilla relativa.
   *
   * Se rechaza fuera del interior útil de la sala: colocar sobre un muro deja
   * un mueble que se ve a medias y no se puede volver a seleccionar, porque el
   * clic cae sobre la pared.
   */
  const place = useCallback(
    (rx: number, ry: number) => {
      if (!zone || !brush) return;
      if (rx < 1 || ry < 1 || rx > zone.width - 2 || ry > zone.height - 2) return;
      commit((current) => ({
        items: [...current.items, prop(brush, rx, ry, { tone })],
        selected: current.items.length,
      }));
    },
    [zone, brush, tone, commit],
  );

  /** Selecciona lo que haya en esa casilla, o deselecciona. */
  const selectAt = useCallback((rx: number, ry: number) => {
    setState((current) => {
      // Del final hacia el principio: lo último colocado está encima, y es lo
      // que uno espera coger al hacer clic sobre un montón.
      for (let i = current.items.length - 1; i >= 0; i -= 1) {
        const item = current.items[i]!;
        if (Math.round(item.x) === rx && Math.round(item.y) === ry) {
          return { ...current, selected: i };
        }
      }
      return { ...current, selected: -1 };
    });
  }, []);

  const moveSelected = useCallback(
    (rx: number, ry: number) => {
      if (!zone) return;
      if (rx < 1 || ry < 1 || rx > zone.width - 2 || ry > zone.height - 2) return;
      commit((current) => {
        if (current.selected < 0) return current;
        const items = [...current.items];
        items[current.selected] = { ...items[current.selected]!, x: rx, y: ry };
        return { ...current, items };
      });
    },
    [zone, commit],
  );

  const rotateSelected = useCallback(() => {
    const order: Prop["facing"][] = ["s", "o", "n", "e"];
    commit((current) => {
      if (current.selected < 0) return current;
      const items = [...current.items];
      const item = items[current.selected]!;
      const next = order[(order.indexOf(item.facing) + 1) % order.length]!;
      items[current.selected] = { ...item, facing: next };
      return { ...current, items };
    });
  }, [commit]);

  const deleteSelected = useCallback(() => {
    commit((current) => {
      if (current.selected < 0) return current;
      return {
        items: current.items.filter((_, i) => i !== current.selected),
        selected: -1,
      };
    });
  }, [commit]);

  const save = useCallback(async () => {
    if (!zone) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/world/zones/${zone.id}/props`, {
        props: state.items.map((item) => ({
          kind: item.kind,
          x: Math.round(item.x),
          y: Math.round(item.y),
          facing: item.facing,
          tone: item.tone,
        })),
      });
      dirty.current = false;
      await onSaved();
      setActive(false);
      setBrush(null);
    } catch {
      setError("no se pudo guardar la sala");
    } finally {
      setSaving(false);
    }
  }, [zone, state.items, onSaved]);

  /**
   * Volver al amueblado deducido.
   *
   * Borra filas y baja la marca; no recoloca nada, porque el defecto nunca se
   * llegó a sobrescribir. Por eso esto no puede perder nada que no fuera
   * explícitamente colocado a mano.
   */
  const restore = useCallback(async () => {
    if (!zone) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/world/zones/${zone.id}/reset`);
      dirty.current = false;
      await onSaved();
      setActive(false);
      setBrush(null);
    } catch {
      setError("no se pudo restaurar la sala");
    } finally {
      setSaving(false);
    }
  }, [zone, onSaved]);

  const setMaterial = useCallback(
    async (material: number | null) => {
      if (!zone) return;
      await api.patch(`/world/zones/${zone.id}`, { material }).catch(() => {});
      await onSaved();
    },
    [zone, onSaved],
  );

  /** Los muebles en coordenadas de planta, para que el renderizador los pinte. */
  const preview = useMemo<Prop[] | null>(() => {
    if (!active || !zone) return null;
    return state.items.map((item) => ({ ...item, x: item.x + zone.x, y: item.y + zone.y }));
  }, [active, zone, state.items]);

  return {
    active,
    open,
    close,
    items: state.items,
    selected: state.selected,
    preview,
    brush,
    setBrush,
    tone,
    setTone,
    place,
    selectAt,
    moveSelected,
    rotateSelected,
    deleteSelected,
    undo,
    canUndo: history.current.length > 0,
    save,
    restore,
    setMaterial,
    saving,
    error,
  };
}
