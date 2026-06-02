FROM node:22-bookworm

ARG BLENDER_VERSION=5.1.1
ARG BLENDER_SERIES=5.1
ARG KTX_VERSION=4.4.2

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		curl \
		git \
		libdbus-1-3 \
		libegl1 \
		libfontconfig1 \
		libfreetype6 \
		libgl1 \
		libglu1-mesa \
		libopengl0 \
		libsm6 \
		libwayland-egl1 \
		libx11-6 \
		libxcursor1 \
		libxext6 \
		libxfixes3 \
		libxi6 \
		libxinerama1 \
		libxkbcommon0 \
		libxrandr2 \
		libxrender1 \
		libxxf86vm1 \
		zstd \
		xz-utils \
	&& rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" -o /tmp/blender.tar.xz \
	&& tar -xJf /tmp/blender.tar.xz -C /opt \
	&& ln -s "/opt/blender-${BLENDER_VERSION}-linux-x64/blender" /usr/local/bin/blender \
	&& rm -f /tmp/blender.tar.xz

RUN curl -fsSL "https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-Linux-x86_64.deb" -o /tmp/ktx.deb \
	&& apt-get update \
	&& apt-get install -y /tmp/ktx.deb \
	&& rm -f /tmp/ktx.deb \
	&& rm -rf /var/lib/apt/lists/*

RUN npm install -g @gltf-transform/cli pnpm

COPY package.json ./
RUN pnpm install --prod --no-frozen-lockfile

COPY src ./src

ENV PORT=3011

EXPOSE 3011

CMD ["node", "./src/server.mjs"]
