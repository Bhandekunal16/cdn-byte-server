const asBuffer = require("../core/mongo.functions");
const { BSON, ObjectId } = require("../provider/dependency.map");
const { createHash } = require("node:crypto");
const {
  MONGO_IMAGE_MAX_BYTES,
  mongodb,
  storageUsagePipeline,
  ImageMetaDataPipe,
  imageDataPipe,
  STORAGE_QUOTA_BYTES,
  STORAGE_WARNING_INFO_PERCENT,
  STORAGE_WARNING_PROMINENT_PERCENT,
} = require("../provider/config.map");
const { getDb } = require("../database/mongoDb.service");
const MONGO_BSON_LIMIT = 16 * 1024 * 1024;
const QUOTA_LOCK_COLLECTION = "image_quota_locks";
const UPLOAD_IDEMPOTENCY_COLLECTION = "image_upload_idempotency";

class StorageAccountingError extends Error {}

class StorageQuotaExceededError extends Error {
  constructor({ usedBytes, quotaBytes, requestedBytes }) {
    super("Account cloud storage quota exceeded");
    this.name = "StorageQuotaExceededError";
    this.usedBytes = usedBytes;
    this.quotaBytes = quotaBytes;
    this.availableBytes = Math.max(quotaBytes - usedBytes, 0);
    this.requestedBytes = requestedBytes;
  }
}

class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different upload");
    this.name = "IdempotencyKeyConflictError";
  }
}

function validateStorageConfiguration() {
  if (!Number.isSafeInteger(STORAGE_QUOTA_BYTES) || STORAGE_QUOTA_BYTES <= 0)
    throw new StorageAccountingError(
      "STORAGE_QUOTA_BYTES in json/storage.config.json must be a positive safe integer",
    );
  if (
    !Number.isInteger(STORAGE_WARNING_INFO_PERCENT) ||
    !Number.isInteger(STORAGE_WARNING_PROMINENT_PERCENT) ||
    STORAGE_WARNING_INFO_PERCENT <= 0 ||
    STORAGE_WARNING_PROMINENT_PERCENT > 100 ||
    STORAGE_WARNING_INFO_PERCENT >= STORAGE_WARNING_PROMINENT_PERCENT
  )
    throw new StorageAccountingError(
      "Storage warning percentages must be increasing integers between 1 and 100",
    );
}

function ownerFilter(owner) {
  if (!owner?.userId || !owner?.email)
    throw new Error("An authenticated image owner is required");

  return {
    $or: [
      { ownerId: owner.userId },
      { ownerId: { $exists: false }, email: owner.email },
    ],
  };
}

class storageService {
  #collectionCache;

