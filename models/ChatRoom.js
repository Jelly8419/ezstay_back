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
 * ChatRoom 모델 - 채팅방 정보
 * 계약 승인된 호스트와 게스트 간의 채팅방 관리
 * Firebase Firestore와 연동되는 메타데이터를 MySQL에 저장
 */
const ChatRoom = sequelize.define('ChatRoom', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  contractId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    field: 'contract_id',
    references: {
      model: 'contracts',
      key: 'id'
    },
    comment: '계약 ID (1:1 관계)'
  },
  firebaseChatRoomId: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    field: 'firebase_chat_room_id',
    comment: 'Firebase Firestore 채팅방 ID (예: contract_123)'
  },
  hostId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'host_id',
    references: {
      model: 'users',
      key: 'id'
    },
    comment: '호스트 ID'
  },
  guestId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'guest_id',
    references: {
      model: 'users',
      key: 'id'
    },
    comment: '게스트 ID'
  },
  roomId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'room_id',
    references: {
      model: 'rooms',
      key: 'id'
    },
    comment: '방 ID (메타정보용)'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active',
    comment: '채팅방 활성화 여부 (계약 완료/취소 시 false)'
  },
  lastMessageAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_message_at',
    comment: '마지막 메시지 시간 (Firestore 동기화용)'
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
  tableName: 'chat_rooms',
  timestamps: true,
  underscored: false,
  indexes: [
    {
      fields: ['contract_id'],
      name: 'idx_contract_id',
      unique: true
    },
    {
      fields: ['firebase_chat_room_id'],
      name: 'idx_firebase_chat_room_id',
      unique: true
    },
    {
      fields: ['host_id'],
      name: 'idx_host_id'
    },
    {
      fields: ['guest_id'],
      name: 'idx_guest_id'
    },
    {
      fields: ['is_active'],
      name: 'idx_is_active'
    },
    {
      fields: ['created_at'],
      name: 'idx_created_at'
    }
  ]
});

/**
 * Firebase 채팅방 ID 생성 헬퍼 함수
 * @param {number} contractId - 계약 ID
 * @returns {string} Firebase 채팅방 ID (예: contract_123)
 */
ChatRoom.generateFirebaseChatRoomId = (contractId) => {
  return `contract_${contractId}`;
};

module.exports = ChatRoom;
