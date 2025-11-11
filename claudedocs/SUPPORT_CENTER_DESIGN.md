# Ezstay 고객센터 시스템 설계 문서 (Customer Support Center Design)

## 1. 개요 (Overview)

### 목적
사용자(호스트/게스트)가 서비스 이용 중 문제를 해결하거나 문의를 등록할 수 있는 고객센터 시스템을 제공합니다.

### 주요 기능
1. **공지사항 (Notices)**: 관리자가 서비스 운영 공지를 작성/관리
2. **자주 묻는 질문 (FAQ)**: 카테고리별 질문/답변 관리
3. **문의하기 (Inquiries)**: 사용자 문의 등록 및 관리자 답변

---

## 2. 데이터베이스 스키마 설계

### 2.1 Notice (공지사항)

```javascript
// models/Notice.js
{
  id: {
    type: INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: STRING(200),
    allowNull: false,
    comment: '공지사항 제목'
  },
  content: {
    type: TEXT,
    allowNull: false,
    comment: '공지사항 내용 (HTML 포함 가능)'
  },
  isImportant: {
    type: BOOLEAN,
    defaultValue: false,
    comment: '중요 공지 여부 (상단 고정)'
  },
  viewCount: {
    type: INTEGER,
    defaultValue: 0,
    comment: '조회수'
  },
  publishedAt: {
    type: DATE,
    allowNull: true,
    comment: '게시 시작 날짜'
  },
  expiresAt: {
    type: DATE,
    allowNull: true,
    comment: '게시 종료 날짜 (null이면 무제한)'
  },
  status: {
    type: ENUM('draft', 'published', 'archived'),
    defaultValue: 'draft',
    comment: 'draft: 임시저장, published: 게시중, archived: 보관'
  },
  createdBy: {
    type: INTEGER,
    allowNull: false,
    comment: '작성한 관리자 ID (Admin.id)'
  },
  updatedBy: {
    type: INTEGER,
    allowNull: true,
    comment: '마지막 수정한 관리자 ID'
  },
  createdAt: DATE,
  updatedAt: DATE
}

// Indexes
indexes: [
  { fields: ['status'] },
  { fields: ['publishedAt'] },
  { fields: ['isImportant', 'publishedAt'] },
  { fields: ['createdBy'] }
]

// Associations
Notice.belongsTo(Admin, { foreignKey: 'createdBy', as: 'author' })
Notice.belongsTo(Admin, { foreignKey: 'updatedBy', as: 'editor' })
```

### 2.2 FAQCategory (FAQ 카테고리)

```javascript
// models/FAQCategory.js
{
  id: {
    type: INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: STRING(100),
    allowNull: false,
    comment: '카테고리 이름 (예: 전체, 방 등록, 예약/결제 등)'
  },
  userType: {
    type: ENUM('all', 'host', 'guest'),
    defaultValue: 'all',
    comment: '대상 사용자 타입'
  },
  displayOrder: {
    type: INTEGER,
    defaultValue: 0,
    comment: '표시 순서 (낮을수록 상단)'
  },
  isActive: {
    type: BOOLEAN,
    defaultValue: true,
    comment: '활성화 여부'
  },
  createdAt: DATE,
  updatedAt: DATE
}

// Indexes
indexes: [
  { fields: ['userType', 'isActive', 'displayOrder'] },
  {
    unique: true,
    fields: ['name', 'userType'],
    name: 'faq_category_name_user_type_unique'
  }
]

// Associations
FAQCategory.hasMany(FAQ, { foreignKey: 'categoryId', as: 'faqs' })
```

### 2.3 FAQ (자주 묻는 질문)

