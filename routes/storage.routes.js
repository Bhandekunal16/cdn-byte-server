const { validateEmail } = require("../enums/regex.enums");
const {
  base64Service,
  imageServiceInstance,
  storageServiceInstance,
  UnifiedResponse,
  httpResponse,
  ok,
  failed,
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
        return httpResponse(res, 400, { msg: required, ...failed, data: {} });

      if (typeof email !== "string" || !validateEmail(email.trim()))
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
        inserted = await storageServiceInstance.insert({
          encoded,
          email: email.trim().toLowerCase(),
          name,
        });
      } catch {
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
      });
    } catch (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
        return httpResponse(res, 413, {
          msg: size_exceed,
          ...failed,
          data: {},
        });

      return httpResponse(res, 400, { msg: unsupported, ...failed, data: {} });
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

      if ((!email && !id) || (email && id))
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

      if (id && !ObjectId.isValid(id))
        return httpResponse(res, 400, { msg: invalid_id, ...failed, data: [] });

      if (id) {
        const result = await storageServiceInstance.readImage(new ObjectId(id));

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

      const images = await storageServiceInstance.getImageMetaData(email);
      const success = images.length > 0;

      return httpResponse(res, success ? 200 : 404, {
        msg: success ? found : not_found,
        ...ok,
        data: images,
      });
    } catch (error) {
      return res.headersSent
        ? next(error)
        : httpResponse(res, 500, {
            msg: failed_to_fetch,
            ...failed,
            data: [],
          });
    }
  });

  app.delete("/image", async (req, res) => {
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

      const { deletedCount } = await storageServiceInstance.delete(objectIds);

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
    } catch (error) {
      console.error("DELETE /image failed:", error);
      return httpResponse(res, 500, {
        msg: failed_to_delete,
        ...failed,
        data: {},
      });
    }
  });
};
