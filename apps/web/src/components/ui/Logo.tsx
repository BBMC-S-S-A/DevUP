/**
 * Marca de DevUP. El logo trae su propio fondo blanco horneado en el PNG
 * original; sobre un lienzo casi negro un navy oscuro se pierde contra él, así
 * que la marca lleva su propia chapa clara siempre, sea cual sea el fondo que
 * la rodee — no depende de que el tema encaje con sus colores.
 */
export function Logo({ size = 40, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-xl bg-[#eef1f6] p-1.5 ${animated ? "devup-logo-pop" : ""}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-devup.png" alt="DevUP" className="h-full w-full object-contain" />
    </span>
  );
}
