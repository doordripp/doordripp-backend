// Test the new related products and recommendations API endpoints
const axios = require('axios');

const BASE_URL = 'http://localhost:3000'; // Your backend URL

// Test 1: Get related products for a specific product
async function testRelatedProducts(productId) {
  try {
    console.log(`\n🔍 Testing Related Products for Product ID: ${productId}`);
    const response = await axios.get(`${BASE_URL}/products/${productId}/related?limit=8`);
    
    console.log('✅ Related Products Response:');
    console.log(`Current Product: ${response.data.currentProduct.name} (${response.data.currentProduct.category}/${response.data.currentProduct.subcategory})`);
    console.log(`Found ${response.data.count} related products:`);
    
    response.data.relatedProducts.forEach((product, index) => {
      console.log(`  ${index + 1}. ${product.name} - ₹${product.price} (${product.category}/${product.subcategory})`);
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Related Products Error:', error.response?.data || error.message);
  }
}

// Test 2: Get smart recommendations for cart/general use
async function testSmartRecommendations() {
  try {
    console.log('\n🎯 Testing Smart Recommendations');
    const response = await axios.get(`${BASE_URL}/products/recommendations/smart`, {
      params: {
        categories: 'Shoes,Clothing', // Example categories
        subcategories: 'Sneakers,T-Shirts',
        limit: 6
      }
    });
    
    console.log('✅ Smart Recommendations Response:');
    console.log(`Found ${response.data.count} recommendations:`);
    
    response.data.recommendations.forEach((product, index) => {
      console.log(`  ${index + 1}. ${product.name} - ₹${product.price} (${product.category}/${product.subcategory})`);
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Smart Recommendations Error:', error.response?.data || error.message);
  }
}

// Test 3: Get recommendations excluding specific products (for cart page)
async function testCartRecommendations(excludeProductIds) {
  try {
    console.log('\n🛒 Testing Cart Recommendations');
    const response = await axios.get(`${BASE_URL}/products/recommendations/smart`, {
      params: {
        categories: 'Fashion,Electronics',
        excludeIds: excludeProductIds.join(','), // Exclude cart items
        limit: 4
      }
    });
    
    console.log('✅ Cart Recommendations Response:');
    console.log(`Found ${response.data.count} cart recommendations (excluding cart items):`);
    
    response.data.recommendations.forEach((product, index) => {
      console.log(`  ${index + 1}. ${product.name} - ₹${product.price} (${product.category})`);
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Cart Recommendations Error:', error.response?.data || error.message);
  }
}

// Test 4: Get all products to find a valid product ID
async function getFirstProductId() {
  try {
    const response = await axios.get(`${BASE_URL}/products?limit=5`);
    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0].id || response.data.data[0]._id;
    }
    return null;
  } catch (error) {
    console.error('❌ Error getting products:', error.response?.data || error.message);
    return null;
  }
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting Related Products & Recommendations API Tests\n');
  
  // Get a valid product ID first
  const productId = await getFirstProductId();
  if (!productId) {
    console.error('❌ Could not find any products to test with');
    return;
  }
  
  console.log(`📦 Using Product ID: ${productId} for testing`);
  
  // Test all endpoints
  await testRelatedProducts(productId);
  await testSmartRecommendations();
  await testCartRecommendations([productId]); // Exclude the test product
  
  console.log('\n✨ All tests completed!');
}

// Frontend Usage Examples
console.log(`
📱 FRONTEND USAGE EXAMPLES:

1. Product Detail Page - Related Products:
   GET /products/:productId/related?limit=8
   
   useEffect(() => {
     const fetchRelated = async () => {
       const response = await api.get(\`/products/\${productId}/related?limit=8\`);
       setRelatedProducts(response.data.relatedProducts);
     };
     fetchRelated();
   }, [productId]);

2. Cart Page - Smart Recommendations:
   GET /products/recommendations/smart?categories=Fashion&excludeIds=id1,id2&limit=6
   
   const cartCategories = cartItems.map(item => item.category).join(',');
   const excludeIds = cartItems.map(item => item.id).join(',');
   const response = await api.get('/products/recommendations/smart', {
     params: { categories: cartCategories, excludeIds, limit: 6 }
   });

3. Homepage - General Recommendations:
   GET /products/recommendations/smart?limit=10
   
   const response = await api.get('/products/recommendations/smart?limit=10');
   setRecommendedProducts(response.data.recommendations);

🎯 ALGORITHM FEATURES:
✅ Same category + subcategory priority
✅ Similar price range matching (±30%)
✅ Description keyword analysis
✅ Fallback to popular/recent products
✅ Duplicate removal
✅ Exclude current product
✅ Smart category-based filtering
✅ Flexible limit control
✅ Structured response format

`);

// Run the tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  testRelatedProducts,
  testSmartRecommendations,
  testCartRecommendations,
  runTests
};