const { sequelize } = require('../models');

/**
 * 트랜잭션 헬퍼 유틸리티
 * 자동 commit/rollback 처리로 코드 중복 제거
 */

/**
 * 트랜잭션 내에서 콜백 함수 실행
 * 성공 시 자동 commit, 실패 시 자동 rollback
 *
 * @param {Function} callback - 트랜잭션 내에서 실행할 비동기 함수
 * @returns {Promise<{success: boolean, data?: any, error?: Error}>}
 *
 * @example
 * const result = await withTransaction(async (transaction) => {
 *   const user = await User.create({ email }, { transaction });
 *   const profile = await Profile.create({ userId: user.id }, { transaction });
 *   return { user, profile };
 * });
 *
 * if (result.success) {
 *   return created(res, result.data, '생성되었습니다.');
 * } else {
 *   return error(res, ErrorCodes.INTERNAL_ERROR, 500, result.error.message);
 * }
 */
const withTransaction = async (callback) => {
  const transaction = await sequelize.transaction();

  try {
    const result = await callback(transaction);
    await transaction.commit();
    return { success: true, data: result };
  } catch (err) {
    await transaction.rollback();
    return { success: false, error: err };
  }
};

module.exports = {
  withTransaction
};
