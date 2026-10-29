const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { compressToJpeg } = require('../utils/image');
const { requireAuth, httpError } = require('../middleware/auth');

const router = express.Router();
fs.mkdirSync(config.uploadDir, { recursive: true });

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) return cb(httpError(400, '仅支持 jpg / png / webp 图片'));
    cb(null, true);
  },
});

/** 压缩落盘:转 JPEG(长边1600/质量80),返回文件名 */
async function saveCompressed(buffer) {
  const buf = await compressToJpeg(buffer);
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(config.uploadDir, name), buf);
  return name;
}

router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, '请选择图片');
    // 服务端压缩后落盘，返回站内相对路径，前端按同源展示
    const name = await saveCompressed(req.file.buffer);
    res.json({ url: `/uploads/${name}` });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
