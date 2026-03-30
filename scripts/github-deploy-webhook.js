const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const dotenv = require('dotenv');

const appRoot = path.join(__dirname, '..');

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

const DEPLOY_WEBHOOK_PORT = Number(process.env.DEPLOY_WEBHOOK_PORT || 3001);
const GITHUB_WEBHOOK_SECRET = String(process.env.GITHUB_WEBHOOK_SECRET || '').trim();

const FRONTEND_REPO_FULL_NAME = process.env.DEPLOY_FRONTEND_REPO_FULL_NAME || 'doordripp/doordripp-frontend';
const BACKEND_REPO_FULL_NAME = process.env.DEPLOY_BACKEND_REPO_FULL_NAME || 'doordripp/doordripp-backend';
const FRONTEND_BRANCH = process.env.DEPLOY_FRONTEND_BRANCH || 'main';
const BACKEND_BRANCH = process.env.DEPLOY_BACKEND_BRANCH || 'main';
const FRONTEND_REPO_PATH = process.env.DEPLOY_FRONTEND_REPO_PATH || '/var/www/doordripp-frontend';
const BACKEND_REPO_PATH = process.env.DEPLOY_BACKEND_REPO_PATH || '/var/www/doordripp-backend';

const frontendDeployCommand = [
  `cd "${FRONTEND_REPO_PATH}"`,
  `git pull --ff-only origin ${FRONTEND_BRANCH}`,
  'npm ci',
  'npm run build'
].join(' && ');

const backendDeployCommand = [
  `cd "${BACKEND_REPO_PATH}"`,
  `git pull --ff-only origin ${BACKEND_BRANCH}`,
  'npm ci',
  'pm2 startOrReload ecosystem.config.js --only doordripp-backend --env production'
].join(' && ');

const deployTargets = {
  [FRONTEND_REPO_FULL_NAME]: {
    branchRef: `refs/heads/${FRONTEND_BRANCH}`,
    label: 'frontend',
    command: frontendDeployCommand
  },
  [BACKEND_REPO_FULL_NAME]: {
    branchRef: `refs/heads/${BACKEND_BRANCH}`,
    label: 'backend',
    command: backendDeployCommand
  }
};

const safeCompareSignature = (providedSignature, body) => {
  if (!providedSignature || !GITHUB_WEBHOOK_SECRET) return false;

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', GITHUB_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')}`;

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const runDeploy = (target) => {
  console.log(`Starting ${target.label} deploy...`);

  exec(target.command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`${target.label} deploy failed:`, error.message);
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      return;
    }

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log(`${target.label} deploy completed successfully.`);
  });
};

http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      service: 'doordripp-deploy-webhook'
    }));
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }

  let body = '';

  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', () => {
    const signature = req.headers['x-hub-signature-256'];

    if (!GITHUB_WEBHOOK_SECRET) {
      console.error('GITHUB_WEBHOOK_SECRET is not configured. Refusing deploy.');
      res.statusCode = 500;
      res.end('Webhook secret not configured');
      return;
    }

    if (!safeCompareSignature(signature, body)) {
      console.warn('Deploy webhook rejected: invalid signature');
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      res.statusCode = 400;
      res.end('Invalid JSON');
      return;
    }

    const repoName = payload?.repository?.full_name;
    const target = deployTargets[repoName];

    if (!target) {
      console.log(`Ignored webhook for unconfigured repo: ${repoName || 'unknown'}`);
      res.end('Ignored repo');
      return;
    }

    if (payload.ref !== target.branchRef) {
      console.log(`Ignored ${target.label} webhook for branch ${payload.ref}`);
      res.end('Ignored branch');
      return;
    }

    console.log(`Webhook verified for ${target.label} (${repoName}) on ${payload.ref}`);
    runDeploy(target);
    res.end('Deploy triggered');
  });
}).listen(DEPLOY_WEBHOOK_PORT, () => {
  console.log(`GitHub deploy webhook listening on port ${DEPLOY_WEBHOOK_PORT}`);
});
