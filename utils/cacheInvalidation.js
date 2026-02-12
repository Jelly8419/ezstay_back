const { safeRedisOperation } = require('../config/redis');

/**
 * 매물 데이터 변경 시 캐시 무효화 (ETag 버전 증가)
 * - 매물 승인/반려/게시/삭제 시 호출
 * - Redis의 rooms:data:version을 증가시켜 모든 HTTP ETag를 무효화
 */
async function invalidateRoomCache() {
  try {
    const newVersion = await safeRedisOperation(async (client) => {
      return await client.incr('rooms:data:version');
    });

    if (newVersion) {
      console.log(`📝 매물 데이터 변경 - ETag 버전 업데이트: v${newVersion}`);
    } else {
      console.warn('⚠️  Redis 연결 없음 - ETag 버전 업데이트 스킵');
    }

    return newVersion;
  } catch (err) {
    console.error('❌ 캐시 무효화 실패:', err.message);
    return null;
  }
}

module.exports = {
  invalidateRoomCache
};