```javascript
// models/FAQ.js
{
  id: {
    type: INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  categoryId: {
    type: INTEGER,
    allowNull: false,
    comment: 'FAQ 카테고리 ID'
  },
  question: {
    type: STRING(300),
    allowNull: false,
    comment: '질문'
  },
  answer: {
    type: TEXT,
    allowNull: false,
    comment: '답변 (HTML 포함 가능)'
  },
  displayOrder: {
    type: INTEGER,
    defaultValue: 0,
    comment: '카테고리 내 표시 순서'
  },
  viewCount: {
    type: INTEGER,
    defaultValue: 0,
    comment: '조회수'
  },
  isActive: {
    type: BOOLEAN,
    defaultValue: true,
    comment: '활성화 여부'
  },
  createdBy: {
    type: INTEGER,
    allowNull: false,
    comment: '작성한 관리자 ID'
  },
  updatedBy: {
    type: INTEGER,
    allowNull: true,
    comment: '마지막 수정한 관리자 ID'
  },
  createdAt: DATE,
  updatedAt: DATE
}

// Indexes
indexes: [
  { fields: ['categoryId', 'isActive', 'displayOrder'] },
  { fields: ['createdBy'] }
]

// Associations
FAQ.belongsTo(FAQCategory, { foreignKey: 'categoryId', as: 'category' })
FAQ.belongsTo(Admin, { foreignKey: 'createdBy', as: 'author' })
FAQ.belongsTo(Admin, { foreignKey: 'updatedBy', as: 'editor' })
```

### 2.4 Inquiry (문의사항)

```javascript
// models/Inquiry.js
{
  id: {
    type: INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: INTEGER,
    allowNull: false,
    comment: '문의 작성자 ID (User.id)'
  },
  categoryType: {
    type: ENUM('general', 'reservation', 'payment', 'room', 'account', 'other'),
    allowNull: false,
    comment: '문의 카테고리'
  },
  title: {
    type: STRING(200),
    allowNull: false,
    comment: '문의 제목'
  },
  content: {
    type: TEXT,
    allowNull: false,
    comment: '문의 내용'
  },
  status: {
    type: ENUM('pending', 'answered', 'closed'),
    defaultValue: 'pending',
    comment: 'pending: 확인중, answered: 답변완료, closed: 종료'
  },
  answer: {
    type: TEXT,
    allowNull: true,
    comment: '관리자 답변'
  },
  answeredBy: {
    type: INTEGER,
    allowNull: true,
    comment: '답변한 관리자 ID'
  },
  answeredAt: {
    type: DATE,
    allowNull: true,
    comment: '답변 작성 시각'
  },
  createdAt: DATE,
  updatedAt: DATE
}

// Indexes
indexes: [
  { fields: ['userId', 'status', 'createdAt'] },
  { fields: ['status', 'createdAt'] },
  { fields: ['answeredBy'] },
  { fields: ['categoryType'] }
]

// Associations
Inquiry.belongsTo(User, { foreignKey: 'userId', as: 'user' })
Inquiry.belongsTo(Admin, { foreignKey: 'answeredBy', as: 'admin' })
```

---

## 3. API 엔드포인트 설계

### 3.1 공지사항 API

#### 사용자용 API (인증 불필요)
```javascript
// routes/supportRoutes.js

/**
 * @route   GET /api/support/notices
 * @desc    공지사항 목록 조회 (published만)
 * @access  Public
 * @query   page, limit, isImportant (선택)
 */
router.get('/notices', noticeController.getNoticeList);

/**
 * @route   GET /api/support/notices/:noticeId
 * @desc    공지사항 상세 조회 (조회수 증가)
 * @access  Public
 */
router.get('/notices/:noticeId', noticeController.getNoticeDetail);
```

#### 관리자용 API
```javascript
// routes/adminRoutes.js

/**
 * @route   GET /api/admin/support/notices
 * @desc    공지사항 목록 조회 (모든 상태)
 * @access  Admin (cs_admin 이상)
 * @query   page, limit, status, searchKeyword
 */
router.get('/support/notices',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  noticeController.getAdminNoticeList
);

/**
 * @route   POST /api/admin/support/notices
 * @desc    공지사항 작성
 * @access  Admin (cs_admin 이상)
 * @body    { title, content, isImportant, publishedAt, expiresAt, status }
 */
router.post('/support/notices',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  noticeController.createNotice
);

/**
 * @route   PATCH /api/admin/support/notices/:noticeId
 * @desc    공지사항 수정
 * @access  Admin (cs_admin 이상)
 */
router.patch('/support/notices/:noticeId',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  noticeController.updateNotice
);

/**
 * @route   DELETE /api/admin/support/notices/:noticeId
 * @desc    공지사항 삭제
 * @access  Admin (super_admin, admin)
 */
router.delete('/support/notices/:noticeId',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin']),
  noticeController.deleteNotice
);
```

