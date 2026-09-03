import type { MetadataRoute } from "next";

const SITIO = process.env.NEXT_PUBLIC_SITE_URL ?? "https://devup.app";

/**
 * Se indexa la landing y nada más.
 *
 * Todo lo que hay detrás de `/app` exige sesión, así que un rastreador solo
 * encontraría pantallas de acceso — y `/invitacion` lleva un token en la URL
 * que no debe acabar en un buscador.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/login", "/invitacion", "/recuperar", "/verificar", "/dev"],
    },
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
