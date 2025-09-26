const express = require('express');
const { Sequelize } = require('sequelize');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { User, LocalUser, SocialUser, Room, sequelize } = require('./models');

sequelize.authenticate()
  .then(async () => {
    console.log('Connected to MySQL');

    // 데이터베이스 테이블 동기화 (관계 포함)
    await sequelize.sync({ alter: true });
    console.log('Database synchronized');
  })
  .catch(err => {
    console.error('MySQL connection error:', err);
  });

const roomRoutes = require('./routes/roomRoutes');
const authRoutes = require('./routes/authRoutes');

app.use('/api/rooms', roomRoutes);
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Rental API Server is running!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;