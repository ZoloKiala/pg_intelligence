# --- build stage ---
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY . .
# Pure standard-library app: build a static binary (no cgo).
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/pgis .

# --- runtime stage ---
FROM alpine:3.20
WORKDIR /app
# Binary + the assets it reads from disk at runtime.
COPY --from=build /app/pgis ./pgis
COPY templates ./templates
COPY static ./static
COPY data ./data
# Railway injects $PORT; main.go reads it (defaults to 8000 locally).
EXPOSE 8000
CMD ["./pgis"]
