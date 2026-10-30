# Architecture Overview

## System shape

The service has two Node.js entry points:

- `index.js` builds the Express API and starts one or more backend listeners.
- `proxy.js` runs a raw Node.js HTTP reverse proxy and is the intended client entry point.

The API uses Neo4j for user records and MongoDB for image records. Runtime settings are loaded from `json/` and merged by `provider/config.map.js`.

```text
                         json/*.json
                             │
                    provider/config.map.js
                       ┌─────┴─────┐
                       │           │
                index.js         proxy.js
                   │                 │
          cluster primary?       :proxyPort listener
                   │                 │
       one worker per CPU       rate-limit layer
                   │                 │
       replica layer creates   next backend port
       :port … :port+replicas-1     │
                   └──── Express API ┘
                      │          │
                   Neo4j      MongoDB
                 user data   image data
```

With the committed settings (`clustering: true`, `REPLICA: true`, `port: 4002`, `replicas: 2`, `proxyPort: 8001`), the primary forks one worker per CPU. Every worker invokes the replica layer for ports 4002–4003. Node's cluster machinery shares listener handles for a given port; workers do not receive unique port ranges.

## Entry points and components

| Component | Responsibility |
|---|---|
| `index.js` | Creates Express in a worker or standalone process, installs middleware and routes, starts backend listeners, and registers shutdown handling. The cluster primary supervises workers instead of opening listeners. |
| `proxy.js` | Listens on `proxyPort`, selects backend ports in round-robin order, forwards request streams, and applies proxy-only safeguards. |
| `layers/cluster.layer.js` | Forks one worker per CPU, replaces unexpected exits, and stops replacement during coordinated shutdown. |
| `layers/replica.layer.js` | Creates HTTP servers around the shared Express app at `port + index`. |
| `layers/graceful.shutdown.layer.js` | Coordinates server draining, forced cleanup, primary-to-worker shutdown, and worker IPC handling. |
| `layers/rate.limiting.layer.js` | Maintains an in-memory counter per client address in the proxy process. |
| `layers/request.id.layer.js` | Reuses or creates a request ID, stores it on the request, and sets the response header. |
| `proxy/` | Implements upstream request tracking, timeout handling, 502 responses, and client-disconnect cleanup. |
| `routes/` and `service/` | Implement account and image APIs and their database/business logic. The storage service uses configured MongoDB projections and includes an internal storage-usage aggregation helper. |
| `database/` | Provides MongoDB and Neo4j clients. |
| `provider/` | Exposes dependencies, merged configuration, and module maps. |

## API composition and middleware

In a worker or non-clustered process, `index.js` performs this sequence:

```text
express()
  → middleware(app)
  → active-response tracker
  → GET / route
  → user routes (/login, /register)
  → image routes (/image)
  → JSON 404 fallback
  → error middleware
  → replica listeners
  → graceful shutdown registration
```

`middleware.loader.js` installs enabled middleware in this order:

```text
request ID → Helmet → CORS → JSON parser → encryption → request logger → response logger
```

The root route returns `{ message: "hello world" }`. User routes delegate to `service/auth.service.js`, which normalizes Gmail addresses, hashes passwords with bcrypt, and reads/writes Neo4j `User` nodes. Image routes delegate to the image codec and MongoDB storage service. Image uploads accept multipart files or Base64 JSON data, validate and encode supported images, then persist image bytes and metadata.

The storage service uses `ImageMetaDataPipe` to omit binary data from metadata queries and `imageDataPipe` to select the fields needed when reading an image by ID. Its configured `storageUsagePipeline` groups records by email and reports image count and total stored bytes, falling back from `storedSize` to legacy `size` when needed. `routes/storage.routes.js` exposes this aggregation at authenticated `GET /storage/usage` with quota and warning metadata.

