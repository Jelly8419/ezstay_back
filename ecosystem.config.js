require('dotenv').config();

module.exports = {
  apps: [{
    name: 'ezstay-api',
    script: 'server.js',
    env: {
      TZ: 'Asia/Seoul'
    }
  }]
};
