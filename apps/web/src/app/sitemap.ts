import type { MetadataRoute } from "next";

const SITIO = process.env.NEXT_PUBLIC_SITE_URL ?? "https://devup.app";

/**
 * Una sola URL, porque una sola es pública. Cuando lleguen el blog o la
 * documentación, se añaden aquí.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITIO,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
