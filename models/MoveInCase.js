const { DataTypes } = require('sequelize');

/**
 * MoveInCase 모델
 * 입주 준비 등록 (외부 계약 1건 단위)
 *
 * - 외부 플랫폼 계약 1건 = MoveInCase 1건
 * - 동일 방으로 다른 기간/임차인 조합 가능 (날짜 겹침은 애플리케이션에서 차단)
 * - room_snapshot: 케이스 생성 시점의 방 정보 JSON 락인 (방 수정 후에도 안정성)
 */
module.exports = (sequelize) => {
  const MoveInCase = sequelize.define('MoveInCase', {
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

    moveInRoomId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'move_in_room_id',
      comment: '간편 방 ID (move_in_rooms.id)'
    },

    checkInDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'check_in_date',
      comment: '입주일 (외부 계약)'
    },

    checkOutDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'check_out_date',
      comment: '퇴실일 (외부 계약)'
    },

    guestName: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'guest_name',
      comment: '임차인 이름'
    },

    guestPhone: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: 'guest_phone',
      comment: '임차인 휴대폰 번호 (알림톡/SMS, 매칭 키)'
    },

    guestUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'guest_user_id',
      comment: '임차인 가입 시 매칭된 user_id'
    },

    requestMemo: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'request_memo',
      comment: '요청 메모'
    },

    cleaningStatus: {
      type: DataTypes.ENUM('NOT_REQUESTED', 'PAYMENT_PENDING', 'PAID', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'NOT_REQUESTED',
      field: 'cleaning_status',
      comment: '청소 상태'
    },

    cleaningFee: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'cleaning_fee',
      comment: '신청 시점 산정된 청소비 (스냅샷)'
    },

    cleaningPaidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'cleaning_paid_at',
      comment: '청소 결제 완료 일시'
    },

    roomSnapshot: {
      // MariaDB에는 JSON 타입이 없고 LONGTEXT + json_valid CHECK로 저장됨.
      // Sequelize DataTypes.JSON 사용 시 char-by-char 객체 변환 이슈 발생 → TEXT + 명시적 직렬화 사용.
      type: DataTypes.TEXT('long'),
      allowNull: false,
      field: 'room_snapshot',
      comment: '케이스 생성 시점 방 정보 스냅샷 JSON',
      get() {
        const raw = this.getDataValue('roomSnapshot');
        if (raw == null) return null;
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return null; }
      },
      set(val) {
        if (val == null) {
          this.setDataValue('roomSnapshot', null);
        } else if (typeof val === 'string') {
          this.setDataValue('roomSnapshot', val);
        } else {
          this.setDataValue('roomSnapshot', JSON.stringify(val));
        }
      }
    }
  }, {
    tableName: 'move_in_cases',
    timestamps: true,
    underscored: true
  });

  return MoveInCase;
};
