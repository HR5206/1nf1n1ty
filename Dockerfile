FROM alpine:latest
RUN apk add --no-cache ca-certificates
ADD https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/pocketbase_0.22.21_linux_amd64.zip /tmp/pocketbase.zip
RUN unzip /tmp/pocketbase.zip -d /pocketbase && rm /tmp/pocketbase.zip
VOLUME /pocketbase/pb_data
EXPOSE 8090
CMD ["/pocketbase/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pocketbase/pb_data"]