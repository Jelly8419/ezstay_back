const cron = require('node-cron');
const { UserSession } = require('../models');
const { Op } = require('sequelize');

/**
 * 만료된 세션 자동 정리
 * - expiresAt < 현재 시각인 세션 삭제
 * 매일 새벽 3시 실행
 */
const cleanupExpiredSessions = () => {
  cron.schedule('0 3 * * *', async () => {
    try {
      const deletedCount = await UserSession.destroy({
        where: {
          expiresAt: { [Op.lt]: new Date() }
        }
      });

      if (deletedCount > 0) {
        console.log(`✅ [세션 정리] ${deletedCount}개의 만료 세션 삭제 완료`);
      }
    } catch (error) {
      console.error('❌ [세션 정리] 실패:', error.message);
    }
  });

  console.log('📅 [스케줄러] 만료 세션 자동 정리 시작 (매일 03:00)');
};

module.exports = cleanupExpiredSessions;
