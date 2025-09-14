FROM alpine:3.19

# Install dependencies
RUN apk add --no-cache ca-certificates unzip wget

# PocketBase version
ENV PB_VERSION=0.22.21

# Download and install PocketBase binary
RUN wget -O /tmp/pocketbase.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    && unzip /tmp/pocketbase.zip -d /usr/local/bin \
    && rm -f /tmp/pocketbase.zip \
    && chmod +x /usr/local/bin/pocketbase

# Data directory for database and uploads (attach a Railway Volume to /data)
RUN mkdir -p /data \
    && adduser -D -u 10001 appuser \
    && chown -R 10001:10001 /data

# Ensure working directory contains the pocketbase binary so a Start Command like
# `./pocketbase serve ...` also works if Railway overrides CMD
WORKDIR /usr/local/bin

# Simple start wrapper to ensure $PORT is honored reliably
RUN printf '#!/bin/sh\nset -e\nPORT="${PORT:-8080}"\nexec /usr/local/bin/pocketbase serve --http=0.0.0.0:${PORT} --dir=/data\n' > /usr/local/bin/start.sh \
    && chmod +x /usr/local/bin/start.sh

# Railway sets PORT; default to 8080 locally
EXPOSE 8080

# Drop privileges
USER 10001

# Start PocketBase; bind to provided PORT and use /data for persistence
ENTRYPOINT ["/usr/local/bin/start.sh"]