const { DATA_URL_PATTERN, BASE64_PATTERN } = require("../enums/regex.enums");

module.exports = function decodeBase64Image(input, maxBytes) {
  if (typeof input !== "string" || input.trim().length === 0)
    throw new Error("Image data is required");

  const value = input.trim();
  const dataUrl = value.match(DATA_URL_PATTERN);
  const declaredMimeType = dataUrl?.[1]?.toLowerCase();
  const encoded = (dataUrl?.[2] ?? value).replace(/\s/g, "");

  if (dataUrl && !declaredMimeType?.startsWith("image/"))
    throw new Error("The image data URL must declare an image MIME type");

  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !BASE64_PATTERN.test(encoded)
  )
    throw new Error("Invalid Base64 image data");

  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const estimatedBytes = (encoded.length / 4) * 3 - padding;

  if (estimatedBytes > maxBytes)
    throw new Error("Image payload exceeds the configured size limit");

  const buffer = Buffer.from(encoded, "base64");

  if (buffer.length === 0) throw new Error("Decoded image data is empty");

  if (buffer.length > maxBytes)
    throw new Error("Decoded image exceeds the configured size limit");

  return { buffer, declaredMimeType };
};
