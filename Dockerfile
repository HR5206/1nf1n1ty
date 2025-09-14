FROM alpine:latest

# Install dependencies
RUN apk add --no-cache ca-certificates

# Download PocketBase (replace with latest version from releases)
ADD https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/pocketbase_0.22.21_linux_amd64.zip /tmp/pocketbase.zip
RUN unzip /tmp/pocketbase.zip -d /pocketbase && rm /tmp/pocketbase.zip

# Add execute permissions to the PocketBase binary
RUN chmod +x /pocketbase/pocketbase

# Expose port
EXPOSE 8090

# Start PocketBase
CMD ["/pocketbase/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pocketbase/pb_data"]