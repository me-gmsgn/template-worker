FROM node:22-bookworm

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends blender ca-certificates git \
	&& rm -rf /var/lib/apt/lists/*

RUN npm install -g @gltf-transform/cli pnpm

COPY package.json ./
RUN pnpm install --prod --no-frozen-lockfile

COPY src ./src

ENV PORT=3011

EXPOSE 3011

CMD ["node", "./src/server.mjs"]
