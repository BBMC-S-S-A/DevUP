# Imagen de la web.
#
# Usa la salida `standalone` de Next: node_modules entero en una imagen de
# producción son cientos de megas que no hacen falta, porque Next ya sabe qué
# subconjunto usa realmente.
#
# OJO CON LAS VARIABLES: NEXT_PUBLIC_* se incrusta en el bundle DURANTE EL
# BUILD, no al arrancar. Cambiar NEXT_PUBLIC_API_URL en el entorno del
# contenedor no cambia nada; hay que reconstruir la imagen. De ahí que vengan
# como ARG.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1
# Le dice a next.config.ts que sí queremos la salida `standalone`. El build de
# Cloudflare no la lleva a propósito — ver el porqué en next.config.ts.
ENV BUILD_DOCKER=true

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web
RUN npm run build --workspace apps/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup -S devup && adduser -S devup -G devup

# La salida standalone trae su propio server.js y solo las dependencias que
# realmente usa.
COPY --from=build --chown=devup:devup /app/apps/web/.next/standalone ./
COPY --from=build --chown=devup:devup /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=devup:devup /app/apps/web/public ./apps/web/public

USER devup
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
