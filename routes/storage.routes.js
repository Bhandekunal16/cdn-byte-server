const { validateEmail } = require("../enums/regex.enums");
const {
  base64Service,
  imageServiceInstance,
  storageServiceInstance,
  ok,
  failed,
} = require("../provider/service.map");
const { ObjectId, multer } = require("../provider/dependency.map");
const {
  IMAGE_STORAGE,
  IMAGE_CONFIG,
  STORAGE_QUOTA_BYTES,
  STORAGE_WARNING_INFO_PERCENT,
  STORAGE_WARNING_PROMINENT_PERCENT,
} = require("../provider/config.map");
const { httpResponse } = require("../core/unified-response.js");
const requireAuthentication = require("../middleware/auth.middleware");
const { normalizeEmail } = require("../enums/regex.enums");
const {
  StorageQuotaExceededError,
  IdempotencyKeyConflictError,
} = require("../service/storage.service");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_STORAGE.MONGO_IMAGE_MAX_BYTES },
});

const { MONGO_IMAGE_MAX_BYTES } = IMAGE_STORAGE;
const { UPLOAD_ERRORS, IMAGE_STATE } = IMAGE_CONFIG;

const {
  required,
  not_valid,
  size_exceed,
  unsupported,
  not_be_stored,
  email_OR_id_missing,
  invalid_gmail,
  failed_to_fetch,
  invalid_id,
  id_required,
} = UPLOAD_ERRORS;

const { not_found, uploaded, upload_failed, found, deleted, failed_to_delete } =
  IMAGE_STATE;

function getWarningLevel(usagePercentage) {
  if (usagePercentage >= 100) return "full";
  if (usagePercentage >= STORAGE_WARNING_PROMINENT_PERCENT) return "warning";
  if (usagePercentage >= STORAGE_WARNING_INFO_PERCENT) return "info";
  return "normal";
}

