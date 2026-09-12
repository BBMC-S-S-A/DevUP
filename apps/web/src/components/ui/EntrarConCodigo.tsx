"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Dialogo } from "@/components/ui/Superficies";
import { Field } from "@/components/ui/Field";

/**
 * Entrar a una organización con lo que te hayan pasado.
 *
 * POR QUÉ ACEPTA UN ENLACE Y NO SOLO UN CÓDIGO. Lo que hoy se reparte es un
 * enlace de invitación: quien invita lo copia de su pantalla y lo manda por
 * donde sea. Pedirle a quien lo recibe que extraiga el token de una URL de cien
 * caracteres es pedirle que haga a mano lo que el navegador ya sabe hacer. Se
 * pega lo que sea —la URL entera o el código suelto— y esto saca lo que hace
 * falta.
 *
 * EL CÓDIGO CORTO TODAVÍA NO EXISTE, y esto no lo finge. Uno que se pueda
 * dictar por teléfono es una columna más en `invitations` y va en la otra mitad
 * del plan; cuando exista entra por este mismo campo sin cambiar nada aquí,
 * porque lo que se manda al servidor es lo mismo.
 */
export function EntrarConCodigo({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [entrando, setEntrando] = useState(false);

  const entrar = async () => {
    const token = tokenDe(valor);
    if (!token) {
      toast.error("eso no parece una invitación", {
        description: "Pega el enlace que te pasaron, o solo el código.",
      });
      return;
    }

    setEntrando(true);
    try {
      const { organizationId } = await api.post<{ organizationId: string }>(
        "/invitations/accept",
        { token },
      );
      toast.success("ya estás dentro");
      onCerrar();
      // A la organización recién aceptada y no a la lista: quien acaba de
      // entrar quiere ver dónde ha entrado, no volver a elegir.
      router.push(`/app/o/${organizationId}/ventas`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "no se pudo entrar con esa invitación");
    } finally {
      setEntrando(false);
    }
  };

  return (
    <Dialogo
      titulo="Entrar con un código"
      descripcion="Pega el enlace que te pasaron, o el código suelto."
      onCerrar={onCerrar}
      ancho="sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void entrar();
        }}
        className="space-y-3"
      >
        <Field
          label="Enlace o código"
          value={valor}
          onChange={setValor}
          autoFocus
          placeholder="https://devup.hytrex.co/invitacion?token=…"
        />
        <Boton type="submit" disabled={!valor.trim() || entrando}>
          {entrando ? <Loader2 size={14} className="animate-spin" /> : null}
          Entrar
        </Boton>
      </form>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        La invitación la crea quien ya está dentro, desde los ajustes de su organización. Si la tuya
        caducó, hay que pedir otra.
      </p>
    </Dialogo>
  );
}

/**
 * Saca el token de lo que sea que hayan pegado.
 *
 * SI PARECE UNA URL, SE TRATA COMO URL Y NO SE REBAJA A CÓDIGO. Es la parte que
 * la primera versión hacía mal: un enlace al que le falta el `token` —el error
 * clásico de copiar media URL de un chat— caía al camino del código suelto y se
 * mandaba la URL entera al servidor. El servidor la rechazaba, claro, pero con
 * un error suyo en vez del mensaje útil de aquí, y el síntoma era «me dice que
 * mi invitación no vale» sin decir qué le falta.
 *
 * Un token no lleva `/` ni `:`, así que eso es lo que distingue una cosa de la
 * otra sin tener que adivinar.
 */
export function tokenDe(entrada: string): string | null {
  const limpio = entrada.trim();
  if (!limpio) return null;

  const pareceEnlace = limpio.includes("/") || limpio.includes(":");

  if (pareceEnlace) {
    try {
      // `URL` necesita una base para aceptar rutas relativas; da igual cuál,
      // porque solo se lee el parámetro.
      const url = new URL(limpio, "https://devup.invalid");
      const token = url.searchParams.get("token")?.trim();
      return token && token.length >= 10 ? token : null;
    } catch {
      // Parecía un enlace y no lo era. Tampoco es un código: los códigos no
      // llevan barras.
      return null;
    }
  }

  // El código suelto. Sin espacios por dentro —un token no los lleva, y si los
  // hay es que se pegó una frase— y con el mismo mínimo que exige el servidor,
  // para que el mensaje de «esto no parece una invitación» salga aquí.
  if (/\s/.test(limpio) || limpio.length < 10) return null;
  return limpio;
}
