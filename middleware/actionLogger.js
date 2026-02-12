const { AdminActionLog } = require('../models');

/**
 * 민감 정보 필터링
 */
const SENSITIVE_FIELDS = [
  'password',
  'passwordConfirm',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'privateKey',
  'jwt',
  'authorization'
];

const sanitizeRequestBody = (body) => {
  if (!body || typeof body !== 'object') return body;

  const sanitized = { ...body };

  SENSITIVE_FIELDS.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '***REDACTED***';
    }
  });

  return sanitized;
};

/**
 * 액션 타입 추출
 */
const extractActionType = (method, endpoint) => {
  if (endpoint.includes('/approve')) return 'APPROVE';
  if (endpoint.includes('/reject')) return 'REJECT';
  if (endpoint.includes('/activate')) return 'ACTIVATE';
  if (endpoint.includes('/deactivate')) return 'DEACTIVATE';
  if (endpoint.includes('/suspend')) return 'SUSPEND';
  if (endpoint.includes('/unlock')) return 'UNLOCK';
  if (endpoint.includes('/export')) return 'EXPORT';

  if (method === 'POST') return 'CREATE';
  if (method === 'PATCH' || method === 'PUT') return 'UPDATE';
  if (method === 'DELETE') return 'DELETE';

  return 'UPDATE';
};

/**
 * 리소스 타입 추출
 */
const extractResourceType = (endpoint) => {
  if (endpoint.includes('/users')) return 'USER';
  if (endpoint.includes('/properties') || endpoint.includes('/rooms')) return 'PROPERTY';
  if (endpoint.includes('/reservations') || endpoint.includes('/contracts')) return 'RESERVATION';
  if (endpoint.includes('/payments')) return 'PAYMENT';
  if (endpoint.includes('/settlements')) return 'SETTLEMENT';
  if (endpoint.includes('/inquiries')) return 'INQUIRY';
  if (endpoint.includes('/notifications')) return 'NOTIFICATION';
  if (endpoint.includes('/admins')) return 'ADMIN';

  return 'SYSTEM';
};

/**
 * 리소스 ID 추출
 */
const extractResourceId = (endpoint) => {
  // /api/admin/users/123/activate → "123"
  // /api/admin/properties/456 → "456"
  const match = endpoint.match(/\/(\d+)(?:\/|$)/);
  return match ? match[1] : null;
};

/**
 * 액션 설명 생성
 */
const generateDescription = (admin, method, endpoint) => {
  const actionType = extractActionType(method, endpoint);
  const resourceType = extractResourceType(endpoint);
  const resourceId = extractResourceId(endpoint);

  const adminName = admin.name || admin.username;

  const descriptions = {
    'CREATE': `${adminName}님이 ${resourceType}을(를) 생성했습니다.`,
    'UPDATE': `${adminName}님이 ${resourceType}${resourceId ? ` #${resourceId}` : ''}을(를) 수정했습니다.`,
    'DELETE': `${adminName}님이 ${resourceType}${resourceId ? ` #${resourceId}` : ''}을(를) 삭제했습니다.`,
    'APPROVE': `${adminName}님이 ${resourceType}${resourceId ? ` #${resourceId}` : ''}을(를) 승인했습니다.`,
    'REJECT': `${adminName}님이 ${resourceType}${resourceId ? ` #${resourceId}` : ''}을(를) 반려했습니다.`,
    'ACTIVATE': `${adminName}님이 ${resourceType}${resourceId ? ` #${resourceId}` : ''}을(를) 활성화했습니다.`,
    'DEACTIVATE': `${adminName}님이 ${resourceType}${resourceId ? ` #${resourceId}` : ''}을(를) 비활성화했습니다.`,
    'SUSPEND': `${adminName}님이 ${resourceType}${resourceId ? ` #${resourceId}` : ''}을(를) 정지했습니다.`,
    'EXPORT': `${adminName}님이 ${resourceType} 데이터를 내보냈습니다.`
  };

  return descriptions[actionType] || `${adminName}님이 ${actionType} 액션을 수행했습니다.`;
};

/**
 * 클라이언트 IP 추출
 */
const getClientIp = (req) => {
  return req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    null;
};

/**
 * 관리자 액션 로거 미들웨어
 * POST, PATCH, PUT, DELETE 요청만 로깅
 */
const actionLogger = (req, res, next) => {
  // 로깅 대상이 아닌 메소드는 스킵
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    return next();
  }

  // 관리자 인증이 필요 (authenticateAdmin 미들웨어 이후 실행 필수)
  if (!req.admin) {
    return next();
  }

  // 응답 상태 캡처
  const originalJson = res.json;
  let responseStatus = 200;

  res.json = function (body) {
    responseStatus = res.statusCode;
    res.json = originalJson;
    return res.json(body);
  };

  // 응답 완료 후 비동기로 로그 저장
  res.on('finish', async () => {
    try {
      const logData = {
        adminId: req.admin.id,
        adminEmail: req.admin.username, // username 필드 사용
        adminName: req.admin.name,
        actionType: extractActionType(req.method, req.path),
        resourceType: extractResourceType(req.path),
        resourceId: extractResourceId(req.path),
        method: req.method,
        endpoint: req.path,
        requestBody: sanitizeRequestBody(req.body),
        responseStatus: responseStatus,
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'] || null,
        description: generateDescription(req.admin, req.method, req.path)
      };

      await AdminActionLog.create(logData);
    } catch (error) {
      // 로그 저장 실패해도 요청 처리에는 영향 없음
      console.error('❌ 관리자 액션 로그 저장 실패:', error.message);
    }
  });

  next();
};

module.exports = actionLogger;
