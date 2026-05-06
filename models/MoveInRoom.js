const { DataTypes } = require('sequelize');

/**
 * MoveInRoom 모델
 * 입주 준비 서비스용 간편 방 정보 (정식 Room과 분리)
 *
 * - 외부 플랫폼에서 계약된 임대인이 등록하는 간편 방 정보
 * - 정식 Room과 달리 심사/노출 없음
 * - 비밀번호 컬럼은 utils/cryptoHelper로 AES 암/복호화
 */
module.exports = (sequelize) => {
  const MoveInRoom = sequelize.define('MoveInRoom', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

    hostId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'host_id',
      comment: '임대인 user_id'
    },

    roomName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'room_name',
      comment: '방 표시 라벨 (선택)'
    },

    address: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: '주소'
    },

    detailAddress: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'detail_address',
      comment: '상세 주소 (동/호수)'
    },

    areaPyeong: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: false,
      field: 'area_pyeong',
      comment: '평수 (청소비 산정 기준)',
      validate: { min: 0 }
    },

    livingRoomCount: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      field: 'living_room_count',
      comment: '거실 수'
    },

    roomCount: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      field: 'room_count',
      comment: '방 수'
    },

    bathroomCount: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      field: 'bathroom_count',
      comment: '화장실 수'
    },

    bedCount: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      field: 'bed_count',
      comment: '침대 수'
    },

    beds: {
      // MariaDB JSON 컬럼은 LONGTEXT + json_valid 형태라 DataTypes.JSON와 호환 이슈 있어 명시 직렬화.
      type: DataTypes.TEXT('long'),
      allowNull: false,
      comment: '침대 정보 [{index, size}] JSON',
      get() {
        const raw = this.getDataValue('beds');
        if (raw == null) return null;
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return null; }
      },
      set(val) {
        if (val == null) {
          this.setDataValue('beds', null);
        } else if (typeof val === 'string') {
          this.setDataValue('beds', val);
        } else {
          this.setDataValue('beds', JSON.stringify(val));
        }
      }
    },

    commonEntrancePassword: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'common_entrance_password',
      comment: '공동현관 비밀번호 (AES 암호화 저장)'
    },

    doorLockPassword: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'door_lock_password',
      comment: '도어락 비밀번호 (AES 암호화 저장)'
    },

    cleaningSuppliesAvailable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'cleaning_supplies_available',
      comment: '청소용품 구비 여부'
    },

    cleaningSuppliesLocation: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'cleaning_supplies_location',
      comment: '청소용품 위치 (구비함 시 필수)'
    },

    memo: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '비고'
    },

    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'deleted_at',
      comment: 'Soft delete 시각'
    }
  }, {
    tableName: 'move_in_rooms',
    timestamps: true,
    underscored: true,
    paranoid: true,
    deletedAt: 'deletedAt'
  });

  return MoveInRoom;
};
