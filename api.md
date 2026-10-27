# API Reference

The API is served by the Express backend and is intended to be accessed through the reverse proxy at `http://localhost:8000`. The proxy forwards requests to the configured backend ports.

All examples use JSON unless noted otherwise. The API has no token/session authorization mechanism. Image routes require an email address for upload or lookup, but that is not authentication or access control.

## Common behavior

- `Content-Type: application/json` is used for JSON request bodies and JSON responses.
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

Authenticates a user against Neo4j using the submitted email and password. A successful response contains the user's ID, email, and role. The API does not issue an access token or session cookie.

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
    "user": {
      "id": "user-id",
      "email": "person@gmail.com",
      "role": "user"
    }
  }
}
```

### Errors

| HTTP status | Condition | Response message |
|---|---|---|
| `400` | Email or password is missing | `Required fields are missing` |
| `500` | Invalid credentials or authentication/database failure | `Login failed` |

The current route returns invalid credentials with HTTP `500`; it does not distinguish an unknown email from an incorrect password.

## `POST /image`

Validates and stores an image in MongoDB. Uploads require a Gmail address. The decoded input is limited to 10 MiB, and the image encoder limits input to 100 million pixels. Stored images are optimized when possible and constrained to a maximum dimension of 1600 pixels.

Choose one of the following request formats.

### Multipart upload

Send `multipart/form-data` with:

| Field | Required | Description |
|---|---|---|
| `image` | Yes | Image file. |
| `email` | Yes | Gmail address associated with the image. |
| `format` | No | Output format: `jpeg`, `png`, `webp`, or `avif`. Defaults to the storage encoder's `webp` format. |

Example using curl:

```bash
curl -X POST http://localhost:8000/image \
  -F 'email=person@gmail.com' \
  -F 'image=@./picture.png' \
  -F 'format=webp'
```

### Base64 JSON upload

Send a JSON body containing an `image` field with Base64 data, optionally as a data URL. Do not send both an `image` file and Base64 image in the same request.

```json
{
  "email": "person@gmail.com",
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
| `400` | Email is missing or not a valid Gmail address | `A valid Gmail address is required` |
| `400` | Image data or image format is invalid/unsupported | `Invalid or unsupported image` |
| `413` | File or decoded payload exceeds 10 MiB | `Image exceeds the configured size limit` |
| `500` | Storage insert fails | `Image could not be stored` |

Image-processing exceptions are returned as `400`; database insert failures are returned as `500`.

## `GET /image`

Use exactly one of `id` or `email`.

### Fetch image bytes by ID

```text
GET /image?id=<mongodb-object-id>
```

Optional query parameter:

| Parameter | Value | Effect |
|---|---|---|
| `download` | `1` | Sets `Content-Disposition: attachment`; otherwise the image is sent inline. |

On success, the endpoint returns the image bytes with its stored `Content-Type`, a `Content-Length`, `Cache-Control: private, max-age=3600`, and `X-Content-Type-Options: nosniff`.

### Fetch image metadata by email

```text
GET /image?email=person%40gmail.com
```

### Metadata success — `200 OK`

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

The metadata query excludes the image bytes.

### Errors

| HTTP status | Condition | Result |
|---|---|---|
| `400` | Neither `id` nor `email` is provided, both are provided, or the supplied ID/email is invalid | Error response; ID and email validation use different configured messages. |
| `404` | No matching image exists, or an email has no stored images | Error response with `Image not found`. |
| `500` | Database/read operation fails | Error response with `Failed to fetch images`. |

## `DELETE /image`

Deletes between 1 and 100 images by MongoDB ID. This endpoint currently does not require an email or other authorization.

### Request

```json
{
  "ids": [
    "mongodb-object-id-1",
    "mongodb-object-id-2"
  ]
}
```

### Success — `200 OK`

```json
{
  "message": "Images deleted successfully",
  "statusCode": 200,
  "status": true,
  "data": {
    "deletedCount": 2
  }
}
```

### Errors

| HTTP status | Condition | Message |
|---|---|---|
| `400` | `ids` is missing, empty, longer than 100, or contains an invalid ID | `At least one valid image ID is required` |
| `404` | No requested ID matched a stored image | `Image not found` |
| `500` | MongoDB deletion fails | `Failed to delete images` |

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
