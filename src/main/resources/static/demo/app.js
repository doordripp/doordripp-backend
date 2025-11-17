const apiBase = '/api';
let cart = { items: [], total: 0 };

// Utility: Show messages
function showMessage(msg, type = 'info') {
  const container = document.getElementById('messages');
  const msgEl = document.createElement('div');
  msgEl.className = `message ${type}`;
  msgEl.innerText = msg;
  container.appendChild(msgEl);
  setTimeout(() => msgEl.remove(), 4000);
}

// Fetch products
async function fetchProducts() {
  try {
    const res = await fetch(apiBase + '/products');
    if (!res.ok) throw new Error('Failed to fetch products');
    return await res.json();
  } catch (e) {
    showMessage('Error loading products: ' + e.message, 'error');
    return [];
  }
}

// Fetch cart
async function fetchCart() {
  try {
    const res = await fetch(apiBase + '/cart');
    if (res.status === 200) return await res.json();
    return { items: [], total: 0 };
  } catch (e) {
    console.error('Error fetching cart:', e);
    return { items: [], total: 0 };
  }
}

// Add to cart
async function addToCart(productId, quantity) {
  if (quantity <= 0) {
    showMessage('Quantity must be greater than 0', 'error');
    return;
  }
  try {
    const res = await fetch(apiBase + '/cart/add?productId=' + productId + '&quantity=' + quantity, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to add to cart');
    cart = await res.json();
    await renderCart();
    showMessage('Added to cart!', 'success');
  } catch (e) {
    showMessage('Error adding to cart: ' + e.message, 'error');
  }
}

// Remove from cart
async function removeFromCart(productId) {
  try {
    const res = await fetch(apiBase + '/cart/remove?productId=' + productId, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to remove from cart');
    cart = await res.json();
    await renderCart();
    showMessage('Removed from cart', 'success');
  } catch (e) {
    showMessage('Error removing from cart: ' + e.message, 'error');
  }
}

// Checkout
async function checkout() {
  if (!cart || !cart.items || cart.items.length === 0) {
    showMessage('Cart is empty', 'error');
    return;
  }
  try {
    const res = await fetch(apiBase + '/cart/checkout', { method: 'POST' });
    if (!res.ok) throw new Error('Checkout failed');
    const order = await res.json();
    showMessage('Order placed! Order ID: ' + order.id, 'success');
    cart = { items: [], total: 0 };
    await renderCart();
  } catch (e) {
    showMessage('Checkout failed: ' + e.message, 'error');
  }
}

// Clear cart
async function clearCart() {
  if (cart.items && cart.items.length > 0) {
    for (const item of cart.items) {
      await removeFromCart(item.product.id);
    }
  }
}

// Render products
function renderProducts(products) {
  const container = document.getElementById('products');
  if (!products || products.length === 0) {
    container.innerHTML = '<p>No products available</p>';
    return;
  }
  
  container.innerHTML = '';
  products.forEach(p => {
    const div = document.createElement('div');
    div.className = 'product';
    const inStock = p.stock > 0;
    div.innerHTML = `
      <h3>${p.name}</h3>
      <p class="price">$${p.price}</p>
      <p class="stock">Stock: ${p.stock}</p>
      <div>
        <input type="number" id="qty-${p.id}" value="1" min="1" max="${p.stock}" ${!inStock ? 'disabled' : ''} />
        <button onclick="addToCart(${p.id}, parseInt(document.getElementById('qty-${p.id}').value))" ${!inStock ? 'disabled' : ''}>
          ${inStock ? 'Add to Cart' : 'Out of Stock'}
        </button>
      </div>
    `;
    container.appendChild(div);
  });
}

// Render cart
async function renderCart() {
  const container = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  
  if (!cart || !cart.items || cart.items.length === 0) {
    container.innerHTML = '<div class="cart-empty">(empty)</div>';
    totalEl.innerText = '0.00';
    return;
  }
  
  container.innerHTML = '';
  cart.items.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'cart-item';
    itemDiv.innerHTML = `
      <div class="cart-item-info">
        <strong>${item.product.name}</strong><br/>
        Qty: ${item.quantity} × $${item.price}
      </div>
      <button class="cart-item-remove" onclick="removeFromCart(${item.product.id})">Remove</button>
    `;
    container.appendChild(itemDiv);
  });
  
  totalEl.innerText = (cart.total || 0).toFixed(2);
}

// Event listeners
document.getElementById('checkoutBtn').addEventListener('click', checkout);
document.getElementById('clearCartBtn').addEventListener('click', clearCart);

// Initialize
async function init() {
  showMessage('Loading store...', 'info');
  const products = await fetchProducts();
  renderProducts(products);
  cart = await fetchCart();
  await renderCart();
  showMessage('Store loaded!', 'success');
}

init().catch(e => {
  console.error('Init error:', e);
  showMessage('Failed to load store', 'error');
});
