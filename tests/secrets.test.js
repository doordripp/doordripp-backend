const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scan } = require('../scripts/check-secrets');

describe('repository hygiene', () => {
  test('no credential-shaped values, hardcoded OAuth client IDs or JWT fallbacks in tracked files', () => {
    expect(scan()).toEqual([]);
  });

  test('no environment file is tracked', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).split(/\r?\n/);
    expect(tracked.filter(f => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith('.env.example'))).toEqual([]);
  });

  test('.env.example contains placeholders only', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    expect(text).toMatch(/^JWT_SECRET=\s*$/m);
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\/(?!USERNAME:PASSWORD@)[^\s]+:[^\s]+@/);
  });

  test('the scanner actually detects the things it is meant to detect', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-secret-scan-'));
    try {
      const samples = {
        'a.js': "const s = process.env.JWT_SECRET || 'secret';",
        'b.md': 'MONGO_URI=mongodb+srv://' + 'admin:hunter2' + '@cluster0.example.mongodb.net/db',
        'c.js': "const id = '" + '123456789012-' + 'abcdefghijklmnopqrstuvwxyz012345' + ".apps.googleusercontent.com';",
        'd.txt': 'key rzp_' + 'live_' + 'ABCDEFGHIJKLMN'
      };
      for (const [name, content] of Object.entries(samples)) fs.writeFileSync(path.join(repo, name), content);
      // Reuse the rules against the sample directory by pointing the scanner's git call at it.
      execFileSync('git', ['init', '-q'], { cwd: repo });
      const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-secrets.js'), 'utf8')
        .replace("const root = path.join(__dirname, '..');", `const root = ${JSON.stringify(repo)};`);
      fs.mkdirSync(path.join(repo, 'scripts'));
      fs.writeFileSync(path.join(repo, 'scripts', 'scan-copy.js'), script);
      let output = '';
      let code = 0;
      try {
        execFileSync(process.execPath, [path.join(repo, 'scripts', 'scan-copy.js')], { encoding: 'utf8', stdio: 'pipe' });
      } catch (err) {
        code = err.status;
        output = String(err.stderr);
      }
      expect(code).toBe(1);
      for (const name of Object.keys(samples)) expect(output).toContain(name);
      expect(output).not.toContain('hunter2'); // values are never printed
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
