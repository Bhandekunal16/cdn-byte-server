# API Reference

The Express API is intended to be accessed through the reverse proxy. Local development may use `http://localhost:8000`; deployments must expose it through HTTPS and keep direct backend ports private.

All examples use JSON unless noted otherwise. `POST /register` and `POST /login` are public. Every `/image` route requires a bearer token returned by login; image ownership is derived from the verified token rather than a caller-selected email.

## Common behavior

- `Content-Type: application/json` is used for JSON request bodies and JSON responses.
- Protected image requests must include `Authorization: Bearer <accessToken>`.
- Access tokens are HS256 JWTs with issuer `cdn-byte-server`, audience `pixelvault-android`, a stable user ID subject, and an expiry. The default lifetime is 12 hours.
- `X-Request-ID` is reused when supplied; otherwise the API generates one. The response includes the resulting `X-Request-ID`.
- With `encryption_Interceptor` enabled, JSON responses are wrapped as `{ "data": "<ciphertext>" }`. JSON request bodies may be encrypted by sending the encrypted payload in a `data` field. The encryption uses settings from `json/app.json`; clients must use the matching configuration and format.
- Raw image downloads are binary responses and are not wrapped by the JSON encryption interceptor.
- The default middleware stack includes CORS, JSON parsing, request/response logging, and configurable Helmet, request-ID, and encryption middleware.
- Requests sent directly to a backend port bypass proxy-level rate limiting and proxy timeout handling.

## `GET /`

Returns the service's hello-world payload.

### Success — `200 OK`

Plain JSON when response encryption is disabled:

```json
{
  "message": "hello world"
}
```

With response encryption enabled, the response body has the common encrypted wrapper.

## `POST /register`

Creates a user record in Neo4j. Only Gmail addresses are accepted, and passwords must contain at least 8 characters. Passwords are stored as bcrypt hashes.

### Request

```json
{
  "email": "person@gmail.com",
  "password": "a-long-password"
}
```

### Success — `201 Created`

```json
{
  "message": "Registration successful",
  "statusCode": 201,
  "status": true,
  "data": {
    "user": {
      "id": "user-id",
      "email": "person@gmail.com",
      "createdAt": "database-generated-datetime",
      "role": "user"
    }
  }
}
```

### Errors

| HTTP status | Condition | Response message |
|---|---|---|
| `400` | Email or password is missing | `Required fields are missing` |
| `500` | Invalid email, password shorter than 8 characters, duplicate account, or registration/database failure | `Registration failed` |

Error responses use the common response shape and include an `error` value in `data`. Registration validation errors are currently returned with HTTP `500`, not `400`.

## `POST /login`

Authenticates a user against Neo4j using the submitted email and password, then issues an access token.

### Request

```json
{
  "email": "person@gmail.com",
  "password": "a-long-password"
}
```

### Success — `200 OK`

```json
{
  "message": "Login successful",
  "statusCode": 200,
  "status": true,
  "data": {
    "user": { "id": "user-id", "email": "person@gmail.com", "role": "user" },
    "accessToken": "<signed-jwt>",
    "expiresAt": 1793275200
  }
}
```

### Errors

| HTTP status | Condition | Response message |
|---|---|---|
| `400` | Email or password is missing | `Required fields are missing` |
| `401` | Invalid email or password | `Login failed` |
| `503` | Token service is not configured | `Login failed` |
| `500` | Authentication/database failure | `Login failed` |

`expiresAt` is a Unix timestamp in seconds. There is no refresh or logout/revocation endpoint; a token remains valid until expiry even if the client clears its local session.

### Server token configuration

Set `AUTH_TOKEN_SECRET` in the backend process environment to a high-entropy secret of at least 32 UTF-8 bytes. Set `AUTH_TOKEN_TTL_SECONDS` in `json/app.json`; it defaults to `43200` and must be an integer between `300` and `604800`. The API refuses to start if either value is invalid. Keep the signing secret in a deployment secret manager; never put it in tracked JSON or a committed `.env` file.

## `POST /image`

Validates and stores an image in MongoDB for the authenticated user. An optional `email` field is accepted only when it matches the token's email. The decoded input is limited to 10 MiB, and the image encoder limits input to 100 million pixels. Stored images are optimized when possible and constrained to a maximum dimension of 1600 pixels.

