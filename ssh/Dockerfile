FROM oven/bun:latest

# Install Caddy directly
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -o /usr/bin/caddy -L "https://caddyserver.com/api/download?os=linux&arch=arm64" \
    && chmod +x /usr/bin/caddy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN bun install

COPY index.ts Caddyfile start.sh ./
RUN chmod +x start.sh

EXPOSE 2222 443

CMD ["./start.sh"]
