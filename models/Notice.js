const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Notice = sequelize.define('Notice', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: '공지사항 제목'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: '공지사항 내용 (HTML 포함 가능)'
    },
    isImportant: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: '중요 공지 여부 (상단 고정)'
    },
    viewCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: '조회수'
    },
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '게시 시작 날짜'
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '게시 종료 날짜 (null이면 무제한)'
    },
    status: {
      type: DataTypes.ENUM('draft', 'published', 'archived'),
      defaultValue: 'draft',
      comment: 'draft: 임시저장, published: 게시중, archived: 보관'
    },
    userType: {
      type: DataTypes.ENUM('all', 'host', 'guest'),
      defaultValue: 'all',
      comment: '대상 사용자 타입 (all: 전체, host: 호스트, guest: 게스트)'
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '작성한 관리자 ID (Admin.id)'
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
    },
    updatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '마지막 수정한 관리자 ID'
      // references 옵션 제거 - models/index.js에서 belongsTo로 관계 설정
    }
  }, {
    tableName: 'notices',
    timestamps: true,
    indexes: [
      {
        fields: ['status'],
        name: 'idx_notices_status'
      },
      {
        fields: ['publishedAt'],
        name: 'idx_notices_published_at'
      },
      {
        fields: ['isImportant', 'publishedAt'],
        name: 'idx_notices_important_published'
      },
      {
        fields: ['createdBy'],
        name: 'idx_notices_created_by'
      },
      {
        fields: ['userType', 'status', 'publishedAt'],
        name: 'idx_notices_user_type'
      }
    ]
  });

  return Notice;
};