Choose one of the following request formats.

### Multipart upload

Send `multipart/form-data` with:

| Field | Required | Description |
|---|---|---|
| `image` | Yes | Image file. |
| `email` | No | Optional compatibility field; must match the authenticated account. |
| `format` | No | Output format: `jpeg`, `png`, `webp`, or `avif`. Defaults to the storage encoder's `webp` format. |

Example using curl:

```bash
curl -X POST http://localhost:8000/image \
  -H 'Authorization: Bearer <accessToken>' \
  -F 'image=@./picture.png' \
  -F 'format=webp'
```

### Base64 JSON upload

Send a JSON body containing an `image` field with Base64 data, optionally as a data URL. Do not send both an `image` file and Base64 image in the same request.

```json
{
  "image": "data:image/png;base64,<base64-data>",
  "format": "webp"
}
```

### Success — `200 OK`

```json
{
  "message": "Image uploaded",
  "statusCode": 200,
  "status": true,
  "data": {
    "id": "mongodb-object-id",
    "name": "picture.png",
    "mimeType": "image/webp",
    "format": "webp",
    "width": 1200,
    "height": 800,
    "originalSize": 245678,
    "storedSize": 102345,
    "optimized": true,
    "checksum": "sha256-hex-digest"
  }
}
```

For Base64 uploads, the stored name is `uploaded-image`.

### Errors

| HTTP status | Condition | Message |
|---|---|---|
| `400` | Image is missing | `Image is required` |
| `403` | Optional email does not match the token identity | `Image owner does not match the authenticated account` |
| `400` | Authenticated account identity is invalid | `A valid Gmail address is required` |
| `400` | Image data or image format is invalid/unsupported | `Invalid or unsupported image` |
| `413` | File or decoded payload exceeds 10 MiB | `Image exceeds the configured size limit` |
| `409` | The upload would exceed the account's cloud storage quota | `Account cloud storage quota exceeded`, with `data.errorCode` set to `STORAGE_QUOTA_EXCEEDED` and current usage details |
| `500` | Storage insert fails | `Image could not be stored` |

Image-processing exceptions are returned as `400`; database insert failures or unreliable quota accounting are returned as `500`.

## `GET /image`

Include a bearer token. Use `GET /image` to list the authenticated user's metadata, or `GET /image?id=<id>` to fetch one owned image.

### Fetch image bytes by ID

```text
GET /image?id=<mongodb-object-id>
```

The request must include `Authorization: Bearer <accessToken>`. An image owned by a different account is not returned.

Optional query parameter:

| Parameter | Value | Effect |
|---|---|---|
| `download` | `1` | Sets `Content-Disposition: attachment`; otherwise the image is sent inline. |

On success, the endpoint returns the image bytes with its stored `Content-Type`, a `Content-Length`, `Cache-Control: private, max-age=3600`, and `X-Content-Type-Options: nosniff`.

### Fetch image metadata for the authenticated user

```text
GET /image
```

`?email=<email>` remains optional for compatibility, but a supplied email must match the authenticated token. The success response is `200 OK`:

```json
{
  "message": "Images found!",
  "statusCode": 200,
  "status": true,
  "data": [
    {
      "_id": "mongodb-object-id",
      "email": "person@gmail.com",
      "name": "picture.png",
      "mimeType": "image/webp",
      "format": "webp",
      "width": 1200,
      "height": 800,
      "originalSize": 245678,
      "storedSize": 102345,
      "optimized": true,
      "checksum": "sha256-hex-digest",
      "createdAt": "database-generated-date"
    }
  ]
}
```

The metadata query excludes image bytes using the projection configured in `json/storage.config.json`.

### Errors

| HTTP status | Condition | Result |
|---|---|---|
| `400` | Supplied ID or optional email is invalid | Error response; ID and email validation use different configured messages. |
| `401` | Bearer token is missing, invalid, or expired | Authentication error response. |
| `403` | Optional email does not match the token identity | Ownership mismatch response. |
| `404` | No matching image exists, or an email has no stored images | Error response with `Image not found`. |
| `500` | Database/read operation fails | Error response with `Failed to fetch images`. |

