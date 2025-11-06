const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AdminActionLog = sequelize.define('AdminActionLog', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },

    // 관리자 정보
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'admin_id'
    },
    adminEmail: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'admin_email',
      comment: 'Admin username (로그인 ID)'
    },
    adminName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'admin_name'
    },

    // 액션 정보
    actionType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'action_type',
      comment: 'CREATE, UPDATE, DELETE, APPROVE, REJECT, ACTIVATE, DEACTIVATE, SUSPEND, EXPORT'
    },
    resourceType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'resource_type',
      comment: 'USER, PROPERTY, RESERVATION, PAYMENT, ADMIN, SYSTEM'
    },
    resourceId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'resource_id'
    },

    // HTTP 요청 정보
    method: {
      type: DataTypes.STRING(10),
      allowNull: false,
      comment: 'POST, PATCH, PUT, DELETE'
    },
    endpoint: {
      type: DataTypes.STRING(255),
      allowNull: false
    },

    // 변경 내역
    requestBody: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'request_body',
      comment: '요청 본문 (민감 정보 제외)'
    },
    responseStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'response_status'
    },

    // 메타데이터
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      field: 'ip_address',
      comment: 'IPv4/IPv6'
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'user_agent'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '액션 설명'
    }
  }, {
    tableName: 'admin_action_logs',
    timestamps: true,
    updatedAt: false, // 로그는 수정되지 않으므로 updatedAt 불필요
    underscored: true,
    indexes: [
      {
        fields: ['admin_id']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['resource_type', 'resource_id']
      },
      {
        fields: ['action_type']
      }
    ]
  });

  return AdminActionLog;
};
