const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const h = require('./helpers/setup');

let app;
let InvoiceService;
const pdfPath = path.join(os.tmpdir(), `doordripp-test-invoice-${process.pid}.pdf`);

beforeAll(async () => {
  await h.startDb();
  app = h.getApp();
  await h.syncIndexes();
  InvoiceService = require('../src/services/invoiceService');
  fs.writeFileSync(pdfPath, '%PDF-1.4 test');
});
afterAll(async () => { fs.rmSync(pdfPath, { force: true }); await h.stopDb(); });
beforeEach(h.clearDb);

async function orderWithInvoice() {
  const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
  const owner = await h.createUser();
  const order = (await request(app).post('/api/orders').set(h.bearer(owner)).send(h.orderBody(product))).body.order;
  const invoice = { _id: new mongoose.Types.ObjectId(), orderId: order._id, invoiceNumber: 'DD/25-26/0001', invoicePdfPath: pdfPath, save: async () => {} };
  InvoiceService.getInvoiceByOrderId.mockImplementation(async (id) => (String(id) === String(order._id) ? { invoice, items: [] } : null));
  InvoiceService.getInvoiceById.mockImplementation(async (id) => {
    if (String(id) === String(invoice._id)) return { invoice, items: [] };
    throw new Error('Invoice not found');
  });
  InvoiceService.getInvoiceByNumber.mockImplementation(async () => ({ invoice, items: [] }));
  return { owner, order, invoice };
}

describe('GET /api/orders/:id/invoice (mobile app contract)', () => {
  test('owner gets a link in the shape the app reads, and the link downloads the PDF without a session', async () => {
    const { owner, order } = await orderWithInvoice();
    const res = await request(app).get(`/api/orders/${order._id}/invoice`).set(h.bearer(owner));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      orderId: String(order._id),
      downloadUrl: expect.stringMatching(/^https?:\/\/.+\/api\/invoices\/[a-f0-9]{24}\/download\?token=/),
      invoiceUrl: expect.any(String),
      pdfUrl: expect.any(String)
    }));

    const url = new URL(res.body.downloadUrl);
    const pdf = await request(app).get(url.pathname + url.search); // no Authorization header, like a browser
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });

  test("another customer cannot get a link for someone else's order", async () => {
    const { order } = await orderWithInvoice();
    const res = await request(app).get(`/api/orders/${order._id}/invoice`).set(h.bearer(await h.createUser()));
    expect(res.status).toBe(404);
    expect(res.body.downloadUrl).toBeUndefined();
  });

  test('anonymous callers are refused', async () => {
    const { order } = await orderWithInvoice();
    expect((await request(app).get(`/api/orders/${order._id}/invoice`)).status).toBe(401);
  });

  test('admins may fetch any invoice link', async () => {
    const { order } = await orderWithInvoice();
    const admin = await h.createUser({ roles: ['admin'] });
    expect((await request(app).get(`/api/orders/${order._id}/invoice`).set(h.bearer(admin))).status).toBe(200);
  });

  test('malformed ids do not crash', async () => {
    const user = await h.createUser();
    expect((await request(app).get('/api/orders/not-an-id/invoice').set(h.bearer(user))).status).toBe(404);
  });
});

describe('invoice endpoints enforce ownership (regression: any user could read any invoice)', () => {
  test('download: no credential, a session of a non-owner, a forged or mismatched link are all refused', async () => {
    const { owner, invoice } = await orderWithInvoice();
    const stranger = await h.createUser();
    const base = `/api/invoices/${invoice._id}/download`;

    expect((await request(app).get(base)).status).toBe(401);
    expect((await request(app).get(base).set(h.bearer(stranger))).status).toBe(404);
    expect((await request(app).get(`${base}?token=garbage`)).status).toBe(401);

    // a session token is not a download link
    expect((await request(app).get(`${base}?token=${h.tokenFor(owner)}`)).status).toBe(401);

    // a valid link for a different invoice does not open this one
    const { signPurposeToken } = require('../src/config/auth');
    const otherLink = signPurposeToken({ invoiceId: String(new mongoose.Types.ObjectId()) }, 'invoice-download', '15m');
    expect((await request(app).get(`${base}?token=${otherLink}`)).status).toBe(401);

    expect((await request(app).get(base).set(h.bearer(owner))).status).toBe(200);
  });

  test('read endpoints: non-owners get 404, owners get the invoice', async () => {
    const { owner, order, invoice } = await orderWithInvoice();
    const stranger = await h.createUser();
    for (const url of [
      `/api/invoices/${invoice._id}`,
      `/api/invoices/order/${order._id}`,
      `/api/invoices/number/${encodeURIComponent('DD-25-26-0001')}`
    ]) {
      expect([url, (await request(app).get(url).set(h.bearer(stranger))).status]).toEqual([url, 404]);
      expect([url, (await request(app).get(url).set(h.bearer(owner))).status]).toEqual([url, 200]);
    }
  });
});

describe("orders are private to their owner", () => {
  test("GET /api/orders/:id of another user's order is forbidden; listing only returns own orders", async () => {
    const { owner, order } = await orderWithInvoice();
    const stranger = await h.createUser();
    expect((await request(app).get(`/api/orders/${order._id}`).set(h.bearer(stranger))).status).toBe(403);
    expect((await request(app).get(`/api/orders/${order._id}`).set(h.bearer(owner))).status).toBe(200);
    const list = await request(app).get('/api/orders').set(h.bearer(stranger));
    expect(list.status).toBe(200);
    expect(list.body.orders).toEqual([]);
  });
});
