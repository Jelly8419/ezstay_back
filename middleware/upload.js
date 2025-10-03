const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 업로드 디렉토리 설정 (환경변수 또는 기본값)
const uploadDir = process.env.UPLOAD_PATH || path.join(__dirname, '../uploads/rooms');

// 업로드 디렉토리 생성
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 스토리지 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `room-${uniqueSuffix}${ext}`);
  }
});

// 파일 필터 (이미지만 허용)
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

  // 확장자가 이미지 파일이면 허용 (mimetype이 'application/octet-stream'으로 오는 경우 대비)
  if (extname) {
    cb(null, true);
  } else {
    cb(new Error('이미지 파일만 업로드 가능합니다. (jpeg, jpg, png, gif, webp)'));
  }
};

// multer 인스턴스
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB 제한
  },
  fileFilter: fileFilter
});

// 방 사진 업로드 (6~20장)
const uploadRoomPhotos = upload.array('photos', 20);

// 단일 이미지 업로드 (청소도구 이미지)
const uploadSingleImage = upload.single('image');

module.exports = {
  uploadRoomPhotos,
  uploadSingleImage
};
