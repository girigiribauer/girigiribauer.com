# Stage 1: Builder
FROM debian:bookworm-slim AS builder

# Install Git, Curl, and ca-certificates
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Hugo Extended
ARG HUGO_VERSION=0.164.0
# Detect architecture and download appropriate binary
RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
      "amd64") FILE_ARCH="linux-amd64" ;; \
      "arm64") FILE_ARCH="linux-arm64" ;; \
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;; \
    esac && \
    curl -L -o hugo.deb https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_${FILE_ARCH}.deb \
    && dpkg -i hugo.deb \
    && rm hugo.deb

WORKDIR /src
COPY . .

# Build the site
RUN hugo --buildFuture --minify

# Stage 2: Runtime (Nginx)
FROM nginx:alpine

# Copy static assets from builder stage
COPY --from=builder /src/public /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
