// Example: Updated Cart.jsx to use new smart recommendations API

import React, { useState, useEffect } from 'react';
import api from '../config/api'; // Your API instance

const Cart = ({ cartItems }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSmartRecommendations = async () => {
      if (cartItems.length === 0) return;
      
      try {
        setLoading(true);
        
        // Get categories and subcategories from cart items
        const categories = [...new Set(cartItems.map(item => item.category))];
        const subcategories = [...new Set(cartItems.map(item => item.subcategory).filter(Boolean))];
        const excludeIds = cartItems.map(item => item.id);
        
        console.log('🛒 Cart Analysis:', { categories, subcategories, excludeIds });
        
        const response = await api.get('/products/recommendations/smart', {
          params: {
            categories: categories.join(','),
            subcategories: subcategories.join(','),
            excludeIds: excludeIds.join(','),
            limit: 6
          }
        });
        
        console.log('✅ Smart Cart Recommendations:', response.data);
        setRecommendations(response.data.recommendations);
        
      } catch (error) {
        console.error('Error fetching cart recommendations:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSmartRecommendations();
  }, [cartItems]);

  const calculateTotal = () => {
    return cartItems.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  return (
    <div className="cart-page">
      <h1 className="text-3xl font-bold mb-8">Shopping Cart</h1>
      
      {/* Cart Items */}
      <div className="cart-items mb-12">
        {cartItems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Your cart is empty</p>
          </div>
        ) : (
          <>
            {cartItems.map((item) => (
              <div key={item.id} className="cart-item flex items-center gap-4 p-4 border-b">
                <img 
                  src={item.image || '/placeholder.jpg'}
                  alt={item.name}
                  className="w-16 h-16 object-cover rounded"
                />
                <div className="flex-1">
                  <h3 className="font-semibold">{item.name}</h3>
                  <p className="text-gray-600">₹{item.price} × {item.quantity}</p>
                </div>
                <p className="font-bold">₹{item.price * item.quantity}</p>
              </div>
            ))}
            
            <div className="cart-summary mt-6 text-right">
              <h3 className="text-xl font-bold">Total: ₹{calculateTotal()}</h3>
              <button className="bg-green-500 text-white px-6 py-3 rounded mt-4 hover:bg-green-600">
                Proceed to Checkout
              </button>
            </div>
          </>
        )}
      </div>

      {/* Smart Cart Recommendations */}
      {cartItems.length > 0 && recommendations.length > 0 && (
        <section className="cart-recommendations">
          <h2 className="text-2xl font-bold mb-6">Complete Your Look</h2>
          <p className="text-gray-600 mb-4">
            Based on your cart items, you might also like these products:
          </p>
          
          {loading ? (
            <div className="text-center py-8">Loading recommendations...</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {recommendations.map((product) => (
                <div key={product.id} className="recommendation-card">
                  <img 
                    src={product.image || '/placeholder.jpg'}
                    alt={product.name}
                    className="w-full h-32 object-cover rounded-lg"
                  />
                  <h3 className="font-semibold mt-2 text-sm">{product.name}</h3>
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-gray-600 text-sm">₹{product.price}</p>
                    <button 
                      onClick={() => addToCart(product)}
                      className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Fallback Recommendations for Empty Cart */}
      {cartItems.length === 0 && (
        <EmptyCartRecommendations />
      )}
    </div>
  );
};

// Component for showing popular products when cart is empty
const EmptyCartRecommendations = () => {
  const [popularProducts, setPopularProducts] = useState([]);

  useEffect(() => {
    const fetchPopularProducts = async () => {
      try {
        const response = await api.get('/products/recommendations/smart?limit=8');
        setPopularProducts(response.data.recommendations);
      } catch (error) {
        console.error('Error fetching popular products:', error);
      }
    };

    fetchPopularProducts();
  }, []);

  if (popularProducts.length === 0) return null;

  return (
    <section className="empty-cart-recommendations">
      <h2 className="text-2xl font-bold mb-6">Popular Products</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {popularProducts.map((product) => (
          <div key={product.id} className="product-card">
            <img 
              src={product.image || '/placeholder.jpg'}
              alt={product.name}
              className="w-full h-48 object-cover rounded-lg"
            />
            <h3 className="font-semibold mt-2">{product.name}</h3>
            <p className="text-gray-600">₹{product.price}</p>
            <button 
              onClick={() => window.location.href = `/product/${product.id}`}
              className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 w-full"
            >
              View Product
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

export default Cart;