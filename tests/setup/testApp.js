/**
 * testApp.js
 * 통합 테스트용 Express 앱
 * - DB 연결, 스케줄러, Firebase 초기화 없음
 * - 라우터만 마운트
 */

'use strict';

process.env.TZ = 'Asia/Seoul';

const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 라우터 마운트
const roomRoutes       = require('../../routes/roomRoutes');
const authRoutes       = require('../../routes/authRoutes');
const userRoutes       = require('../../routes/userRoutes');
const hostRoutes       = require('../../routes/hostRoutes');
const contractRoutes   = require('../../routes/contractRoutes');
const refundRoutes     = require('../../routes/refundRoutes');
const rentalOrderRoutes = require('../../routes/rentalOrderRoutes');
const notificationRoutes = require('../../routes/notificationRoutes');
const { adminRouter: rentalItemAdminRoutes } = require('../../routes/rentalItemRoutes');
const rentalItemRoutes = require('../../routes/rentalItemRoutes');
const adminRoutes      = require('../../routes/adminRoutes');
const moveInRoutes     = require('../../routes/moveInRoutes');
const guestMoveInRoutes = require('../../routes/guestMoveInRoutes');
const adminMoveInOptionRoutes = require('../../routes/adminMoveInOptionRoutes');
const adminGuestOrderRoutes = require('../../routes/adminGuestOrderRoutes');
const adminMoveInCaseRoutes = require('../../routes/adminMoveInCaseRoutes');

app.use('/api/rooms',          roomRoutes);
app.use('/api/auth',           authRoutes);
app.use('/api/user',           userRoutes);
app.use('/api/host',           hostRoutes);
app.use('/api/host/move-in',   moveInRoutes);
app.use('/api/contracts',      contractRoutes);
app.use('/api',                refundRoutes);
app.use('/api',                rentalOrderRoutes);
app.use('/api/rental-items',   rentalItemRoutes);
app.use('/api/admin/rental-items', rentalItemAdminRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/admin/move-in',  adminMoveInOptionRoutes);
app.use('/api/admin/move-in',  adminGuestOrderRoutes);
app.use('/api/admin/move-in',  adminMoveInCaseRoutes);
app.use('/api/guest/move-in',  guestMoveInRoutes);
app.use('/api/notifications',  notificationRoutes);

app.get('/', (req, res) => res.json({ ok: true }));

module.exports = app;
