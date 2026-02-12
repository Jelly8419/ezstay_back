const cron = require('node-cron');
const { User } = require('../models');
const { Op } = require('sequelize');

/**
 * 미완료 회원가입 계정 자동 정리 (7일)
 * - phoneVerified=false (본인인증 미완료)
 * - accountStatus='active' (아직 활성 상태)
 * - createdAt < 7일 전
 * 매일 새벽 4시 실행
 */
const cleanupIncompleteRegistrations = () => {
  cron.schedule('0 4 * * *', async () => {
    try {
      const retentionDays = 7;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const [updatedCount] = await User.update({
        isActive: false,
        accountStatus: 'withdrawn'
      }, {
        where: {
          phoneVerified: false,
          accountStatus: 'active',
          createdAt: {
            [Op.lt]: cutoffDate
          }
        }
      });

      if (updatedCount > 0) {
        console.log(`✅ [미완료 계정 정리] ${updatedCount}개의 미완료 계정 비활성화 완료 (${retentionDays}일 초과)`);
      }
    } catch (error) {
      console.error('❌ [미완료 계정 정리] 실패:', error.message);
    }
  });

  console.log('📅 [스케줄러] 미완료 회원가입 자동 정리 시작 (매일 04:00, 보관 기간: 7일)');
};

module.exports = cleanupIncompleteRegistrations;
