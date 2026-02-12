const multer = require('multer');

/**
 * 전역 에러 핸들러
 * 모든 에러를 일관된 형식으로 처리하고 민감한 정보 노출 방지
 */
const errorHandler = (err, req, res, next) => {
  // 에러 로깅 (프로덕션에서는 로깅 서비스 사용 권장)
  console.error('Error occurred:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method
  });

  // Multer 에러 처리
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        code: 4103,
        message: '파일 크기가 너무 큽니다. (최대 10MB)'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        code: 4105,
        message: '파일 개수가 초과되었습니다.'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        code: 4102,
        message: '예상치 못한 필드에서 파일이 업로드되었습니다.'
      });
    }
    return res.status(400).json({
      success: false,
      code: 4101,
      message: err.message || '파일 업로드 중 오류가 발생했습니다.'
    });
  }

  // JWT 에러 처리
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      code: 1002,
      message: '유효하지 않은 토큰입니다.'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      code: 1003,
      message: '토큰이 만료되었습니다.'
    });
  }

  // Sequelize 에러 처리
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      success: false,
      code: 4001,
      message: '입력값이 유효하지 않습니다.',
      details: process.env.NODE_ENV === 'development' ? err.errors.map(e => e.message) : undefined
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({
      success: false,
      code: 4006,
      message: '이미 존재하는 데이터입니다.'
    });
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      success: false,
      code: 4001,
      message: '참조 무결성 제약 조건 위반입니다.'
    });
  }

  // 커스텀 에러 메시지가 있는 경우
  if (err.message && err.message.includes('이미지 파일만 업로드 가능합니다')) {
    return res.status(400).json({
      success: false,
      code: 4102,
      message: err.message
    });
  }

  // 기본 에러 응답
  const statusCode = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? '서버 오류가 발생했습니다.'
    : err.message || '서버 오류가 발생했습니다.';

  res.status(statusCode).json({
    success: false,
    code: err.code || 5001,
    message: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

/**
 * 404 Not Found 핸들러
 */
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    code: 3001,
    message: '요청한 리소스를 찾을 수 없습니다요.',
    path: req.path
  });
};

module.exports = {
  errorHandler,
  notFoundHandler
};
