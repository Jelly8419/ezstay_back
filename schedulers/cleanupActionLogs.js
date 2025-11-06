const cron = require('node-cron');
const { AdminActionLog } = require('../models');
const { Op } = require('sequelize');

/**
 * 90일 이상 오래된 액션 로그 자동 삭제
 * 매일 새벽 3시 실행
 */
const cleanupOldActionLogs = () => {
  // 매일 새벽 3시에 실행 (0 3 * * *)
  cron.schedule('0 3 * * *', async () => {
    try {
      const retentionDays = process.env.ACTION_LOG_RETENTION_DAYS || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await AdminActionLog.destroy({
        where: {
          createdAt: {
            [Op.lt]: cutoffDate
          }
        }
      });

      console.log(`✅ [액션 로그 정리] ${result}개의 오래된 로그 삭제 완료 (${retentionDays}일 이상)`);
    } catch (error) {
      console.error('❌ [액션 로그 정리] 실패:', error.message);
    }
  });

  console.log('📅 [스케줄러] 액션 로그 자동 정리 시작 (매일 03:00, 보관 기간: 90일)');
};

module.exports = cleanupOldActionLogs;