module.exports = function storageRoutes(app) {
  app.get("/storage/usage", requireAuthentication, async (req, res) => {
    try {
      const { usedBytes, imageCount } =
        await storageServiceInstance.getStorageUsage(req.auth);
      const availableBytes = Math.max(STORAGE_QUOTA_BYTES - usedBytes, 0);
      const usagePercentage = Math.min(
        100,
        Math.round((usedBytes / STORAGE_QUOTA_BYTES) * 100),
      );

      return httpResponse(res, 200, {
        msg: "Storage usage retrieved successfully",
        status: true,
        data: {
          usedBytes,
          quotaBytes: STORAGE_QUOTA_BYTES,
          availableBytes,
          usagePercentage,
          imageCount,
          warningLevel: getWarningLevel(usagePercentage),
          idempotencySupported: true,
        },
      });
    } catch {
      return httpResponse(res, 500, {
        msg: "Could not reliably calculate storage usage",
        status: false,
        data: { errorCode: "STORAGE_USAGE_UNAVAILABLE" },
      });
    }
  });

  app.post("/image", requireAuthentication, upload.single("image"), async (req, res) => {
    try {
      const { file, body } = req;
      const imageFile = file;
      const { image: imageBase64, email } = body;
      const idempotencyKey = req.get("Idempotency-Key");

      if (
        idempotencyKey !== undefined &&
        !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)
      )
        return httpResponse(res, 400, {
          msg: "Idempotency-Key must contain 8 to 128 safe characters",
          status: false,
          data: { errorCode: "IDEMPOTENCY_KEY_INVALID" },
        });

      if (!imageFile && typeof imageBase64 !== "string")
        return httpResponse(res, 400, { msg: required, ...failed, data: {} });

      if (
        email !== undefined &&
        (typeof email !== "string" ||
          normalizeEmail(email) !== req.auth.email)
      )
        return httpResponse(res, 403, {
          msg: "Image owner does not match the authenticated account",
          ...failed,
          data: {},
        });

      if (!req.auth.userId || !validateEmail(req.auth.email))
        return httpResponse(res, 400, { msg: not_valid, ...failed, data: {} });

      const name = imageFile?.originalname || "uploaded-image";

      if (imageFile && imageFile.size > MONGO_IMAGE_MAX_BYTES)
        return httpResponse(res, 413, {
          msg: size_exceed,
          ...failed,
          data: {},
        });

      const decoded = imageFile
        ? {
            buffer: imageFile.buffer,
            declaredMimeType: imageFile.mimetype,
          }
        : base64Service(imageBase64, MONGO_IMAGE_MAX_BYTES);

      if (decoded.buffer.length > MONGO_IMAGE_MAX_BYTES)
        return httpResponse(res, 413, {
          msg: size_exceed,
          ...failed,
          data: {},
        });

      const requestedFormat = req.body?.format;

      const format =
        typeof requestedFormat === "string" &&
        ["jpeg", "png", "webp", "avif"].includes(requestedFormat)
          ? requestedFormat
          : undefined;

      let encoded, inserted;

      try {
        encoded = await imageServiceInstance.encodeForStorage(decoded.buffer, {
          format,
        });
      } catch {
        return httpResponse(res, 400, {
          msg: unsupported,
          ...failed,
          data: {},
        });
      }

      try {
        const document = { encoded, owner: req.auth, name };
        inserted =
          idempotencyKey === undefined
            ? await storageServiceInstance.insert(document, STORAGE_QUOTA_BYTES)
            : await storageServiceInstance.insert(
                document,
                STORAGE_QUOTA_BYTES,
                idempotencyKey,
              );
      } catch (error) {
        if (error instanceof IdempotencyKeyConflictError)
          return httpResponse(res, 409, {
            msg: error.message,
            status: false,
            data: { errorCode: "IDEMPOTENCY_KEY_REUSED" },
          });
        if (error instanceof StorageQuotaExceededError)
          return httpResponse(res, 409, {
            msg: error.message,
            status: false,
            data: {
              errorCode: "STORAGE_QUOTA_EXCEEDED",
              usedBytes: error.usedBytes,
              quotaBytes: error.quotaBytes,
              availableBytes: error.availableBytes,
              requestedBytes: error.requestedBytes,
            },
          });
        return httpResponse(res, 500, {
          msg: not_be_stored,
          ...failed,
          data: {},
        });
      }

      const success = inserted.acknowledged;

      return httpResponse(res, success ? 200 : 500, {
        msg: success ? uploaded : upload_failed,
        status: success ? true : false,
        data: success
          ? inserted.idempotencyResult ?? {
              id: inserted.insertedId,
              name,
              mimeType: encoded.mimeType,
              format: encoded.format,
              width: encoded.width,
              height: encoded.height,
              originalSize: encoded.originalSize,
              storedSize: encoded.storedSize,
              optimized: encoded.optimized,
              checksum: encoded.checksum,
            }
          : {},
      });
    } catch (e) {
      if (e instanceof multer.MulterError && e.code === "LIMIT_FILE_SIZE")
        return httpResponse(res, 413, {
          msg: size_exceed,
          ...failed,
          data: {},
        });

      return httpResponse(res, 400, { msg: unsupported, ...failed, data: {} });
    }
  });

  app.get("/image", requireAuthentication, async (req, res, next) => {
    try {
      const emailParam = req.query.email;
      if (emailParam !== undefined && typeof emailParam !== "string")
        return httpResponse(res, 400, {
          msg: email_OR_id_missing,
          ...failed,
          data: [],
        });

      const email = typeof emailParam === "string" ? emailParam.trim() : undefined;

      const id =
        typeof req.query.id === "string" ? req.query.id.trim() : undefined;

      if (email && id)
        return httpResponse(res, 400, {
          msg: email_OR_id_missing,
          ...failed,
          data: [],
        });

      if (email && !validateEmail(email))
        return httpResponse(res, 400, {
          msg: invalid_gmail,
          ...failed,
          data: [],
        });

      if (email && normalizeEmail(email) !== req.auth.email)
        return httpResponse(res, 403, {
          msg: "Image owner does not match the authenticated account",
          ...failed,
          data: [],
        });

      if (id && !ObjectId.isValid(id))
        return httpResponse(res, 400, { msg: invalid_id, ...failed, data: [] });

      if (id) {
        const result = await storageServiceInstance.readImage(
          new ObjectId(id),
          req.auth,
        );

        if (!result)
          return httpResponse(res, 404, {
            msg: not_found,
            ...failed,
            data: {},
          });

        return res
          .status(200)
          .set({
            "Content-Type": result.mimeType,
            "Content-Length": String(result.buffer.length),
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition":
              req.query.download === "1" ? "attachment" : "inline",
            "X-Content-Type-Options": "nosniff",
          })
          .send(result.buffer);
      }

      if (!validateEmail(req.auth.email))
        return httpResponse(res, 400, {
          msg: invalid_gmail,
          ...failed,
          data: [],
        });

      const images = await storageServiceInstance.getImageMetaData(req.auth);
      const success = images.length > 0;

      return httpResponse(res, success ? 200 : 404, {
        msg: success ? found : not_found,
        ...ok,
        data: images,
      });
    } catch (e) {
      return res.headersSent
        ? next(e)
        : httpResponse(res, 500, {
            msg: failed_to_fetch,
            ...failed,
            data: [],
          });
    }
  });

  app.delete("/image", requireAuthentication, async (req, res) => {
    try {
      const { ids } = req.body || {};

      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100)
        return httpResponse(res, 400, {
          msg: id_required,
          ...failed,
          data: {},
        });

      const objectIds = [];

      for (const id of ids) {
        if (typeof id !== "string" || !ObjectId.isValid(id))
          return httpResponse(res, 400, {
            msg: id_required,
            ...failed,
            data: {},
          });

        objectIds.push(new ObjectId(id));
      }

      const { deletedCount } = await storageServiceInstance.delete(
        objectIds,
        req.auth,
      );

      if (deletedCount === 0)
        return httpResponse(res, 404, {
          msg: not_found,
          ...failed,
          data: { deletedCount: 0 },
        });

      return httpResponse(res, 200, {
        msg: deleted,
        ...ok,
        data: deletedCount,
      });
    } catch (e) {
      return httpResponse(res, 500, {
        msg: failed_to_delete,
        ...failed,
        data: e.message,
      });
    }
  });
};
