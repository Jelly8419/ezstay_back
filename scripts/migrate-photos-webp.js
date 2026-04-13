/**
 * migrate-photos-webp.js
 * 기존 S3 사진을 WebP로 변환 후 재업로드, DB URL 일괄 업데이트
 *
 * 동작 방식:
 *   1. room_photos에서 고유 URL 목록 조회
 *   2. S3에서 원본 다운로드 → sharp로 리사이징 + WebP 변환 → S3 재업로드
 *   3. DB에서 기존 URL → 새 URL 일괄 업데이트
 *   4. S3 원본 삭제 (--keep-original 옵션으로 생략 가능)
 *
 * 사용법:
 *   node scripts/migrate-photos-webp.js              # 변환 + 원본 삭제
 *   node scripts/migrate-photos-webp.js --dry-run    # 실제 변환 없이 대상만 출력
 *   node scripts/migrate-photos-webp.js --keep-original  # 원본 S3 파일 유지
 */

'use strict';

require('dotenv').config();
const sharp = require('sharp');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { sequelize, RoomPhoto } = require('../models');
const { Op } = require('sequelize');

const BUCKET_NAME = 'ezstay-images';
const CDN_BASE    = 'https://images.ezstay.io/';
const S3_BASE     = `https://${BUCKET_NAME}.s3.ap-northeast-2.amazonaws.com/`;
const s3 = new S3Client({ region: 'ap-northeast-2' });

const RESIZE_CONFIG = { maxWidth: 1200, maxHeight: 900, quality: 82 };

const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const KEEP_ORIGIN = args.includes('--keep-original');

// ── URL → S3 key 추출 (CDN URL, S3 직접 URL 둘 다 지원) ───────
const urlToKey = (url) => {
  if (url.includes('images.ezstay.io/')) return url.replace(CDN_BASE, '');
  if (url.includes('.amazonaws.com/'))   return url.replace(S3_BASE, '');
  return null;
};

// ── S3에서 버퍼 다운로드 ──────────────────────────────────────
const downloadFromS3 = (key) => new Promise((resolve, reject) => {
  s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }))
    .then(({ Body }) => {
      const chunks = [];
      Body.on('data', c => chunks.push(c));
      Body.on('end',  () => resolve(Buffer.concat(chunks)));
      Body.on('error', reject);
    })
    .catch(reject);
});

// ── WebP 변환 후 S3 업로드 ────────────────────────────────────
const convertAndUpload = async (originalKey) => {
  const buffer = await downloadFromS3(originalKey);

  const webpBuffer = await sharp(buffer)
    .resize(RESIZE_CONFIG.maxWidth, RESIZE_CONFIG.maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: RESIZE_CONFIG.quality })
    .toBuffer();

  // 확장자만 .webp로 교체
  const newKey = originalKey.replace(/\.[^.]+$/, '.webp');

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: newKey,
    Body: webpBuffer,
    ContentType: 'image/webp',
  }));

  return { newKey, originalSizeKB: Math.round(buffer.length / 1024), newSizeKB: Math.round(webpBuffer.length / 1024) };
};

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  await sequelize.authenticate();

  console.log('\n' + '═'.repeat(60));
  console.log(' 📸 room_photos WebP 마이그레이션');
  if (DRY_RUN)     console.log(' ⚠️  DRY RUN 모드 — 실제 변환/업로드 없음');
  if (KEEP_ORIGIN) console.log(' ℹ️  원본 S3 파일 유지');
  console.log('═'.repeat(60) + '\n');

  // 1. 고유 URL 목록 조회
  //    - CDN URL (images.ezstay.io) 중 아직 webp 아닌 것
  //    - S3 직접 URL (amazonaws.com) → CDN + WebP로 변환
  const rows = await RoomPhoto.findAll({
    attributes: [[sequelize.fn('DISTINCT', sequelize.col('url')), 'url']],
    where: {
      [Op.or]: [
        // CDN URL인데 아직 webp 아닌 것
        {
          url: {
            [Op.like]: `${CDN_BASE}%`,
            [Op.notLike]: '%.webp',
          }
        },
        // S3 직접 URL (CDN 미적용)
        { url: { [Op.like]: `${S3_BASE}%` } },
      ]
    },
    raw: true,
  });

  const urls = rows.map(r => r.url);
  console.log(`🔍 변환 대상 고유 URL: ${urls.length}개\n`);

  if (urls.length === 0) {
    console.log('✅ 변환할 사진이 없습니다.');
    await sequelize.close();
    return;
  }

  if (DRY_RUN) {
    urls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
    await sequelize.close();
    return;
  }

  // 2. URL별 변환 + DB 업데이트
  let successCount = 0;
  let errorCount   = 0;
  let savedKB      = 0;

  for (let i = 0; i < urls.length; i++) {
    const originalUrl = urls[i];
    const originalKey = urlToKey(originalUrl);

    if (!originalKey) {
      console.log(`  [${i + 1}/${urls.length}] ⚠️  URL 형식 불일치, 건너뜀: ${originalUrl}`);
      errorCount++;
      continue;
    }

    const urlType = originalUrl.includes('.amazonaws.com') ? '[S3직접]' : '[CDN]  ';
    process.stdout.write(`  [${i + 1}/${urls.length}] ${urlType} ${originalKey} ... `);

    try {
      const { newKey, originalSizeKB, newSizeKB } = await convertAndUpload(originalKey);
      const newUrl = `${CDN_BASE}${newKey}`;
      const diff   = originalSizeKB - newSizeKB;
      savedKB     += diff;

      // DB 일괄 업데이트 (같은 URL 참조하는 행 전부)
      const updated = await RoomPhoto.update(
        { url: newUrl },
        { where: { url: originalUrl } }
      );

      // 원본 S3 삭제
      if (!KEEP_ORIGIN && originalKey !== newKey) {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: originalKey }));
      }

      console.log(`✅ ${originalSizeKB}KB → ${newSizeKB}KB (-${diff}KB) | DB ${updated[0]}행 업데이트`);
      successCount++;
    } catch (err) {
      console.log(`❌ 실패: ${err.message}`);
      errorCount++;
    }
  }

  // 3. 결과 요약
  console.log('\n' + '═'.repeat(60));
  console.log(' 📋 완료');
  console.log(`   성공: ${successCount}개 / 실패: ${errorCount}개`);
  console.log(`   절감: 약 ${Math.round(savedKB / 1024 * 10) / 10}MB`);
  console.log('═'.repeat(60) + '\n');

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('\n❌ 오류:', err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
