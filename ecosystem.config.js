const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const appRoot = __dirname;

const loadEnvFile = (fileName) => {
  const envPath = path.join(appRoot, fileName);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
};

loadEnvFile('.env');
loadEnvFile(process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');
loadEnvFile('.env.local');
loadEnvFile(process.env.NODE_ENV === 'production' ? '.env.production.local' : '.env.development.local');

const toEnvValue = (key, fallback = '') => process.env[key] || fallback;

module.exports = {
  apps: [
    {
      name: 'doordripp-backend',
      cwd: appRoot,
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: toEnvValue('PORT', '4000')
      }
    },
    {
      name: 'doordripp-deploy-webhook',
      cwd: appRoot,
      script: 'scripts/github-deploy-webhook.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '256M',
      env_production: {
        NODE_ENV: 'production',
        DEPLOY_WEBHOOK_PORT: toEnvValue('DEPLOY_WEBHOOK_PORT', '3001'),
        GITHUB_WEBHOOK_SECRET: toEnvValue('GITHUB_WEBHOOK_SECRET', ''),
        MONGO_URI: toEnvValue('MONGO_URI', '')
      }
    }
  ]
};