### 3.2 FAQ API

#### 사용자용 API
```javascript
// routes/supportRoutes.js

/**
 * @route   GET /api/support/faq/categories
 * @desc    FAQ 카테고리 목록 조회 (활성화된 것만)
 * @access  Public
 * @query   userType (all|host|guest)
 */
router.get('/faq/categories', faqController.getFAQCategories);

/**
 * @route   GET /api/support/faq
 * @desc    FAQ 목록 조회 (활성화된 것만)
 * @access  Public
 * @query   categoryId, userType, searchKeyword
 */
router.get('/faq', faqController.getFAQList);

/**
 * @route   GET /api/support/faq/:faqId
 * @desc    FAQ 상세 조회 (조회수 증가)
 * @access  Public
 */
router.get('/faq/:faqId', faqController.getFAQDetail);
```

#### 관리자용 API
```javascript
// routes/adminRoutes.js

/**
 * @route   POST /api/admin/support/faq/categories
 * @desc    FAQ 카테고리 생성
 * @access  Admin (cs_admin 이상)
 */
router.post('/support/faq/categories',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  faqController.createFAQCategory
);

/**
 * @route   PATCH /api/admin/support/faq/categories/:categoryId
 * @desc    FAQ 카테고리 수정
 * @access  Admin (cs_admin 이상)
 */
router.patch('/support/faq/categories/:categoryId',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  faqController.updateFAQCategory
);

/**
 * @route   DELETE /api/admin/support/faq/categories/:categoryId
 * @desc    FAQ 카테고리 삭제 (FAQ가 없는 경우만)
 * @access  Admin (super_admin, admin)
 */
router.delete('/support/faq/categories/:categoryId',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin']),
  faqController.deleteFAQCategory
);

/**
 * @route   POST /api/admin/support/faq
 * @desc    FAQ 생성
 * @access  Admin (cs_admin 이상)
 */
router.post('/support/faq',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  faqController.createFAQ
);

/**
 * @route   PATCH /api/admin/support/faq/:faqId
 * @desc    FAQ 수정
 * @access  Admin (cs_admin 이상)
 */
router.patch('/support/faq/:faqId',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  faqController.updateFAQ
);

/**
 * @route   DELETE /api/admin/support/faq/:faqId
 * @desc    FAQ 삭제
 * @access  Admin (super_admin, admin)
 */
router.delete('/support/faq/:faqId',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin']),
  faqController.deleteFAQ
);
```

### 3.3 문의하기 API

#### 사용자용 API
```javascript
// routes/supportRoutes.js

/**
 * @route   POST /api/support/inquiries
 * @desc    문의 등록
 * @access  Private (인증 필요)
 * @body    { categoryType, title, content }
 */
router.post('/inquiries',
  authenticateToken,
  inquiryController.createInquiry
);

/**
 * @route   GET /api/support/inquiries
 * @desc    내 문의 목록 조회
 * @access  Private
 * @query   page, limit, status
 */
router.get('/inquiries',
  authenticateToken,
  inquiryController.getMyInquiries
);

/**
 * @route   GET /api/support/inquiries/:inquiryId
 * @desc    문의 상세 조회 (본인 것만)
 * @access  Private
 */
router.get('/inquiries/:inquiryId',
  authenticateToken,
  inquiryController.getInquiryDetail
);
```