## `GET /storage/usage`

Returns cloud storage usage for the authenticated account. The default quota is 1 GiB per account; change `STORAGE_QUOTA_BYTES` and the warning thresholds in `json/storage.config.json` to configure it. Usage includes each owned image's `storedSize`, falling back to legacy `size` when needed. If a stored image has neither a valid size nor a valid legacy size, the endpoint fails rather than reporting an understated total.

### Success — `200 OK`

```json
{
  "message": "Storage usage retrieved successfully",
  "statusCode": 200,
  "status": true,
  "data": {
    "usedBytes": 102345,
    "quotaBytes": 1073741824,
    "availableBytes": 1073649479,
    "usagePercentage": 0,
    "imageCount": 1,
    "warningLevel": "normal"
  }
}
```

`warningLevel` is `normal` below the informational threshold, `info` from 80%, `warning` from 90%, and `full` at 100%. These thresholds are configurable. `availableBytes` never falls below zero and `usagePercentage` is capped at 100.

### Errors

| HTTP status | Condition | Result |
|---|---|---|
| `401` | Missing, invalid, or expired bearer token | Authentication error response |
| `500` | Usage cannot be calculated reliably | `data.errorCode` is `STORAGE_USAGE_UNAVAILABLE` |

Uploads and deletes use MongoDB transactions to keep quota checks consistent. MongoDB must use a transaction-capable topology (such as a replica set); standalone servers cannot perform these writes.

## `DELETE /image`

Deletes between 1 and 100 images by MongoDB ID, restricted to the authenticated user's ownership.

### Request

Send `Authorization: Bearer <accessToken>` as an HTTP header:

```json
{
  "ids": [
    "mongodb-object-id-1",
    "mongodb-object-id-2"
  ]
}
```

Example:

```bash
curl -X DELETE http://localhost:8000/image \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -d '{"ids":["mongodb-object-id-1"]}'
```

### Success — `200 OK`

```json
{
  "message": "Images deleted successfully",
  "statusCode": 200,
  "status": true,
  "data": 2
}
```

`data` is the number of deleted images. If no requested ID owned by the authenticated user matched, the endpoint returns `404 Not Found` with `data: {"deletedCount": 0}`.

New records store the stable token subject as `ownerId`. For older records without `ownerId`, ownership falls back to matching the email in the verified token. Records with an `ownerId` are never authorized by email alone.

### Errors

| HTTP status | Condition | Message |
|---|---|---|
| `400` | `ids` is missing, empty, longer than 100, or contains an invalid ID | `At least one valid image ID is required` |
| `404` | No requested ID matched a stored image | `Image not found` |
| `500` | MongoDB deletion fails | `Failed to delete images` |

## Deployment requirements and limitations

- Terminate TLS at a trusted reverse proxy or load balancer. Do not expose backend listener ports directly to the public internet.
- Configure and protect `AUTH_TOKEN_SECRET` independently in every backend environment; all workers that validate the same tokens must use the same secret. Configure token lifetime in `json/app.json`.
- Tokens are stateless and cannot be revoked before expiry. There is currently no refresh-token, server logout, or revocation mechanism.
- Legacy image records are accessible only to the token identity whose email matches the legacy record; newly uploaded records use stable user IDs.

## Proxy and fallback responses

These are generated outside the route handlers:

| HTTP status | Condition |
|---|---|
| `404` | No API route matches the request; JSON body contains `status: false`, `statusCode: 404`, and `message: "Not Found"`. |
| `429` | The proxy's per-IP rate limit is exceeded. |
| `502` | The proxy cannot complete the upstream request. |
| `503` | The proxy is shutting down and no longer accepts new requests. |
| `504` | An enabled upstream request or response timeout expires. |

## Response encryption

When `encryption_Interceptor` is enabled, JSON route responses are transformed to:

```json
{
  "data": "<base64 ciphertext>"
}
```

This includes JSON success and error responses. It does not apply to the binary response from `GET /image?id=...`. The encryption key and algorithm settings are configured by the service; this mechanism does not replace HTTPS, authentication, or authorization.
