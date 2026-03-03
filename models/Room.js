const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ezstay', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  logging: false  // 쿼리 로그 비활성화
});

const Room = sequelize.define('Room', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false
    // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
  },
  // 기본 정보
  roomName: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  address: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  detailAddress: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true,
    comment: '위도 (WGS84)'
  },
  longitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true,
    comment: '경도 (WGS84)'
  },
  area: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  floor: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  buildingType: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  parkingAvailable: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  parkingInfo: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  elevatorAvailable: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  roomCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  bathroomCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  isDuplex: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  entrancePassword: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // 요금 정보 (1일 기준)
  dailyRent: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'daily_rent',
    comment: '1일 임대료',
    validate: {
      min: 1000,
      max: 10000000,
      isMultipleOf1000(value) {
        if (value && value % 1000 !== 0) {
          throw new Error('임대료는 1,000원 단위로만 입력 가능합니다.');
        }
      }
    }
  },
  dailyMaintenanceFee: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'daily_maintenance_fee',
    comment: '1일 관리비',
    validate: {
      min: 0,
      max: 10000000,
      isMultipleOf1000(value) {
        if (value && value % 1000 !== 0) {
          throw new Error('관리비는 1,000원 단위로만 입력 가능합니다.');
        }
      }
    }
  },
  maintenanceDetail: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  longTermWeeks: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'long_term_weeks',
    comment: '장기 할인 기준 주수'
  },
  longTermDiscount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '장기 할인율 (%)'
  },
  quickMoveIn: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '빠른 입주 가능일 (일 단위, 예: 7 = 7일 이내)'
  },
  quickMoveInDiscount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '빠른 입주 할인 금액 (원, 고정 금액)'
  },
  includeElectricity: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  includeWater: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  includeGas: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  includeInternet: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  cleaningFee: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '청소비 (1회)',
    validate: {
      min: 0,
      isMultipleOf1000(value) {
        if (value && value % 1000 !== 0) {
          throw new Error('청소비는 1,000원 단위로만 입력 가능합니다.');
        }
      }
    }
  },
  minContractDays: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'min_contract_days',
    comment: '최소 계약 일수 (7-90)'
  },
  refundPolicy: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  // 입퇴실 시간 (정책: 입실 14~17시, 퇴실 8~11시, 1시간 단위)
  checkInTime: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 14,
    field: 'check_in_time',
    comment: '입실 시간 (14~17, 정시 기준)',
    validate: {
      min: 14,
      max: 17,
      isInt: {
        msg: '입실 시간은 정수만 입력 가능합니다.'
      }
    }
  },
  checkOutTime: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 11,
    field: 'check_out_time',
    comment: '퇴실 시간 (8~11, 정시 기준)',
    validate: {
      min: 8,
      max: 11,
      isInt: {
        msg: '퇴실 시간은 정수만 입력 가능합니다.'
      }
    }
  },
  // 방 소개
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  maxGuests: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2,
    field: 'max_guests',
    comment: '최대 가능인원',
    validate: {
      min: 1,
      max: 20,
      isInt: {
        msg: '최대 인원은 정수만 입력 가능합니다.'
      }
    }
  },
  // 상태 관리
  status: {
    type: DataTypes.ENUM('draft', 'pending_review', 'approved', 'rejected', 'published', 'hidden_by_admin'),
    allowNull: false,
    defaultValue: 'draft',
    comment: '방 상태 (hidden_by_admin: 관리자가 임시로 숨긴 상태)'
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  publishedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '매물 반려 사유'
  },
  // 게시 상태 관리
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '게시 여부 (true: 게시중, false: 비공개)'
  },
  deletedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Soft Delete 타임스탬프'
  }
}, {
  tableName: 'rooms',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['status', 'latitude', 'longitude'],
      name: 'idx_status_location',
      comment: '지도 영역 검색 최적화 (카카오맵 클러스터링)'
    },
    {
      fields: ['deleted_at'],
      name: 'idx_deleted_at',
      comment: 'Soft Delete 조회 최적화'
    }
  ]
});

module.exports = { Room, sequelize };