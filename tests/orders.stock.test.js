const request = require('supertest');
const h = require('./helpers/setup');

let app;
beforeAll(async () => { await h.startDb(); app = h.getApp(); await h.syncIndexes(); });
afterAll(h.stopDb);
beforeEach(h.clearDb);

const Order = () => require('../src/models/Order');
const Product = () => require('../src/models/Product');
const place = (user, body) => request(app).post('/api/orders').set(h.bearer(user)).send(body);
const count = (results, status) => results.filter(r => r.status === status).length;

describe('stock reservation is atomic', () => {
  test('stock = 1, two simultaneous purchases: exactly one succeeds, one fails, stock ends at 0', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 1 }] });
    const [a, b] = [await h.createUser(), await h.createUser()];

    const results = await Promise.all([place(a, h.orderBody(product)), place(b, h.orderBody(product))]);

    expect(count(results, 201)).toBe(1);
    expect(count(results, 409)).toBe(1);
    const failed = results.find(r => r.status === 409);
    expect(failed.body.code).toBe('OUT_OF_STOCK');
    expect(failed.body.error).toMatch(/out of stock/i);

    expect(await h.stockOf(product._id)).toBe(0);
    expect(await Order().countDocuments()).toBe(1);
  });

  test('stock = 3, ten simultaneous buyers: exactly three orders, stock 0, never negative', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 3 }] });
    const users = await Promise.all(Array.from({ length: 10 }, () => h.createUser()));

    const results = await Promise.all(users.map(u => place(u, h.orderBody(product))));

    expect(count(results, 201)).toBe(3);
    expect(count(results, 409)).toBe(7);
    expect(await h.stockOf(product._id)).toBe(0);
    expect(await Order().countDocuments()).toBe(3);
    const fresh = await Product().findById(product._id).lean();
    expect(fresh.stock).toBe(0);
    expect(fresh.sizeInventory.every(e => e.stock >= 0)).toBe(true);
  });

  test('same race through online checkout: only one pending order may hold the last unit', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 1 }] });
    const [a, b] = [await h.createUser(), await h.createUser()];
    const results = await Promise.all([
      place(a, h.orderBody(product, { paymentMethod: 'online' })),
      place(b, h.orderBody(product, { paymentMethod: 'online' }))
    ]);
    expect(count(results, 201)).toBe(1);
    expect(count(results, 409)).toBe(1);
    expect(await h.stockOf(product._id)).toBe(0);
  });

  test('quantities: 5 in stock, concurrent orders for 3 and 3 cannot both succeed', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const [a, b] = [await h.createUser(), await h.createUser()];
    const body = h.orderBody(product, { item: { quantity: 3 } });

    const results = await Promise.all([place(a, body), place(b, body)]);

    expect(count(results, 201)).toBe(1);
    expect(count(results, 409)).toBe(1);
    expect(await h.stockOf(product._id)).toBe(2);
  });

  test('a quantity larger than the stock is refused and leaves stock untouched', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 2 }] });
    const res = await place(await h.createUser(), h.orderBody(product, { item: { quantity: 3 } }));
    expect(res.status).toBe(409);
    expect(await h.stockOf(product._id)).toBe(2);
    expect(await Order().countDocuments()).toBe(0);
  });

  test('sizes are independent: S sold out does not block L, and L is not oversold', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'S', stock: 0 }, { size: 'M', stock: 4 }, { size: 'L', stock: 1 }] });
    const users = await Promise.all(Array.from({ length: 3 }, () => h.createUser()));

    const small = await place(users[0], h.orderBody(product, { item: { selectedSize: 'S' } }));
    expect(small.status).toBe(409);

    const large = await Promise.all([
      place(users[1], h.orderBody(product, { item: { selectedSize: 'L' } })),
      place(users[2], h.orderBody(product, { item: { selectedSize: 'L' } }))
    ]);
    expect(count(large, 201)).toBe(1);
    expect(count(large, 409)).toBe(1);

    expect(await h.stockOf(product._id, 'S')).toBe(0);
    expect(await h.stockOf(product._id, 'M')).toBe(4);
    expect(await h.stockOf(product._id, 'L')).toBe(0);
    expect((await Product().findById(product._id).lean()).stock).toBe(4);
  });

  test('an out-of-stock product cannot be ordered at all', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 0 }] });
    for (const paymentMethod of ['cod', 'online']) {
      const res = await place(await h.createUser(), h.orderBody(product, { paymentMethod }));
      expect(res.status).toBe(409);
    }
    expect(await Order().countDocuments()).toBe(0);
  });

  test('a size the product does not have cannot be ordered', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const res = await place(await h.createUser(), h.orderBody(product, { item: { selectedSize: 'XXL' } }));
    expect(res.status).toBe(409);
    expect(await h.stockOf(product._id)).toBe(5);
  });

  test('multi-line order is all-or-nothing: one unavailable line reserves nothing', async () => {
    const available = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const soldOut = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 0 }] });
    const body = {
      items: [
        { product: String(available._id), quantity: 2, selectedSize: 'M' },
        { product: String(soldOut._id), quantity: 1, selectedSize: 'M' }
      ],
      shippingAddress: h.shippingAddress,
      paymentMethod: 'cod'
    };
    const res = await place(await h.createUser(), body);
    expect(res.status).toBe(409);
    expect(await h.stockOf(available._id)).toBe(5);
    expect(await Order().countDocuments()).toBe(0);
  });

  test('the same product+size split across two lines is counted together', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 3 }] });
    const body = {
      items: [
        { product: String(product._id), quantity: 2, selectedSize: 'M' },
        { product: String(product._id), quantity: 2, selectedSize: 'M' }
      ],
      shippingAddress: h.shippingAddress,
      paymentMethod: 'cod'
    };
    expect((await place(await h.createUser(), body)).status).toBe(409);
    expect(await h.stockOf(product._id)).toBe(3);
  });

  test('invalid quantities are rejected', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }] });
    const user = await h.createUser();
    for (const quantity of [0, -1, 1.5, 'abc']) {
      expect((await place(user, h.orderBody(product, { item: { quantity } }))).status).toBe(400);
    }
    expect(await h.stockOf(product._id)).toBe(5);
  });

  test('legacy product with only a flat stock counter is protected the same way', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 1 }] });
    await Product().collection.updateOne({ _id: product._id }, { $set: { sizeInventory: [], sizes: [], stock: 1 } });
    const [a, b] = [await h.createUser(), await h.createUser()];
    const results = await Promise.all([place(a, h.orderBody(product)), place(b, h.orderBody(product))]);
    expect(count(results, 201)).toBe(1);
    expect(count(results, 409)).toBe(1);
    expect((await Product().collection.findOne({ _id: product._id })).stock).toBe(0);
  });

  test('order items carry a snapshot of the product image, for COD and online orders', async () => {
    const product = await h.createProduct({
      sizeInventory: [{ size: 'M', stock: 5 }],
      images: ['https://ik.imagekit.io/test/first.jpg', 'https://ik.imagekit.io/test/second.jpg']
    });
    const user = await h.createUser();

    const cod = await place(user, h.orderBody(product));
    expect(cod.status).toBe(201);
    expect(cod.body.order.items[0].image).toBe('https://ik.imagekit.io/test/first.jpg');

    const online = await place(user, h.orderBody(product, { paymentMethod: 'online' }));
    expect(online.status).toBe(201);
    expect(online.body.order.items[0].image).toBe('https://ik.imagekit.io/test/first.jpg');

    // stored on the order itself, so it survives the product being removed
    await Product().deleteOne({ _id: product._id });
    const saved = await Order().findById(cod.body.order._id).lean();
    expect(saved.items[0].image).toBe('https://ik.imagekit.io/test/first.jpg');
  });

  test('a product without images still orders normally', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 5 }], images: [] });
    const res = await place(await h.createUser(), h.orderBody(product));
    expect(res.status).toBe(201);
    expect(res.body.order.items[0].image).toBeUndefined();
  });

  test('successful order keeps the response contract (order, paymentMethod, pricing)', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 2 }], price: 1000 });
    const res = await place(await h.createUser(), h.orderBody(product));
    expect(res.status).toBe(201);
    expect(res.body.paymentMethod).toBe('cod');
    expect(res.body.order.status).toBe('confirmed');
    expect(res.body.order.items[0]).toEqual(expect.objectContaining({ quantity: 1, size: 'M', price: 1000 }));
    expect(res.body.pricing).toEqual(expect.objectContaining({ payableTotal: expect.any(Number), voucherDiscount: 0 }));
  });
});

