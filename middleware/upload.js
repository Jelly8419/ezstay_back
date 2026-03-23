const multer = require('multer');
const path = require('path');
const fs = require('fs');

const isProduction = process.env.NODE_ENV === 'production';

let s3Client, PutObjectCommand, DeleteObjectCommand;
const BUCKET_NAME = 'ezstay-images';

if (isProduction) {
  const { S3Client, PutObjectCommand: Put, DeleteObjectCommand: Del } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({ region: 'ap-northeast-2' });
  PutObjectCommand = Put;
  DeleteObjectCommand = Del;
}

// 로컬용 디스크 스토리지
const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, '../uploads/rooms');
if (!isProduction && !fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = isProduction
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadDir),
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `room-${uniqueSuffix}${ext}`);
      }
    });

const fileFilter = (req, file, cb) => {
  const allowedExtensions = /jpeg|jpg|png|webp/;
  const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
  if (extname) {
    cb(null, true);
  } else {
    cb(new Error('이미지 파일만 업로드 가능합니다. (jpeg, jpg, png, webp)'));
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// S3 업로드 (프로덕션만)
const uploadToS3 = async (file) => {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const ext = path.extname(file.originalname);
  const key = `rooms/room-${uniqueSuffix}${ext}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return `https://images.ezstay.io/${key}`;
};

// S3 삭제 (프로덕션만)
const deleteFromS3 = async (url) => {
  try {
    // CDN(images.ezstay.io) 또는 S3 직접 URL 둘 다 지원
    const key = url.includes('images.ezstay.io/')
      ? url.split('images.ezstay.io/')[1]
      : url.split('.amazonaws.com/')[1];
    if (key) {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }));
    }
  } catch (err) {
    console.error('S3 delete error:', err);
  }
};

// 파일 URL 생성 (환경별)
const getFileUrl = async (file) => {
  if (isProduction) {
    return await uploadToS3(file);
  }
  return `/uploads/rooms/${file.filename}`;
};

const uploadRoomPhotos = upload.array('photos', 20);
const uploadSingleImage = upload.single('image');

module.exports = {
  uploadRoomPhotos,
  uploadSingleImage,
  uploadToS3,
  deleteFromS3,
  getFileUrl
};