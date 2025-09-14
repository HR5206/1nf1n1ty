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
RUN mkdir -p /data

# Railway sets PORT; default to 8080 locally
EXPOSE 8080

# Start PocketBase; bind to provided PORT and use /data for persistence
CMD ["/bin/sh", "-lc", "/usr/local/bin/pocketbase serve --http=0.0.0.0:${PORT:-8080} --dir=/data"]