The optional encryption interceptor decrypts JSON request bodies containing `data` and replaces `res.json()` so JSON responses are encrypted as `{ data: "<base64 ciphertext>" }`. Raw image downloads use `res.send()` and are not JSON-wrapped. This is application-level payload transformation, not HTTPS or an authorization mechanism.

## Proxy flow

At module initialization, `proxy.js` derives backend ports:

```text
REPLICA false → [port]
REPLICA true  → [port, port + 1, …, port + replicas - 1]
```

Invalid or non-positive replica counts fall back to one port. A module-level index advances after each selected port, providing round-robin selection within one proxy process.

```text
client request
  → reject with 503 if shutdown has started
  → optional rate-limit check (429 if denied)
  → choose next backend port
  → http.request(host, chosen port, method, path, headers)
  → track outbound request for shutdown
  → optional request timeout / response timeout (504)
  → upstream error handler (502)
  → client-abort handler destroys outbound request
  → pipe request upstream and upstream response to client
```

The proxy forwards the original method, URL, and headers. It does not generate request IDs or retry failed requests. Rate-limit state is process-local; direct access to backend ports bypasses proxy-only rate limiting and timeouts.

## Persistence and configuration

`provider/config.map.js` merges `config.json`, `app.json`, `rate-limiting.config.json`, `helmet.config.json`, `logger.config.json`, `database.config.json`, `image.config.json`, `auth.config.json`, and `storage.config.json` in that order. The Helmet configuration is exposed under `helmet`; other files are spread into the merged object. Later values override earlier duplicate keys. Configuration is read at module load, so processes must be restarted after changes.

| File | Contents |
|---|---|
| `json/config.json` | Feature switches for middleware, clustering, replicas, rate limiting, and timeouts. |
| `json/app.json` | Host/ports, replica count, timeout durations, encryption parameters, and access-token lifetime (`AUTH_TOKEN_TTL_SECONDS`). |
| `json/rate-limiting.config.json` | `windowMs` and `limit`; the custom limiter does not consume the stored header flags. |
| `json/helmet.config.json` | Options passed to Helmet when configured. |
| `json/logger.config.json` | Request exclusions and console/file logging switches. |
| `json/database.config.json` | MongoDB and Neo4j connection options, database names, and collection names. |
| `json/image.config.json` | Supported image formats, input/storage limits, and encoder options. |
| `json/auth.config.json` | Authentication-related user-facing messages and validation messages. |
| `json/storage.config.json` | Storage-usage aggregation stages and MongoDB projections for metadata and image reads. |

MongoDB stores image bytes and associated metadata in the configured image collection. Neo4j stores account details, including bcrypt password hashes, in `User` nodes. The services expect externally available databases; Docker Compose does not provision them.

## Logging and shutdown

Request logging runs after JSON parsing and optional decryption. The response logger records request ID, method, URL, status, duration, and content length on response completion. Both write console output; when `WRITE_L0G` is enabled they append JSON lines under `logs/` through `core/file.functions.js`.

Rate-limit counters, active proxy requests, and active Express responses are held in process-local memory. They are not shared across workers, restarts, or hosts.

On `SIGTERM` or `SIGINT`, the proxy or API server stops accepting connections and drains tracked work. If the shutdown deadline expires, tracked work is destroyed and the process exits unsuccessfully. The cluster primary signals workers, waits for exits, and prevents replacement workers from being forked during shutdown.

## Deployment and constraints

`app.process.sh` launches the API and proxy for local/container use. Docker Compose publishes `8001`, `4002`, and `4003` in the committed file, but `docker-compose.yml` currently refers to lowercase `dockerfile` while the tracked Docker definition is named `dockerFile`; this mismatch prevents the Compose build on case-sensitive filesystems until corrected.

This is a demo-oriented HTTP service. Image routes require signed bearer access tokens, but the service still has no TLS termination, refresh or revocation endpoints, shared rate-limit store, retry policy, or durable application log store. Protect database credentials, token signing secrets, and encryption configuration, and provide HTTPS and appropriate access controls in a deployment.
