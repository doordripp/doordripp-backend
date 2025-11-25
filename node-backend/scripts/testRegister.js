// Simple script to POST /api/auth/register and print response
(async () => {
  try {
    const url = 'http://localhost:4000/api/auth/register';
    const payload = { name: 'TestUserScript', email: `testscript+${Date.now()}@example.com`, password: 'Test12345' };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log('REQUEST URL:', url);
    console.log('STATUS:', res.status, res.statusText);
    try {
      console.log('HEADERS:', Object.fromEntries(res.headers.entries()));
    } catch (e) {
      console.log('HEADERS: (could not read headers)', e.message);
    }
    console.log('BODY:');
    console.log(text);
  } catch (err) {
    console.error('ERROR SENDING REQUEST:');
    console.error(err && err.stack ? err.stack : err);
  }
})();