#### 관리자용 API
```javascript
// routes/adminRoutes.js

/**
 * @route   GET /api/admin/support/inquiries
 * @desc    모든 문의 목록 조회
 * @access  Admin (cs_admin 이상)
 * @query   page, limit, status, categoryType, searchKeyword, userId
 */
router.get('/support/inquiries',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  inquiryController.getAdminInquiryList
);

/**
 * @route   GET /api/admin/support/inquiries/:inquiryId
 * @desc    문의 상세 조회
 * @access  Admin (cs_admin 이상)
 */
router.get('/support/inquiries/:inquiryId',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  inquiryController.getAdminInquiryDetail
);

/**
 * @route   POST /api/admin/support/inquiries/:inquiryId/answer
 * @desc    문의 답변 등록/수정
 * @access  Admin (cs_admin 이상)
 * @body    { answer }
 */
router.post('/support/inquiries/:inquiryId/answer',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  inquiryController.answerInquiry
);

/**
 * @route   PATCH /api/admin/support/inquiries/:inquiryId/status
 * @desc    문의 상태 변경
 * @access  Admin (cs_admin 이상)
 * @body    { status }
 */
router.patch('/support/inquiries/:inquiryId/status',
  authenticateAdmin,
  requireAdminRole(['super_admin', 'admin', 'cs_admin']),
  inquiryController.updateInquiryStatus
);
```

---

## 4. 컨트롤러 구현 가이드

### 4.1 Notice Controller 핵심 로직

```javascript
// controllers/noticeController.js
const { Notice, Admin } = require('../models');
const { success, created, updated, deleted, error, ErrorCodes } = require('../utils/responseHelper');
const { Op } = require('sequelize');

/**
 * 공지사항 목록 조회 (사용자용)
 * - published 상태만 조회
 * - 현재 날짜 기준 publishedAt <= now <= expiresAt (or expiresAt is null)
 * - 중요 공지는 상단 고정
 */
exports.getNoticeList = async (req, res) => {
  try {
    const { page = 1, limit = 10, isImportant } = req.query;
    const offset = (page - 1) * limit;

    const where = {
      status: 'published',
      publishedAt: { [Op.lte]: new Date() },
      [Op.or]: [
        { expiresAt: null },
        { expiresAt: { [Op.gte]: new Date() } }
      ]
    };

    if (isImportant !== undefined) {
      where.isImportant = isImportant === 'true';
    }

    const { count, rows } = await Notice.findAndCountAll({
      where,
      attributes: ['id', 'title', 'isImportant', 'viewCount', 'publishedAt', 'createdAt'],
      order: [
        ['isImportant', 'DESC'],
        ['publishedAt', 'DESC']
      ],
      limit: parseInt(limit),
      offset
    });

    return success(res, {
      notices: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }, '공지사항 목록 조회 성공');

  } catch (err) {
    console.error('공지사항 목록 조회 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};

/**
 * 공지사항 상세 조회 + 조회수 증가
 */
exports.getNoticeDetail = async (req, res) => {
  try {
    const { noticeId } = req.params;

    const notice = await Notice.findOne({
      where: {
        id: noticeId,
        status: 'published',
        publishedAt: { [Op.lte]: new Date() },
        [Op.or]: [
          { expiresAt: null },
          { expiresAt: { [Op.gte]: new Date() } }
        ]
      },
      include: [{
        model: Admin,
        as: 'author',
        attributes: ['id', 'name']
      }]
    });

    if (!notice) {
      return error(res, ErrorCodes.NOT_FOUND, 404);
    }

    // 조회수 증가
    await notice.increment('viewCount');

    return success(res, notice, '공지사항 조회 성공');

  } catch (err) {
    console.error('공지사항 상세 조회 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};

/**
 * 공지사항 작성 (관리자)
 */
exports.createNotice = async (req, res) => {
  try {
    const { title, content, isImportant, publishedAt, expiresAt, status } = req.body;
    const createdBy = req.admin.id;

    // 유효성 검증
    if (!title || !content) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const notice = await Notice.create({
      title,
      content,
      isImportant: isImportant || false,
      publishedAt: publishedAt || new Date(),
      expiresAt: expiresAt || null,
      status: status || 'draft',
      createdBy
    });

    return created(res, notice, '공지사항 작성 완료');

  } catch (err) {
    console.error('공지사항 작성 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};
```

### 4.2 FAQ Controller 핵심 로직

