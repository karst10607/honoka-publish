/**
 * Image handling: detect local images, upload to Notion Direct Upload API,
 * and replace references in block arrays.
 */
const fs = require("fs");
const path = require("path");
const { uploadFile } = require("./notion");

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

const MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Scan a document directory for image files.
 * @param {string} docDir
 * @returns {string[]} - Absolute paths to image files
 */
function findImages(docDir) {
  const imgDir = path.join(docDir, "images");
  if (!fs.existsSync(imgDir)) return [];

  return fs.readdirSync(imgDir)
    .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(imgDir, f));
}

/**
 * Upload all images in a directory to Notion, then rewrite blocks.
 *
 * @param {string} docDir - Document directory (containing images/)
 * @param {object[]} blocks - Notion block array (mutated in-place)
 * @param {string} token - Notion PAT
 * @returns {Promise<number>} - Number of images uploaded
 */
async function uploadImages(docDir, blocks, token) {
  const imagePaths = findImages(docDir);
  let uploaded = 0;

  for (const imgPath of imagePaths) {
    const filename = path.basename(imgPath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const localRef = `./images/${filename}`;

    try {
      const buffer = fs.readFileSync(imgPath);
      const fileId = await uploadFile(buffer, filename, contentType, token);

      // Replace matching external image blocks with file references
      for (const block of blocks) {
        if (
          block.type === "image" &&
          block.image?.type === "external" &&
          block.image.external?.url === localRef
        ) {
          block.image = {
            type: "file",
            file: { url: fileId },
          };
        }
      }

      uploaded++;
      console.log(`  📷 Uploaded: ${filename}`);
    } catch (err) {
      console.warn(`  ⚠  Image upload failed for ${filename}: ${err.message}`);
    }
  }

  return uploaded;
}

module.exports = { findImages, uploadImages };
