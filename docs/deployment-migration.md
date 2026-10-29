# Phase 3 deployment and migration

Phase 3 changes the image API from email-based, unauthenticated access to bearer-token authentication and server-verified ownership. The backend and Android app must be upgraded as a coordinated release.

## Before deployment

1. Generate a unique, high-entropy `AUTH_TOKEN_SECRET` (at least 32 UTF-8 bytes) and store it in the deployment secret manager. Do not put the signing secret in `json/app.json`, source control, or a committed `.env` file.
2. Set the same `AUTH_TOKEN_SECRET` on every backend worker. Configure `AUTH_TOKEN_TTL_SECONDS` in `json/app.json` as an integer from 300 to 604800; the default is 43200 seconds.
3. Configure a trusted HTTPS terminator in front of the API and restrict direct access to backend listener ports.
4. Confirm MongoDB and Neo4j connectivity and take normal backups before deployment. Quota-enforced image uploads and deletions require a transaction-capable MongoDB topology, such as a replica set.

## Coordinated rollout

1. Deploy the backend authentication changes first. Startup now fails if token configuration is missing or invalid. Login returns `data.accessToken` and `data.expiresAt`; every image route rejects requests without a valid bearer token.
2. Release the matching Android app promptly. It requires the login token, stores it encrypted with Android Keystore, and sends it for image API and authenticated image requests. Older app versions do not attach tokens and cannot use image routes after backend enforcement is enabled.
3. Verify login, image listing, upload, download, and deletion for two different accounts before completing rollout.

There is no compatibility window for unauthenticated image requests in the secured backend. Plan the rollout and client update communication accordingly; do not expose an unauthenticated backend as a fallback.

## Existing image records

- New image documents store the authenticated Neo4j user ID as `ownerId`; list, read, and delete queries enforce that identity.
- Existing documents without `ownerId` remain accessible only when their stored email matches the verified token email. Existing records are not automatically rewritten.
- Records that already contain an `ownerId` are never authorized by email alone.
- Phase 4 adds a Room schema migration for the account-scoped cached cloud-usage summary. Image and usage metadata remain partitioned by normalized account email and are retained after logout; logout clears local credentials but does not revoke a copied server token or erase metadata.

If administrators choose to backfill legacy records, map each record's email to the authoritative Neo4j user ID using a reviewed, one-time migration with a backup and audit trail. Do not infer ownership from user-supplied values or overwrite an existing `ownerId`.

## Phase 5 offline upload queue rollout

1. Deploy the backend idempotency update before releasing the Android queue. The upload route accepts an optional `Idempotency-Key`; retries with the same account, key, and content replay the original result, while reusing a key for different content returns `409 IDEMPOTENCY_KEY_REUSED`.
2. Keep MongoDB on a transaction-capable topology. Each image insert and its account-scoped idempotency ledger entry commit in the same transaction. The ledger currently has no expiry, so include its storage growth in operational monitoring and retention planning.
3. Verify `GET /storage/usage` returns `data.idempotencySupported: true`. The Android app checks this capability before sending any queued upload. If the field is absent or false, it leaves the image on-device and asks the user to update the server; it does not automatically retry against a server that may ignore idempotency keys.
4. Release the matching Android app. Room migrates schema version 2 to 3 to add queue records. WorkManager waits for a connected network and uses exponential backoff; the same durable operation ID is reused on every attempt.
5. Test a new queue item, a retry after an interrupted request, a quota-exceeded response, and an account switch before enabling rollout broadly.

Queued image bytes are stored in the app-private `files/pending_uploads` directory, excluded from Android backup and device transfer, and removed after confirmed upload or cancellation. Room queue rows remain account-scoped and may outlive logout. A queue row restored without its private file is marked as a local-file failure and must be removed/reselected. An upload is not added to My Images until the server confirms it; confirmed metadata is then written to Room immediately.

If the backend is rolled back to a version without idempotency support, the app's capability check blocks queued uploads rather than risk duplicates. Restore the compatible backend before resuming the queue. Do not delete the ledger collection while clients may retry uploads whose result is uncertain.

## Operational limits and rollback

- Access tokens are stateless, expire after the configured lifetime, and cannot be revoked early. There is no refresh, server logout, or revocation endpoint.
- Roll forward to repair a deployment. Rolling the API back to a version without ownership checks would reintroduce unauthenticated access and is not a safe compatibility strategy.
- Android stores image metadata in Room and fetches image bytes from authenticated endpoints as needed. Uploads can be staged in a durable, account-scoped offline queue; deletions remain online-only.
- The authenticated `GET /storage/usage` endpoint reports the configured per-account quota (default 1 GiB). The backend rejects quota-exceeding uploads with `409 STORAGE_QUOTA_EXCEEDED`; the 10 MiB per-image limit remains `413`. Android caches the last confirmed usage summary and marks it as potentially stale after a failed refresh.
- Configure `STORAGE_QUOTA_BYTES`, `STORAGE_WARNING_INFO_PERCENT`, and `STORAGE_WARNING_PROMINENT_PERCENT` in `json/storage.config.json` before deployment. Review legacy image-size metadata because records without a valid `storedSize` or fallback `size` cause usage calculation to fail closed.
- Image update and server-side token revocation are not part of this migration.