```javascript
// controllers/faqController.js

/**
 * FAQ 목록 조회 (사용자용)
 */
exports.getFAQList = async (req, res) => {
  try {
    const { categoryId, userType = 'all', searchKeyword } = req.query;

    const where = { isActive: true };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    // 검색 키워드
    if (searchKeyword) {
      where[Op.or] = [
        { question: { [Op.like]: `%${searchKeyword}%` } },
        { answer: { [Op.like]: `%${searchKeyword}%` } }
      ];
    }

    const faqs = await FAQ.findAll({
      where,
      include: [{
        model: FAQCategory,
        as: 'category',
        where: {
          isActive: true,
          [Op.or]: [
            { userType: 'all' },
            { userType }
          ]
        }
      }],
      order: [
        ['category', 'displayOrder', 'ASC'],
        ['displayOrder', 'ASC']
      ]
    });

    // 카테고리별로 그룹화
    const groupedFAQs = faqs.reduce((acc, faq) => {
      const categoryName = faq.category.name;
      if (!acc[categoryName]) {
        acc[categoryName] = [];
      }
      acc[categoryName].push({
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
        viewCount: faq.viewCount
      });
      return acc;
    }, {});

    return success(res, groupedFAQs, 'FAQ 목록 조회 성공');

  } catch (err) {
    console.error('FAQ 목록 조회 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};

/**
 * FAQ 생성 (관리자)
 */
exports.createFAQ = async (req, res) => {
  try {
    const { categoryId, question, answer, displayOrder } = req.body;
    const createdBy = req.admin.id;

    if (!categoryId || !question || !answer) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 카테고리 존재 확인
    const category = await FAQCategory.findByPk(categoryId);
    if (!category) {
      return error(res, { code: 3004, message: 'FAQ 카테고리를 찾을 수 없습니다.' }, 404);
    }

    const faq = await FAQ.create({
      categoryId,
      question,
      answer,
      displayOrder: displayOrder || 0,
      createdBy
    });

    return created(res, faq, 'FAQ 작성 완료');

  } catch (err) {
    console.error('FAQ 작성 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};
```

### 4.3 Inquiry Controller 핵심 로직

```javascript
// controllers/inquiryController.js

/**
 * 문의 등록 (사용자)
 */
exports.createInquiry = async (req, res) => {
  try {
    const { categoryType, title, content } = req.body;
    const userId = req.user.id;

    if (!categoryType || !title || !content) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const inquiry = await Inquiry.create({
      userId,
      categoryType,
      title,
      content,
      status: 'pending'
    });

    return created(res, inquiry, '문의가 등록되었습니다. 최대한 빠른 시일 내에 답변드리겠습니다.');

  } catch (err) {
    console.error('문의 등록 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};

/**
 * 내 문의 목록 조회 (사용자)
 */
exports.getMyInquiries = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;
    const offset = (page - 1) * limit;

    const where = { userId };
    if (status) {
      where.status = status;
    }

    const { count, rows } = await Inquiry.findAndCountAll({
      where,
      attributes: ['id', 'categoryType', 'title', 'status', 'createdAt', 'answeredAt'],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    return success(res, {
      inquiries: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }, '문의 목록 조회 성공');

  } catch (err) {
    console.error('문의 목록 조회 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};

/**
 * 문의 답변 등록 (관리자)
 */
exports.answerInquiry = async (req, res) => {
  try {
    const { inquiryId } = req.params;
    const { answer } = req.body;
    const answeredBy = req.admin.id;

    if (!answer) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const inquiry = await Inquiry.findByPk(inquiryId);
    if (!inquiry) {
      return error(res, ErrorCodes.NOT_FOUND, 404);
    }

    await inquiry.update({
      answer,
      answeredBy,
      answeredAt: new Date(),
      status: 'answered'
    });

    return updated(res, inquiry, '답변이 등록되었습니다.');

  } catch (err) {
    console.error('문의 답변 오류:', err);
    return error(res, ErrorCodes.DATABASE_ERROR, 500);
  }
};
```

---

