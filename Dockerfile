FROM alpine:3.19

# Install minimal dependencies
RUN apk add --no-cache ca-certificates unzip

# Configure PocketBase version
ENV PB_VERSION=0.22.21

# Download and install PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pocketbase.zip
RUN unzip /tmp/pocketbase.zip -d /usr/local/bin \
	&& rm /tmp/pocketbase.zip \
	&& chmod +x /usr/local/bin/pocketbase

# Data directory for database and uploads
RUN mkdir -p /data

# Railway provides PORT env; default to 8080 for local runs
EXPOSE 8080

# Use a shell to expand ${PORT}; store data under /data
CMD ["/bin/sh", "-lc", "/usr/local/bin/pocketbase serve --http=0.0.0.0:${PORT:-8080} --dir=/data"]