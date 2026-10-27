const { createHash, sharp } = require("../provider/dependency.map");
const {
  IMAGE_ENCODER_CONFIG,
  IMAGE_MIME_TYPES,
  MAX_DIMENSION,
  QUALITY,
  EFFORT,
} = require("../json/image.config.json");

const { limitInputPixels, DEFAULT_FORMAT, DEFAULT_QUALITY, failOn } =
  IMAGE_ENCODER_CONFIG;

function formatFromMetadata(metadata) {
  if (metadata.format && metadata.format in IMAGE_MIME_TYPES)
    return metadata.format;

  throw new Error("Unsupported image format");
}

module.exports = class ImageCodec {
  async encode(input, options) {
    const {
      format = DEFAULT_FORMAT,
      quality = DEFAULT_QUALITY,
      width,
      height,
    } = options;

    let image = sharp(input, { failOn, limitInputPixels });

    if (width || height) {
      image = image.resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    switch (format) {
      case "webp":
        return image.webp({ quality, effort: ENCODE_EFFORT }).toBuffer();

      case "jpeg":
        return image.jpeg({ quality, mozjpeg: true }).toBuffer();

      case "png":
        return image.png({ compressionLevel: 9 }).toBuffer();

      case "avif":
        return image.avif({ quality, effort: ENCODE_EFFORT }).toBuffer();

      default:
        throw new Error(`Unsupported image format: ${format}`);
    }
  }

  async encodeForStorage(input, options) {
    const {
      maxDimension = MAX_DIMENSION,
      quality = QUALITY,
      format = "webp",
      effort = EFFORT,
      forceConversion = false,
    } = options;

    const meta = await this.metadata(input);
    const originalFormat = formatFromMetadata(meta);
    const originalMimeType = IMAGE_MIME_TYPES[originalFormat];

    const needsResize =
      (meta.width ?? 0) > maxDimension || (meta.height ?? 0) > maxDimension;

    let image = sharp(input, { failOn, limitInputPixels }).rotate();

    if (needsResize)
      image = image.resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      });

    const outputFormat = format === "jpeg" && meta.hasAlpha ? "webp" : format;
    const optimized =
      outputFormat === "avif"
        ? await image.avif({ quality, effort }).toBuffer()
        : outputFormat === "jpeg"
          ? await image.jpeg({ quality, mozjpeg: true }).toBuffer()
          : outputFormat === "png"
            ? await image.png({ compressionLevel: 9 }).toBuffer()
            : await image.webp({ quality, effort }).toBuffer();

    if (needsResize && optimized.length >= input.length && !forceConversion)
      throw new Error(
        "The resized image could not be stored within the size limit",
      );

    const optimizedSelected =
      forceConversion || optimized.length < input.length;
    const smaller = optimizedSelected ? optimized : input;
    const outMeta = await this.metadata(smaller);
    const storedFormat = formatFromMetadata(outMeta);
    const storedSize = smaller.length;

    return {
      buffer: smaller,
      format: storedFormat,
      mimeType: IMAGE_MIME_TYPES[storedFormat],
      width: outMeta.width ?? 0,
      height: outMeta.height ?? 0,
      originalSize: input.length,
      storedSize,
      optimized: optimizedSelected,
      checksum: createHash("sha256").update(smaller).digest("hex"),
      originalFormat,
      originalMimeType,
    };
  }

  async decode(input) {
    const image = sharp(input, { failOn, limitInputPixels });
    const metadata = await image.metadata();
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    return {
      data,
      metadata: { ...metadata, width, height, channels },
    };
  }

  async metadata(input) {
    return sharp(input, { failOn, limitInputPixels }).metadata();
  }

  async validate(input) {
    try {
      await sharp(input, { failOn, limitInputPixels }).metadata();
      return true;
    } catch {
      return false;
    }
  }
};