  async collection() {
    if (this.#collectionCache) return this.#collectionCache;
    const db = await getDb();
    this.#collectionCache = db.collection(mongodb.DATABASE_COLLECTION.IMAGES);
    return this.#collectionCache;
  }

  async read(owner) {
    const collection = await this.collection();
    return collection.find(ownerFilter(owner)).toArray();
  }

  async getImageMetaData(owner) {
    const collection = await this.collection();
    return collection.find(ownerFilter(owner), ImageMetaDataPipe).toArray();
  }

  async getStorageUsageByEmail() {
    const collection = await this.collection();
    const users = await collection.aggregate(storageUsagePipeline).toArray();
    const invalidSizeCount = users.reduce(
      (total, user) => total + user.invalidSizeCount,
      0,
    );
    if (invalidSizeCount > 0)
      throw new StorageAccountingError(
        `${invalidSizeCount} stored image(s) have no valid storedSize or legacy size`,
      );
    return {
      users,
      totalImages: users.reduce((total, user) => total + user.imageCount, 0),
      totalStoredSize: users.reduce(
        (total, user) => total + user.totalStoredSize,
        0,
      ),
    };
  }

  async getStorageUsage(owner, session) {
    const collection = await this.collection();
    const pipeline = [
      { $match: ownerFilter(owner) },
      storageUsagePipeline[0],
      {
        $group: {
          _id: null,
          imageCount: { $sum: 1 },
          totalStoredSize: { $sum: { $ifNull: ["$_usageBytes", 0] } },
          invalidSizeCount: {
            $sum: { $cond: [{ $eq: ["$_usageBytes", null] }, 1, 0] },
          },
        },
      },
    ];
    const aggregation = session
      ? collection.aggregate(pipeline, { session })
      : collection.aggregate(pipeline);
    const [usage] = await aggregation.toArray();
    if (!usage) return { imageCount: 0, usedBytes: 0 };
    if (usage.invalidSizeCount > 0)
      throw new StorageAccountingError(
        `${usage.invalidSizeCount} stored image(s) have no valid storedSize or legacy size`,
      );

    const imageCount = toSafeNumber(usage.imageCount, "image count");
    const usedBytes = toSafeNumber(usage.totalStoredSize, "stored byte usage");
    return { imageCount, usedBytes };
  }

  async readImage(id, owner) {
    const collection = await this.collection();

    const image = await collection.findOne(
      { _id: id, ...ownerFilter(owner) },
      imageDataPipe,
    );

    if (!image) return undefined;

    const { mimeType, type, checksum } = image;
    const buffer = asBuffer(image.image);

    return {
      buffer,
      mimeType: mimeType || type || "application/octet-stream",
      storedSize: buffer.length,
      checksum,
    };
  }

  async insert(document, quotaBytes, idempotencyKey) {
    const collection = await this.collection();
    const encoded = document.encoded;

    if (encoded.buffer.length > MONGO_IMAGE_MAX_BYTES)
      throw new Error("Image exceeds the configured MongoDB storage limit");

    const insertDocument = {
      image: encoded.buffer,
      email: document.owner.email,
      ownerId: document.owner.userId,
      name: document.name,
      type: encoded.mimeType,
      size: encoded.storedSize,
      format: encoded.format,
      mimeType: encoded.mimeType,
      width: encoded.width,
      height: encoded.height,
      originalSize: encoded.originalSize,
      storedSize: encoded.storedSize,
      optimized: encoded.optimized,
      checksum: encoded.checksum,
      originalFormat: encoded.originalFormat,
      originalMimeType: encoded.originalMimeType,
      createdAt: new Date(),
    };

    if (BSON.calculateObjectSize(insertDocument) >= MONGO_BSON_LIMIT)
      throw new Error("Image document exceeds MongoDB's BSON size limit");

    if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0)
      throw new StorageAccountingError("Storage quota configuration is invalid");

    if (idempotencyKey !== undefined) {
      if (
        typeof idempotencyKey !== "string" ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)
      )
        throw new TypeError("Idempotency key must be 8 to 128 safe characters");

      const database = await getDb();
      const idempotencyCollection = database.collection(
        UPLOAD_IDEMPOTENCY_COLLECTION,
      );
      const idempotencyId = createHash("sha256")
        .update(`${document.owner.userId}\0${idempotencyKey}`)
        .digest("hex");
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            checksum:
              encoded.checksum ??
              createHash("sha256").update(encoded.buffer).digest("hex"),
            name: document.name,
            format: encoded.format,
            mimeType: encoded.mimeType,
          }),
        )
        .digest("hex");

      return this.withOwnerTransaction(document.owner, async (session) => {
        const previous = await idempotencyCollection.findOne(
          { _id: idempotencyId },
          { session },
        );
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new IdempotencyKeyConflictError();

          return {
            acknowledged: true,
            insertedId: new ObjectId(previous.imageId),
            idempotencyResult: previous.result,
            replayed: true,
          };
        }

        const { usedBytes } = await this.getStorageUsage(
          document.owner,
          session,
        );
        if (
          usedBytes > quotaBytes ||
          encoded.buffer.length > quotaBytes - usedBytes
        )
          throw new StorageQuotaExceededError({
            usedBytes,
            quotaBytes,
            requestedBytes: encoded.buffer.length,
          });

        const insertedId = new ObjectId();
        const result = {
          id: insertedId.toString(),
          name: document.name,
          mimeType: encoded.mimeType,
          format: encoded.format,
          width: encoded.width,
          height: encoded.height,
          originalSize: encoded.originalSize,
          storedSize: encoded.storedSize,
          optimized: encoded.optimized,
          checksum: encoded.checksum,
        };
        await collection.insertOne(
          {
            ...this.buildImageDocument(document),
            _id: insertedId,
          },
          { session },
        );
        await idempotencyCollection.insertOne(
          {
            _id: idempotencyId,
            ownerId: document.owner.userId,
            idempotencyKey,
            fingerprint,
            imageId: insertedId.toString(),
            result,
            createdAt: new Date(),
          },
          { session },
        );
        return {
          acknowledged: true,
          insertedId,
          idempotencyResult: result,
          replayed: false,
        };
      });
    }

    return this.withOwnerTransaction(document.owner, async (session) => {
      const { usedBytes } = await this.getStorageUsage(document.owner, session);
      if (usedBytes > quotaBytes || encoded.buffer.length > quotaBytes - usedBytes)
        throw new StorageQuotaExceededError({
          usedBytes,
          quotaBytes,
          requestedBytes: encoded.buffer.length,
        });
      return collection.insertOne(insertDocument, { session });
    });
  }

  buildImageDocument(document) {
    const { encoded } = document;
    return {
      image: encoded.buffer,
      email: document.owner.email,
      ownerId: document.owner.userId,
      name: document.name,
      type: encoded.mimeType,
      size: encoded.storedSize,
      format: encoded.format,
      mimeType: encoded.mimeType,
      width: encoded.width,
      height: encoded.height,
      originalSize: encoded.originalSize,
      storedSize: encoded.storedSize,
      optimized: encoded.optimized,
      checksum: encoded.checksum,
      originalFormat: encoded.originalFormat,
      originalMimeType: encoded.originalMimeType,
      createdAt: new Date(),
    };
  }

  async delete(ids, owner) {
    const collection = await this.collection();

    return this.withOwnerTransaction(owner, (session) =>
      collection.deleteMany(
        {
          _id: {
            $in: ids.map((id) => new ObjectId(id)),
          },
          ...ownerFilter(owner),
        },
        { session },
      ),
    );
  }

  async withOwnerTransaction(owner, operation) {
    if (!owner?.userId)
      throw new Error("An authenticated image owner is required");

    const db = await getDb();
    const client = db.client;
    if (!client || typeof client.startSession !== "function")
      throw new Error("MongoDB transaction support is required for storage writes");

    const lockCollection = db.collection(QUOTA_LOCK_COLLECTION);
    try {
      await lockCollection.updateOne(
        { _id: owner.userId },
        { $setOnInsert: { revision: 0 } },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }

    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        await lockCollection.updateOne(
          { _id: owner.userId },
          { $inc: { revision: 1 } },
          { session },
        );
        result = await operation(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}

function toSafeNumber(value, description) {
  const number = typeof value?.toNumber === "function" ? value.toNumber() : value;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new StorageAccountingError(`Could not reliably calculate ${description}`);
  return number;
}

module.exports = storageService;
module.exports.StorageAccountingError = StorageAccountingError;
module.exports.StorageQuotaExceededError = StorageQuotaExceededError;
module.exports.IdempotencyKeyConflictError = IdempotencyKeyConflictError;
module.exports.validateStorageConfiguration = validateStorageConfiguration;