## 5. 에러 코드 추가

### responseHelper.js 업데이트
```javascript
// utils/responseHelper.js에 추가

ErrorCodes.NOTICE_NOT_FOUND = { code: 3101, message: '공지사항을 찾을 수 없습니다.' };
ErrorCodes.FAQ_NOT_FOUND = { code: 3102, message: 'FAQ를 찾을 수 없습니다.' };
ErrorCodes.FAQ_CATEGORY_NOT_FOUND = { code: 3103, message: 'FAQ 카테고리를 찾을 수 없습니다.' };
ErrorCodes.INQUIRY_NOT_FOUND = { code: 3104, message: '문의를 찾을 수 없습니다.' };
ErrorCodes.INQUIRY_NOT_OWNER = { code: 2104, message: '본인의 문의만 조회할 수 있습니다.' };
ErrorCodes.FAQ_CATEGORY_HAS_ITEMS = { code: 4301, message: 'FAQ가 있는 카테고리는 삭제할 수 없습니다.' };
```

---

## 6. 마이그레이션 스크립트

```javascript
// migrations/YYYYMMDDHHMMSS-create-support-center.js

'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Notice 테이블 생성
    await queryInterface.createTable('Notices', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      isImportant: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      viewCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      publishedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('draft', 'published', 'archived'),
        defaultValue: 'draft'
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Admins', key: 'id' }
      },
      updatedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Admins', key: 'id' }
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // FAQCategory 테이블 생성
    await queryInterface.createTable('FAQCategories', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      userType: {
        type: Sequelize.ENUM('all', 'host', 'guest'),
        defaultValue: 'all'
      },
      displayOrder: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // FAQ 테이블 생성
    await queryInterface.createTable('FAQs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      categoryId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'FAQCategories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      question: {
        type: Sequelize.STRING(300),
        allowNull: false
      },
      answer: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      displayOrder: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      viewCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Admins', key: 'id' }
      },
      updatedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Admins', key: 'id' }
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Inquiry 테이블 생성
    await queryInterface.createTable('Inquiries', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      categoryType: {
        type: Sequelize.ENUM('general', 'reservation', 'payment', 'room', 'account', 'other'),
        allowNull: false
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'answered', 'closed'),
        defaultValue: 'pending'
      },
      answer: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      answeredBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Admins', key: 'id' }
      },
      answeredAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // 인덱스 생성
    await queryInterface.addIndex('Notices', ['status'], { name: 'idx_notices_status' });
    await queryInterface.addIndex('Notices', ['publishedAt'], { name: 'idx_notices_published_at' });
    await queryInterface.addIndex('Notices', ['isImportant', 'publishedAt'], { name: 'idx_notices_important_published' });

    await queryInterface.addIndex('FAQCategories', ['userType', 'isActive', 'displayOrder'], { name: 'idx_faq_categories_user_type' });
    await queryInterface.addIndex('FAQCategories', ['name', 'userType'], { unique: true, name: 'faq_category_name_user_type_unique' });

    await queryInterface.addIndex('FAQs', ['categoryId', 'isActive', 'displayOrder'], { name: 'idx_faqs_category' });

    await queryInterface.addIndex('Inquiries', ['userId', 'status', 'createdAt'], { name: 'idx_inquiries_user' });
    await queryInterface.addIndex('Inquiries', ['status', 'createdAt'], { name: 'idx_inquiries_status' });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Inquiries');
    await queryInterface.dropTable('FAQs');
    await queryInterface.dropTable('FAQCategories');
    await queryInterface.dropTable('Notices');
  }
};
```

---

## 7. 구현 순서 (Implementation Roadmap)

### Phase 1: 데이터베이스 및 모델 (1-2일)
1. ✅ 마이그레이션 스크립트 작성 및 실행
2. ✅ Sequelize 모델 파일 생성 (Notice, FAQCategory, FAQ, Inquiry)
3. ✅ models/index.js에 관계 설정 추가
4. ✅ 에러 코드 정의 (responseHelper.js)

