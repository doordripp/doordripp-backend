# 🎯 Similar Products & Recommendations API

Complete documentation for the smart product recommendation system that provides related products, cart recommendations, and general suggestions.

## 📚 Table of Contents
- [API Endpoints](#api-endpoints)
- [Recommendation Algorithm](#recommendation-algorithm)
- [Frontend Integration](#frontend-integration)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Response Format](#response-format)

---

## 🚀 API Endpoints

### 1. Get Related Products for Specific Product
**Endpoint:** `GET /products/:id/related`

Get smart recommendations for a specific product based on category, subcategory, price, and description analysis.

```http
GET /products/64f1a2b3c4d5e6f7g8h9i0j1/related?limit=8
```

**Query Parameters:**
- `limit` (optional): Number of products to return (default: 8, max: 20)

**Use Cases:**
- "You Might Also Like" section on product detail pages
- Related products carousel
- Cross-selling recommendations

---

### 2. Get Smart Recommendations
**Endpoint:** `GET /products/recommendations/smart`

Get general recommendations with advanced filtering capabilities for cart pages, homepage, and category-based suggestions.

```http
GET /products/recommendations/smart?categories=Fashion,Electronics&excludeIds=id1,id2&limit=6
```

**Query Parameters:**
- `categories` (optional): Comma-separated list of categories to include
- `subcategories` (optional): Comma-separated list of subcategories to include  
- `excludeIds` (optional): Comma-separated list of product IDs to exclude
- `limit` (optional): Number of products to return (default: 6, max: 20)

**Use Cases:**
- Cart page recommendations ("Complete Your Look")
- Homepage featured products
- Category-based suggestions
- Exclude products already in cart

---

## 🧠 Recommendation Algorithm

Our smart algorithm uses **5-tier prioritization** to find the most relevant products:

### 🥇 **Tier 1: Exact Match (Highest Priority)**
- Same category AND subcategory
- Returns up to 4 products
- Perfect match for product type

### 🥈 **Tier 2: Category Match**
- Same category, different subcategory
- Returns up to 3 products
- Good alternatives within same category

### 🥉 **Tier 3: Price Range Match**
- Similar price range (±30%)
- Different category entirely
- Returns up to 2 products
- Alternative price-conscious options

### 🏅 **Tier 4: Description Keywords**
- Analyzes product description for keywords
- Matches products with similar features
- Returns up to 2 products
- Content-based filtering

### 🏅 **Tier 5: Popular/Recent Fallback**
- Recent or popular products
- Fills remaining limit
- Ensures always enough recommendations

### ✨ **Advanced Features:**
- ✅ **Duplicate Removal** - No repeated products
- ✅ **Current Product Exclusion** - Never shows current product
- ✅ **Flexible Filtering** - Category, subcategory, price-based
- ✅ **Structured Response** - Consistent JSON format
- ✅ **Performance Optimized** - Efficient MongoDB queries

---

## 💻 Frontend Integration

### React + Axios Examples

#### 1. Product Detail Page - Related Products

```jsx
import { useState, useEffect } from 'react';
import api from '../config/api';

const ProductDetail = ({ productId }) => {
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchRelatedProducts = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/products/${productId}/related?limit=8`);
        setRelatedProducts(response.data.relatedProducts);
        console.log('✅ Found', response.data.count, 'related products');
      } catch (error) {
        console.error('❌ Error:', error);
      } finally {
        setLoading(false);
      }
    };

    if (productId) fetchRelatedProducts();
  }, [productId]);

  return (
    <div>
      {/* Product details here */}
      
      {/* Related Products Section */}
      {relatedProducts.length > 0 && (
        <section className="related-products">
          <h2>You Might Also Like</h2>
          <div className="products-grid">
            {relatedProducts.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
```

#### 2. Cart Page - Smart Recommendations

```jsx
const Cart = ({ cartItems }) => {
  const [recommendations, setRecommendations] = useState([]);

  useEffect(() => {
    const fetchCartRecommendations = async () => {
      if (cartItems.length === 0) return;

      // Extract categories and IDs from cart
      const categories = [...new Set(cartItems.map(item => item.category))];
      const subcategories = [...new Set(cartItems.map(item => item.subcategory).filter(Boolean))];
      const excludeIds = cartItems.map(item => item.id);

      try {
        const response = await api.get('/products/recommendations/smart', {
          params: {
            categories: categories.join(','),
            subcategories: subcategories.join(','),
            excludeIds: excludeIds.join(','),
            limit: 6
          }
        });

        setRecommendations(response.data.recommendations);
        console.log('🛒 Cart recommendations:', response.data.count);
      } catch (error) {
        console.error('❌ Error:', error);
      }
    };

    fetchCartRecommendations();
  }, [cartItems]);

  return (
    <div>
      {/* Cart items here */}
      
      {/* Smart Recommendations */}
      {recommendations.length > 0 && (
        <section className="cart-recommendations">
          <h2>Complete Your Look</h2>
          <p>Based on your cart items:</p>
          <div className="recommendations-grid">
            {recommendations.map(product => (
              <RecommendationCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
```

#### 3. Homepage - General Recommendations

```jsx
const Homepage = () => {
  const [featuredProducts, setFeaturedProducts] = useState([]);

  useEffect(() => {
    const fetchFeaturedProducts = async () => {
      try {
        const response = await api.get('/products/recommendations/smart?limit=10');
        setFeaturedProducts(response.data.recommendations);
      } catch (error) {
        console.error('❌ Error:', error);
      }
    };

    fetchFeaturedProducts();
  }, []);

  return (
    <div>
      <h1>Welcome to DoorDripp</h1>
      
      {/* Featured Products */}
      <section className="featured-products">
        <h2>Featured Products</h2>
        <div className="products-grid">
          {featuredProducts.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
};
```

---

## 📝 Usage Examples

### 1. Get Related Products
```bash
curl "http://localhost:3000/products/64f1a2b3c4d5e6f7g8h9i0j1/related?limit=8"
```

### 2. Category-Based Recommendations
```bash
curl "http://localhost:3000/products/recommendations/smart?categories=Fashion,Electronics&limit=6"
```

### 3. Cart Recommendations (Exclude Items)
```bash
curl "http://localhost:3000/products/recommendations/smart?categories=Clothing&excludeIds=id1,id2,id3&limit=4"
```

### 4. Subcategory-Specific
```bash
curl "http://localhost:3000/products/recommendations/smart?subcategories=T-Shirts,Jeans&limit=8"
```

---

## 🧪 Testing

### Automated Testing
Run the included test suite:

```bash
# Start your backend server first
npm start

# Run tests in another terminal
node test-related-products.js
```

### Manual Testing with cURL
```bash
# Test related products
curl http://localhost:3000/products/YOUR_PRODUCT_ID/related

# Test smart recommendations
curl "http://localhost:3000/products/recommendations/smart?categories=Fashion&limit=5"
```

---

## 📊 Response Format

### Related Products Response
```json
{
  "success": true,
  "currentProduct": {
    "id": "64f1a2b3c4d5e6f7g8h9i0j1",
    "name": "Nike Air Max",
    "category": "Shoes",
    "subcategory": "Sneakers"
  },
  "relatedProducts": [
    {
      "id": "64f1a2b3c4d5e6f7g8h9i0j2",
      "name": "Adidas Ultraboost",
      "slug": "adidas-ultraboost",
      "description": "Comfortable running shoes",
      "price": 8999,
      "originalPrice": 12999,
      "discount": 30,
      "category": "Shoes",
      "subcategory": "Sneakers",
      "images": ["image1.jpg", "image2.jpg"],
      "image": "image1.jpg",
      "colors": ["black", "white"],
      "sizes": ["8", "9", "10"],
      "rating": { "rating": 4.5, "reviews": 120 },
      "stock": 15
    }
  ],
  "count": 8
}
```

### Smart Recommendations Response
```json
{
  "success": true,
  "recommendations": [
    {
      "id": "64f1a2b3c4d5e6f7g8h9i0j3",
      "name": "Designer T-Shirt",
      "price": 1999,
      "category": "Clothing",
      "subcategory": "T-Shirts",
      "image": "tshirt.jpg",
      "rating": { "rating": 4.3, "reviews": 89 }
    }
  ],
  "count": 6
}
```

---

## 🔧 Configuration & Customization

### Modify Algorithm Parameters

Edit `/src/controllers/productController.js`:

```javascript
// Change price range tolerance (default ±30%)
const priceMin = currentProduct.price * 0.6; // ±40%
const priceMax = currentProduct.price * 1.4;

// Change keyword extraction
.filter(word => word.length > 4) // Only words longer than 4 chars
.slice(0, 10) // Top 10 keywords instead of 5

// Modify tier limits
const exactMatch = await Product.find({...}).limit(6); // More exact matches
```

### Add New Filtering Options

```javascript
// Add brand filtering
if (req.query.brands) {
  const brandList = req.query.brands.split(',');
  filter.brand = { $in: brandList };
}

// Add price range filtering
if (req.query.minPrice && req.query.maxPrice) {
  filter.price = { 
    $gte: parseFloat(req.query.minPrice),
    $lte: parseFloat(req.query.maxPrice)
  };
}
```

---

## 🎨 UI/UX Best Practices

### Visual Design Tips
- Use **card layouts** for product recommendations
- Show **loading states** during API calls
- Display **"No recommendations"** fallback gracefully
- Add **quick add to cart** buttons on recommendation cards

### Performance Tips
- **Cache recommendations** for 5-10 minutes using localStorage
- **Lazy load** recommendation sections below the fold
- **Preload** related products when user hovers over product cards
- **Implement pagination** for large recommendation sets

### User Experience
- Show **recommendation reasons** ("Because you viewed...", "Popular in this category")
- Add **quick filters** (Price range, Brand, Rating)
- Include **"View All"** links to category pages
- Track **click-through rates** for optimization

---

## 🚀 Deployment Notes

### Environment Variables
```bash
MONGODB_URI=mongodb://localhost:27017/doordripp
PORT=3000
NODE_ENV=production
```

### Production Optimizations
- Add **Redis caching** for frequent recommendations
- Implement **rate limiting** on recommendation endpoints
- Use **MongoDB indexing** on category, price, and rating fields
- Add **CDN caching** for product images

---

## 📈 Analytics & Monitoring

### Track These Metrics
- **Click-through rate** on related products
- **Conversion rate** from recommendations
- **API response times**
- **Cache hit rates**
- **Most popular recommendation categories**

### Logging Examples
```javascript
console.log('📊 Recommendation Analytics:', {
  productId,
  recommendationType: 'related', // or 'smart'
  resultsCount: recommendations.length,
  categories: uniqueCategories,
  responseTime: Date.now() - startTime
});
```

---

## 🔗 Related Files

- **Backend Controller**: `/src/controllers/productController.js`
- **API Routes**: `/src/routes/products.js`
- **Product Model**: `/src/models/Product.js`
- **Test Suite**: `/test-related-products.js`
- **Frontend Examples**: 
  - `/frontend-example-ProductDetail.jsx`
  - `/frontend-example-Cart.jsx`

---

## 💡 Tips & Troubleshooting

### Common Issues

1. **Empty Recommendations**
   - Ensure products have category/subcategory fields populated
   - Check if exclude filters are too restrictive
   - Verify products exist in the database

2. **Slow Performance**
   - Add MongoDB indexes on frequently queried fields
   - Reduce limit parameter for faster queries
   - Implement caching layer

3. **Duplicate Products**
   - Algorithm automatically removes duplicates
   - Check for data inconsistencies in Product model

### Best Practices
- ✅ Always handle loading states in frontend
- ✅ Implement fallback recommendations
- ✅ Cache API responses when possible
- ✅ Monitor recommendation performance
- ✅ A/B test different algorithm parameters

---

**Happy Coding! 🎉**

For questions or improvements, check the Product Controller implementation or create an issue in the repository.