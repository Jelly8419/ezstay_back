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

const sequelize = new Sequelize('livemoment', process.env.DB_USER || 'root', process.env.DB_PASSWORD || '', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql'
});

sequelize.authenticate()
  .then(() => {
    console.log('Connected to MySQL');
  })
  .catch(err => {
    console.error('MySQL connection error:', err);
  });

const roomRoutes = require('./routes/roomRoutes');

app.use('/api/rooms', roomRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Rental API Server is running!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;