### Phase 2: 공지사항 기능 (2-3일)
1. ✅ noticeController.js 생성
2. ✅ 사용자용 API 구현 (목록, 상세)
3. ✅ 관리자용 API 구현 (CRUD)
4. ✅ routes 설정 (supportRoutes.js, adminRoutes.js)
5. ✅ 테스트

### Phase 3: FAQ 기능 (2-3일)
1. ✅ faqController.js 생성
2. ✅ FAQ 카테고리 관리 API 구현
3. ✅ FAQ CRUD API 구현
4. ✅ 사용자용 조회 API 구현 (카테고리별 그룹화)
5. ✅ 테스트

### Phase 4: 문의하기 기능 (2-3일)
1. ✅ inquiryController.js 생성
2. ✅ 사용자용 API 구현 (등록, 내 문의 조회)
3. ✅ 관리자용 API 구현 (전체 조회, 답변 등록)
4. ✅ 테스트

### Phase 5: 통합 및 최종 테스트 (1-2일)
1. ✅ Rate Limiting 적용
2. ✅ API 문서 작성
3. ✅ E2E 테스트
4. ✅ 프론트엔드 연동 준비

---

## 8. 보안 고려사항

### 8.1 인증/권한
- **공지사항/FAQ 조회**: 인증 불필요 (Public)
- **문의 등록/조회**: 사용자 인증 필요
- **관리자 기능**: cs_admin 이상 권한 필요

### 8.2 XSS 방지
- 공지사항/FAQ 내용에 HTML 허용 시 sanitization 필수
- 라이브러리: `sanitize-html` 또는 `dompurify` 사용 권장

### 8.3 Rate Limiting
```javascript
// middleware/rateLimiter.js에 추가
const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 10, // 문의 등록 최대 10회
  message: {
    code: 4296,
    message: '문의 등록 횟수가 너무 많습니다. 잠시 후 다시 시도해주세요.'
  }
});

// routes/supportRoutes.js
router.post('/inquiries', authenticateToken, supportLimiter, inquiryController.createInquiry);
```

### 8.4 입력 검증
- 제목: 최대 200자
- 내용: 최대 5,000자
- 카테고리: ENUM 타입 검증

---

## 9. 성능 최적화

### 9.1 인덱스 전략
- 상태(status) + 날짜 복합 인덱스
- 카테고리 + 활성화 여부 복합 인덱스
- 사용자별 문의 조회를 위한 userId + status 복합 인덱스

### 9.2 캐싱 고려사항
- 공지사항 목록: Redis 캐싱 (TTL: 5분)
- FAQ 목록: Redis 캐싱 (TTL: 10분)
- 조회수는 비동기로 증가 (Redis increment → 일정 주기로 DB 동기화)

---

## 10. 프론트엔드 연동 예시

### 10.1 공지사항 목록 API 응답 예시
```json
{
  "success": true,
  "data": {
    "notices": [
      {
        "id": 1,
        "title": "서비스 점검 안내",
        "isImportant": true,
        "viewCount": 152,
        "publishedAt": "2025-01-10T09:00:00.000Z",
        "createdAt": "2025-01-10T08:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 48,
      "itemsPerPage": 10
    }
  },
  "message": "공지사항 목록 조회 성공"
}
```

### 10.2 FAQ 목록 API 응답 예시 (카테고리별 그룹화)
```json
{
  "success": true,
  "data": {
    "전체": [
      {
        "id": 1,
        "question": "회원가입은 어떻게 하나요?",
        "answer": "<p>회원가입 방법은...</p>",
        "viewCount": 234
      }
    ],
    "방 등록": [
      {
        "id": 5,
        "question": "방 등록 절차가 어떻게 되나요?",
        "answer": "<p>방 등록은 7단계로...</p>",
        "viewCount": 189
      }
    ]
  },
  "message": "FAQ 목록 조회 성공"
}
```

### 10.3 문의 목록 API 응답 예시
```json
{
  "success": true,
  "data": {
    "inquiries": [
      {
        "id": 12,
        "categoryType": "reservation",
        "title": "예약 취소 문의",
        "status": "answered",
        "createdAt": "2025-01-10T14:30:00.000Z",
        "answeredAt": "2025-01-10T16:00:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 2,
      "totalItems": 15,
      "itemsPerPage": 10
    }
  },
  "message": "문의 목록 조회 성공"
}
```

