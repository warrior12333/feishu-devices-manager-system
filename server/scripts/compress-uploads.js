/**
 * 一次性脚本:批量压缩 uploads 目录的存量图片。
 * 用法:cd server && node scripts/compress-uploads.js
 * 规则:跳过 logo.png / 已是压缩 JPEG 的小文件;原图先备份到 uploads_backup.tar.gz。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

const UPLOAD_DIR = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || './uploads');
const MIN_SIZE = 150 * 1024; // 小于 150KB 的视为已压缩,跳过

(async () => {
  const files = fs.readdirSync(UPLOAD_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const targets = files.filter((f) => f !== 'white.png' && fs.statSync(path.join(UPLOAD_DIR, f)).size > MIN_SIZE);
  console.log(`共 ${files.length} 个文件,待压缩 ${targets.length} 个(>150KB)`);

  if (targets.length) {
    const backup = path.resolve(__dirname, '..', 'uploads_backup.tar.gz');
    execSync(`tar -czf ${backup} -C ${UPLOAD_DIR} ${targets.join(' ')}`);
    console.log(`✓ 原图已备份: ${backup}`);
  }

  let before = 0;
  let after = 0;
  for (const f of targets) {
    const full = path.join(UPLOAD_DIR, f);
    const orig = fs.statSync(full).size;
    try {
      const buf = await sharp(full).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      const jpgName = f.replace(/\.(png|webp)$/i, '.jpg');
      const jpgFull = path.join(UPLOAD_DIR, jpgName);
      if (buf.length < orig) {
        fs.writeFileSync(jpgFull, buf);
        if (jpgName !== f) fs.unlinkSync(full); // png/webp 转 jpg 后移除原文件
        before += orig;
        after += buf.length;
        console.log(`✓ ${f}: ${(orig / 1024).toFixed(0)}KB -> ${(buf.length / 1024).toFixed(0)}KB`);
      } else {
        console.log(`- ${f}: 已足够小,跳过`);
      }
    } catch (e) {
      console.error(`✗ ${f}: ${e.message}`);
    }
  }
  console.log(`完成: ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`);
})();