describe('cancellation returns stock exactly once', () => {
  test('cancel restores stock; cancelling twice (even concurrently) does not restore twice', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 2 }] });
    const user = await h.createUser();
    const order = (await place(user, h.orderBody(product))).body.order;
    expect(await h.stockOf(product._id)).toBe(1);

    const cancel = () => request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(user));
    const results = await Promise.all([cancel(), cancel(), cancel()]);
    expect(count(results, 200)).toBe(1);
    expect(count(results, 400)).toBe(2);
    expect(await h.stockOf(product._id)).toBe(2);

    expect((await cancel()).status).toBe(400);
    expect(await h.stockOf(product._id)).toBe(2);
  });

  test("a customer cannot cancel someone else's order", async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 2 }] });
    const owner = await h.createUser();
    const order = (await place(owner, h.orderBody(product))).body.order;
    const res = await request(app).post(`/api/orders/${order._id}/cancel`).set(h.bearer(await h.createUser()));
    expect(res.status).toBe(403);
    expect(await h.stockOf(product._id)).toBe(1);
  });

  test('admin cancelling from the panel also returns the stock', async () => {
    const product = await h.createProduct({ sizeInventory: [{ size: 'M', stock: 2 }] });
    const order = (await place(await h.createUser(), h.orderBody(product))).body.order;
    const admin = await h.createUser({ roles: ['admin'] });
    const res = await request(app).put(`/api/admin/orders/${order._id}/status`).set(h.bearer(admin)).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(await h.stockOf(product._id)).toBe(2);
  });
});