---

## 11. 추가 기능 제안 (선택사항)

### 11.1 이메일 알림
- 문의 등록 시 사용자에게 확인 이메일
- 답변 등록 시 사용자에게 알림 이메일

### 11.2 푸시 알림 (모바일)
- Firebase Cloud Messaging으로 답변 알림

### 11.3 통계 및 분석
- 자주 조회되는 FAQ 추천
- 카테고리별 문의 통계
- 평균 답변 시간 측정

### 11.4 첨부파일 지원
- 문의 작성 시 이미지 첨부 가능
- Inquiry 모델에 attachments 컬럼 추가 (JSON)

---

## 12. 테스트 체크리스트

### 12.1 공지사항
- [ ] 공지사항 목록 조회 (published만)
- [ ] 중요 공지 상단 고정 확인
- [ ] 게시 기간 만료된 공지 미노출 확인
- [ ] 조회수 증가 확인
- [ ] 관리자 CRUD 동작 확인

### 12.2 FAQ
- [ ] 카테고리별 FAQ 조회
- [ ] 사용자 타입별 필터링 (host/guest/all)
- [ ] 검색 기능 동작 확인
- [ ] 관리자 카테고리 관리
- [ ] 관리자 FAQ CRUD

### 12.3 문의하기
- [ ] 문의 등록 (인증 필요)
- [ ] 내 문의 목록 조회
- [ ] 타인 문의 조회 차단
- [ ] 관리자 전체 문의 조회
- [ ] 관리자 답변 등록
- [ ] 답변 후 상태 변경 (pending → answered)

### 12.4 보안 및 성능
- [ ] Rate Limiting 동작 확인
- [ ] XSS 방지 (HTML 입력 시 sanitization)
- [ ] SQL Injection 방지
- [ ] 인덱스 성능 확인 (EXPLAIN 쿼리)

---

## 13. 문서 및 코드 위치

### 파일 구조
```
ezstay_back/
├── models/
│   ├── Notice.js           # 공지사항 모델
│   ├── FAQCategory.js      # FAQ 카테고리 모델
│   ├── FAQ.js              # FAQ 모델
│   └── Inquiry.js          # 문의 모델
├── controllers/
│   ├── noticeController.js # 공지사항 컨트롤러
│   ├── faqController.js    # FAQ 컨트롤러
│   └── inquiryController.js # 문의 컨트롤러
├── routes/
│   ├── supportRoutes.js    # 사용자용 고객센터 라우트
│   └── adminRoutes.js      # 관리자용 고객센터 라우트 추가
├── migrations/
│   └── YYYYMMDDHHMMSS-create-support-center.js
└── claudedocs/
    └── SUPPORT_CENTER_DESIGN.md # 이 문서
```

---

## 14. 참고 사항

### PRD 요구사항 매핑
| PRD 요구사항 | 설계 반영 |
|-------------|----------|
| 공지사항 CRUD (관리자) | ✅ Notice 모델 + Admin API |
| 자주 묻는 질문 CRUD (관리자) | ✅ FAQ, FAQCategory 모델 + Admin API |
| 문의하기 등록 (사용자) | ✅ Inquiry 모델 + User API |
| 문의 조회/답변 (관리자) | ✅ Admin API with answer field |
| 호스트/게스트 구분 | ✅ FAQ userType, 문의는 User 기반 |

### 기존 시스템과의 통합
- **Admin 권한**: 기존 `cs_admin` 역할 활용
- **User 인증**: 기존 `authenticateToken` 미들웨어 사용
- **응답 형식**: 기존 `responseHelper` 패턴 준수
- **에러 처리**: 기존 에러 코드 체계 확장 (31xx, 43xx)

---

**설계 완료일**: 2025-01-11
**설계자**: Claude Code (Sonnet 4.5)
**검토자**: [프로젝트 리더 이름]
