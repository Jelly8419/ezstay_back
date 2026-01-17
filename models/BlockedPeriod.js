const { DataTypes, Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  timezone: '+09:00',
  dialectOptions: {
    timezone: '+09:00'
  },
  logging: false
});

/**
 * BlockedPeriod 모델 - 계약 불가 기간 관리
 * 호스트가 특정 날짜 범위를 예약 불가로 설정
 */
const BlockedPeriod = sequelize.define('BlockedPeriod', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  roomId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'room_id',
    comment: '방 ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  startDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'start_date',
    comment: '불가 시작 날짜 (YYYY-MM-DD)',
    validate: {
      isDate: true,
      notNull: {
        msg: '시작 날짜는 필수입니다.'
      }
    }
  },
  endDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'end_date',
    comment: '불가 종료 날짜 (YYYY-MM-DD)',
    validate: {
      isDate: true,
      notNull: {
        msg: '종료 날짜는 필수입니다.'
      },
      isAfterOrEqualStartDate(value) {
        if (this.startDate && new Date(value) < new Date(this.startDate)) {
          throw new Error('종료일은 시작일보다 이후여야 합니다.');
        }
      }
    }
  },
  reason: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '불가 사유 (최대 200자)',
    validate: {
      len: {
        args: [0, 200],
        msg: '사유는 최대 200자까지 입력 가능합니다.'
      }
    }
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'created_by',
    comment: '생성한 호스트 ID'
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'blocked_periods',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['room_id'],
      name: 'idx_room_id'
    },
    {
      fields: ['start_date'],
      name: 'idx_start_date'
    },
    {
      fields: ['end_date'],
      name: 'idx_end_date'
    },
    {
      fields: ['room_id', 'start_date', 'end_date'],
      name: 'idx_date_range',
      comment: '날짜 범위 조회 최적화'
    },
    {
      fields: ['created_by'],
      name: 'idx_created_by'
    }
  ]
});

/**
 * 특정 날짜 범위와 겹치는 불가 기간 조회
 * @param {number} roomId - 방 ID
 * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @returns {Promise<Array>} 겹치는 불가 기간 목록
 */
BlockedPeriod.findOverlapping = async function(roomId, startDate, endDate) {
  const { Op } = require('sequelize');

  return await this.findAll({
    where: {
      roomId,
      [Op.or]: [
        // 새 기간의 시작일이 기존 기간 안에 있음
        {
          startDate: { [Op.lte]: startDate },
          endDate: { [Op.gte]: startDate }
        },
        // 새 기간의 종료일이 기존 기간 안에 있음
        {
          startDate: { [Op.lte]: endDate },
          endDate: { [Op.gte]: endDate }
        },
        // 새 기간이 기존 기간을 완전히 포함
        {
          startDate: { [Op.gte]: startDate },
          endDate: { [Op.lte]: endDate }
        }
      ]
    },
    order: [['startDate', 'ASC']]
  });
};

/**
 * 날짜 범위 내의 불가 기간 조회
 * @param {number} roomId - 방 ID
 * @param {string} startDate - 조회 시작일 (YYYY-MM-DD)
 * @param {string} endDate - 조회 종료일 (YYYY-MM-DD)
 * @returns {Promise<Array>} 불가 기간 목록
 */
BlockedPeriod.findByRoomAndDateRange = async function(roomId, startDate, endDate) {
  const { Op } = require('sequelize');

  return await this.findAll({
    where: {
      roomId,
      endDate: { [Op.gte]: startDate },
      startDate: { [Op.lte]: endDate }
    },
    order: [['startDate', 'ASC']]
  });
};

module.exports = BlockedPeriod;
