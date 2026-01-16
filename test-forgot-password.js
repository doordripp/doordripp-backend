require('dotenv').config();
const axios = require('axios');

const API_URL = process.env.API_URL || 'https://doordripp-backend.onrender.com';

async function testForgotPassword() {
  try {
    console.log('Testing forgot password endpoint...');
    console.log(`API URL: ${API_URL}`);

    const response = await axios.post(`${API_URL}/api/auth/forgot-password`, {
      email: 'vikashrajput935843@gmail.com'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Success:', response.data);
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    if (error.response?.status === 500) {
      console.error('Server Error - Full response:', error.response?.data);
      console.error('Stack:', error.response?.data?.stack);
    }
  }
}

testForgotPassword();
