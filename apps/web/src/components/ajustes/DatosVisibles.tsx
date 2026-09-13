"use client";

import { Eye, EyeOff } from "lucide-react";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";

/**
 * Qué ve el resto de ti, y qué no.
 *
 * POR QUÉ ESTO EXISTE. Una pantalla de ajustes deja poner un cargo, una foto y
 * un estado, y en ningún momento dice a quién le llega nada de eso. Así que
 * cada cual decide con una suposición: unos creen que su cargo lo ve todo el
 * mundo y no lo ponen; otros creen que su rastro de actividad es privado y se
 * llevan la sorpresa. Las dos suposiciones son de la misma persona y una de las
 * dos está mal.
 *
 * Y LA MITAD QUE MÁS IMPORTA ES LA DE ABAJO: lo que NO se ve. Una lista de
 * cosas visibles se lee como una advertencia y deja pensando qué más habrá. Lo
 * que tranquiliza —y lo que hace que alguien se anime a rellenar su perfil— es
 * ver escrito que su correo no circula.
 *
 * ESTO NO CONFIGURA NADA, Y ESO ES DELIBERADO. No hay interruptores porque no
 * hay nada que apagar: el aislamiento lo decide la base de datos por
 * organización y por espacio, no una preferencia. Poner aquí un «ocultar mi
 * actividad» que la base no respeta sería peor que no decir nada — sería
 * prometerlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CADA LÍNEA DE ABAJO ESTÁ COMPROBADA CONTRA LAS RUTAS, no contra la memoria.
 * Si alguien añade un campo a `/organizations/:orgId/members`, a
 * `/avatars/urls` o a `/organizations/:orgId/puntos`, esta lista se queda
 * vieja — y una lista vieja aquí es una afirmación falsa sobre la privacidad de
 * alguien, que es de lo peor que puede hacer un producto.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SE_VE: { que: string; quien: string; donde: string }[] = [
  {
    que: "Tu nombre y tu cara",
    quien: "Quien comparta organización contigo",
    donde: "En la barra, en cada tarea que lleves y en el historial de lo que toques.",
  },
  {
    que: "Tu oficio",
    quien: "Quien comparta organización contigo",
    donde: "Al lado de tu nombre. Contesta «¿a quién le pregunto esto?».",
  },
  {
    que: "Si estás disponible",
    quien: "Quien comparta organización contigo",
    donde: "Lo pones tú; nadie lo deduce de si estás tecleando.",
  },
  {
    que: "Tu personaje de DevVerse",
    quien: "Quien comparta organización contigo",
    donde: "En la oficina, y como tu cara si lo elegiste.",
  },
  {
    que: "Tus puntos, y de qué tarea salió cada uno",
    quien: "Quien comparta organización contigo",
    donde: "En la portada. Se ganan al cerrar tareas, y el detalle se puede abrir.",
  },
  {
    que: "Lo que haces en un espacio",
    // Aquí el alcance es más estrecho que en todo lo demás, y ese matiz es el
    // que la gente da por hecho al revés.
    quien: "Solo quien llegue a ESE espacio",
    donde: "Mover, cerrar o asignar una tarea queda escrito con tu nombre y la hora.",
  },
];

const NO_SE_VE: { que: string; porque: string }[] = [
  {
    que: "Tu correo",
    porque: "No sale en ninguna pantalla ni en ninguna respuesta. Es con lo que entras.",
  },
  {
    que: "Tu huso horario",
    porque: "Solo lo usa el servidor para contar tus semanas en el día que te toca.",
  },
  {
    que: "El rol que elegiste para el recorrido",
    porque: "Solo decide qué guía se te ofrece. No cambia lo que puedes hacer.",
  },
  {
    que: "Lo que escribes en canales privados",
    porque: "Fuera de sus miembros, ni el contenido ni que el canal existe.",
  },
  {
    que: "Los espacios personales",
    porque: "Quien no los creó no los ve, aunque administre la organización.",
  },
];

export function DatosVisibles() {
  return (
    <Tarjeta className="p-4">
      <Rotulo>Qué ve el resto de ti</Rotulo>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Aquí no hay nada que configurar: el alcance lo decide a quién pertenece
        cada cosa, no una preferencia. Esto es para que no tengas que suponerlo.
      </p>

      <div className="mt-4 space-y-4">
        <section>
          <div className="flex items-center gap-1.5">
            <Eye size={12} className="text-faint" />
            <Rotulo>Se ve</Rotulo>
            <span className="h-px flex-1 bg-line/70" aria-hidden />
          </div>
          <ul className="mt-2 space-y-2">
            {SE_VE.map((fila) => (
              <li key={fila.que}>
                <p className="text-xs text-ink">{fila.que}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                  <span className="text-muted">{fila.quien}.</span> {fila.donde}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* LO QUE NO SE VE VA DESPUÉS Y NO ANTES, aunque sea lo que tranquiliza:
            primero hay que saber qué circula, y solo entonces sirve de algo
            leer qué no. Al revés, se lee como una lista de descargos. */}
        <section className="border-t border-line pt-3">
          <div className="flex items-center gap-1.5">
            <EyeOff size={12} className="text-faint" />
            <Rotulo>No se ve</Rotulo>
            <span className="h-px flex-1 bg-line/70" aria-hidden />
          </div>
          <ul className="mt-2 space-y-2">
            {NO_SE_VE.map((fila) => (
              <li key={fila.que}>
                <p className="text-xs text-ink">{fila.que}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">{fila.porque}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Tarjeta>
  );
}
