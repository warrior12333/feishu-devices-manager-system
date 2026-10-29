/**
 * 图片压缩：上传的设备/借还照片统一转 JPEG。
 *  - 按 EXIF 自动摆正方向；
 *  - 长边超过 1600px 等比缩小（不放大）；
 *  - 质量 80（mozjpeg），手机原图 3-8MB 通常可压至 100-300KB。
 */
const sharp = require('sharp');

const MAX_WIDTH = 1600;
const QUALITY = 80;

async function compressToJpeg(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();
}

module.exports = { compressToJpeg };
