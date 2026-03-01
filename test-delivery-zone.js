// Test script to check delivery zone creation
const axios = require('axios');

async function testDeliveryZone() {
  try {
    // First login as admin
    console.log('1. Logging in as admin...');
    const loginRes = await axios.post('https://doordripp-backend.onrender.com/api/auth/login', {
      emailOrPhone: 'admin2@doordripp.com',
      password: 'Admin@123'
    });
    
    const token = loginRes.data.token;
    console.log('✓ Login successful, token:', token.substring(0, 20) + '...');
    
    // Create a test delivery zone
    console.log('\n2. Creating delivery zone...');
    const zoneRes = await axios.post('https://doordripp-backend.onrender.com/api/admin/delivery-zones', {
      name: 'Test Zone ' + Date.now(),
      type: 'radius',
      center: { lat: 28.6139, lng: 77.2090 },
      radiusKm: 5,
      deliveryFee: 50,
      minOrderValue: 200,
      estimatedDeliveryTime: 30,
      description: 'Test delivery zone',
      isActive: true
    }, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✓ Delivery zone created successfully!');
    console.log('Zone:', JSON.stringify(zoneRes.data, null, 2));
    
  } catch (error) {
    console.error('✗ Error:', error.response?.data || error.message);
    console.error('Status:', error.response?.status);
    if (error.response?.data) {
      console.error('Full error:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testDeliveryZone();
