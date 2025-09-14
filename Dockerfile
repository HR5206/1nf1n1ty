FROM alpine:latest

# Install dependencies
RUN apk add --no-cache ca-certificates unzip

# Download PocketBase (replace with latest version from releases)
ADD https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/pocketbase_0.22.21_linux_amd64.zip /tmp/pocketbase.zip
RUN unzip /tmp/pocketbase.zip -d / && \
    mv /pocketbase /pocketbase-bin && \
    rm -r /tmp/pocketbase.zip

# Debug: Verify the binary exists and is executable
RUN ls -l /pocketbase-bin && chmod +x /pocketbase-bin

# Expose port
EXPOSE 8090

# Use ENTRYPOINT to enforce the binary path, with CMD as arguments
ENTRYPOINT ["/pocketbase-bin"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pocketbase/pb_data"]