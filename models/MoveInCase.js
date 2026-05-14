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
    },

    adminMemo: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'admin_memo',
      comment: '관리자 메모 (관리자 화면 전용)'
    },

    lastModifiedByAdminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'last_modified_by_admin_id',
      comment: '최종 관리자 수정자 admin_id'
    },

    lastModifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_modified_at',
      comment: '최종 관리자 수정 일시'
    },

    cleaningDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'cleaning_date',
      comment: '청소 희망 일자 (호스트 신청 시점 의도, 입주일·퇴실일 범위 강제 X)'
    },

    cleaningTime: {
      // MariaDB TIME 컬럼은 Sequelize 가 'HH:MM:SS' 문자열로 반환.
      // 30분 단위 09:00~18:00 범위는 컨트롤러/헬퍼 레벨에서 검증.
      type: DataTypes.STRING(8),
      allowNull: true,
      field: 'cleaning_time',
      comment: '청소 희망 시작 시각 HH:MM:SS (30분 단위, 09:00~18:00)'
    }
  }, {
    tableName: 'move_in_cases',
    timestamps: true,
    underscored: true
  });

  return MoveInCase;
};
