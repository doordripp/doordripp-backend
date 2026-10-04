#!/usr/bin/env node
/**
 * Fails (exit 1) when a tracked file contains something shaped like a real
 * credential, or when an env file is tracked. Run by `npm test`; also suitable
 * as a pre-commit hook or CI step.
 *
 * Only file names, line numbers and the rule name are printed - never the value.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const RULES = [
  { name: 'MongoDB URI with embedded credentials', re: /mongodb(\+srv)?:\/\/[^\s"'`<>:/@]+:[^\s"'`<>@]+@/i,
    allow: /mongodb(\+srv)?:\/\/(USERNAME|user|username|<[^>]+>):(PASSWORD|pass|password|<[^>]+>)@/i },
  { name: 'Razorpay key id', re: /rzp_(live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'ImageKit private key', re: /private_[A-Za-z0-9+/=]{20,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Google OAuth client secret', re: /GOCSPX-[A-Za-z0-9_-]{20,}/ },
  { name: 'Brevo / Sendinblue API key', re: /xkeysib-[a-f0-9]{20,}/i },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Hardcoded Google OAuth client ID', re: /['"`][0-9]{8,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com['"`]/,
    // test fixtures use obviously fake client IDs
    skipFiles: /^tests\// },
  { name: 'JWT secret fallback', re: /JWT_SECRET\s*(\|\||\?\?)\s*['"`]/ },
  { name: 'Assigned secret-looking value',
    re: /^\s*(JWT_SECRET|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|SMTP_PASS|MAIL_PASS|GOOGLE_CLIENT_SECRET|IMAGEKIT_PRIVATE_KEY|BREVO_API_KEY|ONESIGNAL_REST_API_KEY|APP_ONESIGNAL_REST_API_KEY)\s*=\s*([A-Za-z0-9+/=_-]{24,})\s*$/,
    allow: /=\s*(your_|change|example|placeholder)/i }
];

const FORBIDDEN_FILES = /(^|\/)\.env(\.(?!example$)[A-Za-z0-9_.-]+)?$/;
const SKIP = /(^|\/)(package-lock\.json|node_modules\/)|\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf)$/i;
// These files describe the patterns themselves.
const SELF = new Set(['scripts/check-secrets.js', 'tests/secrets.test.js']);

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function scan() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (FORBIDDEN_FILES.test(file)) {
      findings.push({ file, line: 0, rule: 'Environment file must not be tracked' });
      continue;
    }
    if (SKIP.test(file) || SELF.has(file)) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(root, file), 'utf8');
    } catch (err) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const rule of RULES) {
        if (rule.skipFiles && rule.skipFiles.test(file)) continue;
        if (rule.re.test(text) && !(rule.allow && rule.allow.test(text))) {
          findings.push({ file, line: index + 1, rule: rule.name });
        }
      }
    });
  }
  return findings;
}

module.exports = { scan };

if (require.main === module) {
  const findings = scan();
  if (findings.length) {
    console.error('Possible secrets found (values are not shown):');
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
    console.error('\nRemove the value, load it from the environment, and rotate it if it was ever committed.');
    process.exit(1);
  }
  console.log('Secret scan passed.');
}
