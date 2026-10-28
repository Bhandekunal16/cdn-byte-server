const { validateEmail } = require("../enums/regex.enums");
const UnifiedResponse = require("../core/unified-response");
const {
  base64Service,
  imageServiceInstance,
  storageServiceInstance,
} = require("../provider/service.map");
const { ObjectId, multer } = require("../provider/dependency.map");
const { IMAGE_STORAGE, IMAGE_CONFIG } = require("../provider/config.map");

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

module.exports = function storageRoutes(app) {
  app.post("/image", upload.single("image"), async (req, res) => {
    try {
      const imageFile = req.file;
      const imageBase64 = req.body?.image;
      const email = req.body?.email;

      if (!imageFile && typeof imageBase64 !== "string")
        return res
          .status(400)
          .json(new UnifiedResponse(required, 400, false, {}));

      if (typeof email !== "string" || !validateEmail(email.trim()))
        return res
          .status(400)
          .json(new UnifiedResponse(not_valid, 400, false, {}));

      const name = imageFile?.originalname || "uploaded-image";

      if (imageFile && imageFile.size > MONGO_IMAGE_MAX_BYTES)
        return res
          .status(413)
          .json(new UnifiedResponse(size_exceed, 413, false, {}));

      const decoded = imageFile
        ? {
            buffer: imageFile.buffer,
            declaredMimeType: imageFile.mimetype,
          }
        : base64Service(imageBase64, MONGO_IMAGE_MAX_BYTES);

      if (decoded.buffer.length > MONGO_IMAGE_MAX_BYTES) {
        return res
          .status(413)
          .json(new UnifiedResponse(size_exceed, 413, false, {}));
      }

      const requestedFormat = req.body?.format;

      const format =
        typeof requestedFormat === "string" &&
        ["jpeg", "png", "webp", "avif"].includes(requestedFormat)
          ? requestedFormat
          : undefined;

      let encoded;

      try {
        encoded = await imageServiceInstance.encodeForStorage(decoded.buffer, {
          format,
        });
      } catch {
        return res
          .status(400)
          .json(new UnifiedResponse(unsupported, 400, false, {}));
      }

      let inserted;

      try {
        inserted = await storageServiceInstance.insert({
          encoded,
          email: email.trim().toLowerCase(),
          name,
        });
      } catch {
        return res
          .status(500)
          .json(new UnifiedResponse(not_be_stored, 500, false, {}));
      }

      const success = inserted.acknowledged;

      return res.status(success ? 200 : 500).json(
        new UnifiedResponse(
          success ? uploaded : upload_failed,
          success ? 200 : 500,
          success,
          success
            ? {
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
        ),
      );
    } catch (error) {
      if (
        error instanceof multer.MulterError &&
        error.code === "LIMIT_FILE_SIZE"
      ) {
        return res
          .status(413)
          .json(new UnifiedResponse(size_exceed, 413, false, {}));
      }

      return res
        .status(400)
        .json(new UnifiedResponse(unsupported, 400, false, {}));
    }
  });

  app.get("/image", async (req, res, next) => {
    try {
      const email =
        typeof req.query.email === "string"
          ? req.query.email.trim().toLowerCase()
          : undefined;

      const id =
        typeof req.query.id === "string" ? req.query.id.trim() : undefined;

      if ((!email && !id) || (email && id)) {
        return res
          .status(400)
          .json(new UnifiedResponse(email_OR_id_missing, 400, false, []));
      }

      if (email && !validateEmail(email)) {
        return res
          .status(400)
          .json(new UnifiedResponse(invalid_gmail, 400, false, []));
      }

      if (id && !ObjectId.isValid(id)) {
        return res
          .status(400)
          .json(new UnifiedResponse(invalid_id, 400, false, []));
      }

      if (id) {
        const result = await storageServiceInstance.readImage(new ObjectId(id));

        if (!result) {
          return res
            .status(404)
            .json(new UnifiedResponse(not_found, 404, false, {}));
        }

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

      const images = await storageServiceInstance.getImageMetaData(email);
      const success = images.length > 0;

      return res
        .status(success ? 200 : 404)
        .json(
          new UnifiedResponse(
            success ? found : not_found,
            success ? 200 : 404,
            success,
            images,
          ),
        );
    } catch (error) {
      if (res.headersSent) {
        return next(error);
      }

      return res
        .status(500)
        .json(new UnifiedResponse(failed_to_fetch, 500, false, []));
    }
  });

  app.delete("/image", async (req, res) => {
    try {
      const { ids } = req.body || {};

      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
        return res
          .status(400)
          .json(new UnifiedResponse(id_required, 400, false, {}));
      }

      const objectIds = [];

      for (const id of ids) {
        if (typeof id !== "string" || !ObjectId.isValid(id)) {
          return res
            .status(400)
            .json(new UnifiedResponse(id_required, 400, false, {}));
        }

        objectIds.push(new ObjectId(id));
      }

      const { deletedCount } = await storageServiceInstance.delete(objectIds);

      if (deletedCount === 0) {
        return res
          .status(404)
          .json(
            new UnifiedResponse(not_found, 404, false, { deletedCount: 0 }),
          );
      }

      return res
        .status(200)
        .json(new UnifiedResponse(deleted, 200, true, { deletedCount }));
    } catch (error) {
      console.error("DELETE /image failed:", error);

      return res
        .status(500)
        .json(new UnifiedResponse(failed_to_delete, 500, false, {}));
    }
  });
};
