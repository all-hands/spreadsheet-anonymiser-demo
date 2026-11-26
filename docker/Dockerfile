FROM rust:1.99.1-slim-trixie@sha256:f6c4a35d21dbb3c89d7a8d056c193e94fc09037f2b58dd858b09c39a47dd02d7 AS wasm-builder
WORKDIR /app
RUN rustup target add wasm32-unknown-unknown
COPY crates/anonymiser-wasm/Cargo.toml ./crates/anonymiser-wasm/Cargo.toml
COPY scripts/wasm-bindgen-version.sh ./scripts/wasm-bindgen-version.sh
RUN cargo install wasm-bindgen-cli --version "$(bash scripts/wasm-bindgen-version.sh)" --locked
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY scripts ./scripts
RUN bash scripts/build-wasm.sh

FROM node:24.22.2-alpine3.24@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
COPY --from=wasm-builder /app/frontend/src/wasm-pkg ./src/wasm-pkg
RUN npx tsc -b && npx vite build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8bb9437d74a600ec5dbf90c035451c724dc33eac8d3a71078f6f8612c345f6

COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf

COPY --from=frontend-builder /app/dist /usr/share/nginx/app

USER 101

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8000/healthz"]
