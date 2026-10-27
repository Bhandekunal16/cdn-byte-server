# CDN Byte Server

A CommonJS Node.js service that combines an Express API, a Node.js HTTP reverse proxy, image storage, and user registration/login. Runtime behavior is configured through JSON files in `json/`.

## What runs

- `index.js` starts the Express API. With `clustering` enabled, a cluster primary forks one worker per CPU; each worker starts the configured backend listeners.
- `proxy.js` starts the client-facing reverse proxy. It forwards requests to backend ports in round-robin order.
- `layers/replica.layer.js` creates one backend listener, or `replicas` consecutive listeners, according to `REPLICA`.

With the committed app configuration, the proxy listens on port `8000` and the backend ports are `4000`–`4003`. When clustering is enabled, cluster workers share those configured listeners; they do not each receive a separate port range.

## Requirements and installation

Requires Node.js and npm. The Docker image uses Node.js 22.

```bash
npm install
```

The API uses MongoDB for image records and Neo4j for user records. Configure valid database connection details in `json/database.config.json` before using those routes. Keep private credentials out of source control and use appropriate secret management for deployments.

## Run locally

Start the backend and proxy in separate terminals:

```bash
node index.js
node proxy.js
```

Or start both with the process script:

```bash
bash app.process.sh
```

The script starts both processes in the background and sends `SIGTERM` to both if either exits.

Send requests through the proxy:

```bash
curl http://localhost:8000/
```

The proxy preserves the request method, URL, and headers while forwarding to a backend. Direct requests to a backend port bypass proxy-only rate limiting and proxy timeout handling.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Returns `{ "message": "hello world" }`. |
| `POST` | `/register` | Creates a user from `email` and `password`. Registration accepts Gmail addresses and requires a password of at least 8 characters. |
| `POST` | `/login` | Authenticates with `email` and `password`. |
| `POST` | `/image` | Uploads a multipart file in the `image` field or a Base64 image in the `image` JSON field; both require a Gmail `email`. Optional `format` values are `jpeg`, `png`, `webp`, and `avif`. |
| `GET` | `/image?id=<id>` | Returns the image bytes for a MongoDB image ID. `download=1` requests attachment disposition. |
| `GET` | `/image?email=<email>` | Returns image metadata for the supplied Gmail address. |
| `DELETE` | `/image` | Deletes images using a JSON body containing an `ids` array of 1–100 image IDs. |

Image uploads are capped at 10 MiB. The image service validates and optimizes supported images before storage, limits dimensions to 1600 pixels, and stores metadata including format, dimensions, sizes, and a SHA-256 checksum. JSON API responses use the `UnifiedResponse` shape (`message`, `statusCode`, `status`, and `data`), except for raw image downloads.

Registration and login use Neo4j and bcrypt password hashes. The API does not issue tokens or create sessions; login success alone does not provide an authorization mechanism for other routes.

When `encryption_Interceptor` is enabled (the committed default), JSON responses are wrapped as `{ "data": "<base64 ciphertext>" }`. The interceptor also decrypts JSON request bodies containing a `data` field. This payload transformation is not transport security; use HTTPS in deployments.

Unmatched routes return JSON 404. The proxy responds with 429 when rate limited, 502 for upstream errors, 504 for enabled upstream timeouts, and 503 while shutting down.

## Configuration

`provider/config.map.js` merges configuration files in this order:

1. `json/config.json`
2. `json/app.json`
3. `json/rate-limiting.config.json`
4. `json/helmet.config.json` (exposed as `helmet`)
5. `json/logger.config.json`
6. `json/database.config.json`
7. `json/image.config.json`
8. `json/auth.config.json`

Later spreads override earlier keys. Modules read configuration when loaded, so restart the relevant process after changing JSON files.

| File | Main settings |
|---|---|
| `json/config.json` | Feature switches for clustering, replicas, middleware, rate limiting, and proxy timeouts. |
| `json/app.json` | Bind address, ports, replica count, timeout durations, and encryption parameters. |
| `json/rate-limiting.config.json` | Per-IP request limit and rate-limit window. The custom layer uses `limit` and `windowMs`. |
| `json/helmet.config.json` | Options supplied to Helmet. |
| `json/logger.config.json` | Request-field exclusions and console/file logging switches. |
| `json/database.config.json` | MongoDB and Neo4j connection, database, and collection settings. |
| `json/image.config.json` | Image formats, size/dimension limits, and encoder behavior. |
| `json/auth.config.json` | Registration/login messages and validation messages. |

The proxy's rate-limit counters are in memory and local to that proxy process. The default configuration permits 100 requests per IP per 900,000 ms (15 minutes).

## Middleware, logging, and shutdown

Enabled API middleware is applied in this order:

```text
request ID → Helmet → CORS → JSON parser → encryption → request logger → response logger
```

Routes follow the middleware stack, then the 404 handler and optional error middleware. Request IDs are reused from `X-Request-ID` or generated with `crypto.randomUUID()` and returned in the response header.

Request and response summaries are written to the console. With `WRITE_L0G: true`, records are also appended as JSON lines under `logs/`; request-field exclusions apply to request logs. On `SIGTERM` or `SIGINT`, the API and proxy stop accepting connections and drain tracked work. The cluster primary coordinates worker shutdown and suppresses worker replacement during shutdown.

## Docker

The repository includes `dockerFile`, `docker-compose.yml`, and `docker.process.sh`. The script builds the image with the actual `dockerFile` spelling and then starts Compose:

```bash
bash docker.process.sh proxy-server 1.0.0
```

`docker-compose.yml` currently names the build file `dockerfile` (lowercase), while the tracked file is `dockerFile`. These names differ on case-sensitive filesystems, so the Compose build setting must be aligned before this workflow will work there. The Compose service publishes port `8000` and backend ports `4000`–`4003`, and mounts `./logs` at `/app/logs`; MongoDB and Neo4j are external dependencies and are not defined by Compose.

## Tests

Jest tests are organized under `test/unit` and `test/integration`; helpers and fixtures are under `test/helpers` and `test/fixtures`.

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
```

## Project map

```text
index.js / proxy.js        Runtime entry points
routes/                    User and image API routes
service/                   Authentication, image encoding, and storage logic
database/                  MongoDB and Neo4j clients
layers/                    Clustering, replicas, request IDs, rate limits, shutdown
interceptors/              Express middleware implementations
proxy/                     Upstream errors, timeouts, tracking, abort handling
provider/                  Dependency, configuration, and module maps
json/                      Runtime configuration
test/                      Jest unit and integration tests
```

See [api.md](api.md) for endpoint details and [architecture.md](architecture.md) for component responsibilities and request flow.

## License

ISC, as declared in `package.json`.
