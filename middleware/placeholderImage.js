const fs = require('fs');
const path = require('path');

/**
 * 이미지가 없을 때 placeholder 이미지를 반환하는 미들웨어
 * /uploads/* 경로로 요청이 왔을 때, 파일이 없으면 dummy_room 이미지를 반환
 */
function placeholderImageMiddleware(req, res, next) {
  try {
    // 실제 업로드 경로 (C:\study\uploads\rooms)
    const uploadsPath = process.env.UPLOAD_PATH || 'C:\\study\\uploads\\rooms';

    console.log('[PlaceholderImage] 요청 경로:', req.path);
    console.log('[PlaceholderImage] 업로드 경로:', uploadsPath);

    // 요청된 파일 경로 생성
    // server.js에서 app.use('/uploads', ...)로 설정되어 있으므로
    // req.path에는 /uploads가 이미 제거되어 있음
    // 예: /rooms/room-xxx.png -> C:\study\uploads\rooms\room-xxx.png
    // /rooms 부분만 제거하면 됨
    const relativePath = req.path.replace(/^\/rooms\/?/, '');
    const requestedFile = path.join(uploadsPath, relativePath);

    console.log('[PlaceholderImage] 상대 경로:', relativePath);
    console.log('[PlaceholderImage] 요청된 파일:', requestedFile);

    // 파일이 존재하면 정상적으로 처리
    if (fs.existsSync(requestedFile)) {
      console.log('[PlaceholderImage] 파일 존재, 전송');
      return res.sendFile(requestedFile);
    }

    console.log('[PlaceholderImage] 파일 없음, dummy_room 찾기');

    // 파일이 없으면 dummy_room 이미지 찾기
    const dummyImageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    let dummyImagePath = null;

    for (const ext of dummyImageExtensions) {
      const testPath = path.join(uploadsPath, `dummy_room${ext}`);
      if (fs.existsSync(testPath)) {
        dummyImagePath = testPath;
        console.log('[PlaceholderImage] dummy_room 발견:', dummyImagePath);
        break;
      }
    }

    // dummy_room 이미지가 있으면 반환
    if (dummyImagePath) {
      console.log('[PlaceholderImage] dummy_room 전송');
      return res.sendFile(dummyImagePath);
    }

    console.log('[PlaceholderImage] SVG placeholder 생성');
    // dummy_room 이미지도 없으면 SVG placeholder 생성
    return res.type('svg').send(generatePlaceholderSVG(req.path));
  } catch (error) {
    console.error('[PlaceholderImage] 에러:', error);
    next(error);
  }
}

/**
 * SVG 형식의 placeholder 이미지 생성
 */
function generatePlaceholderSVG(imagePath) {
  // 파일명에서 숫자 추출 (room123_photo1.jpg -> 123, 1)
  const match = imagePath.match(/room(\d+)_photo(\d+)/);
  const roomNumber = match ? match[1] : '?';
  const photoNumber = match ? match[2] : '?';

  return `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e0e0e0"/>
      <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="48" fill="#757575" text-anchor="middle">
        Room ${roomNumber}
      </text>
      <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="32" fill="#9e9e9e" text-anchor="middle">
        Photo ${photoNumber}
      </text>
      <text x="50%" y="65%" font-family="Arial, sans-serif" font-size="16" fill="#bdbdbd" text-anchor="middle">
        Placeholder Image
      </text>
    </svg>
  `;
}

module.exports = placeholderImageMiddleware;
