// Example: Updated ProductDetail.jsx to use new backend related products API

import React, { useState, useEffect } from 'react';
import api from '../config/api'; // Your API instance

const ProductDetail = ({ productId }) => {
  const [product, setProduct] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProductData = async () => {
      try {
        setLoading(true);
        
        // Fetch main product and related products in parallel
        const [productResponse, relatedResponse] = await Promise.all([
          api.get(`/products/${productId}`),
          api.get(`/products/${productId}/related?limit=8`)
        ]);
        
        setProduct(productResponse.data);
        setRelatedProducts(relatedResponse.data.relatedProducts);
        
        console.log('✅ Smart Related Products:', {
          currentProduct: relatedResponse.data.currentProduct,
          recommendations: relatedResponse.data.relatedProducts.length
        });
        
      } catch (error) {
        console.error('Error fetching product data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (productId) {
      fetchProductData();
    }
  }, [productId]);

  return (
    <div className="product-detail">
      {/* Main product display */}
      {product && (
        <div className="product-info">
          <h1>{product.name}</h1>
          <p>₹{product.price}</p>
          <p>{product.description}</p>
          {/* Add to cart, etc. */}
        </div>
      )}

      {/* Smart Related Products Section */}
      {relatedProducts.length > 0 && (
        <section className="related-products mt-16">
          <h2 className="text-2xl font-bold mb-6">You Might Also Like</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {relatedProducts.map((product) => (
              <div key={product.id} className="product-card">
                <img 
                  src={product.image || '/placeholder.jpg'} 
                  alt={product.name}
                  className="w-full h-48 object-cover rounded-lg"
                />
                <h3 className="font-semibold mt-2">{product.name}</h3>
                <p className="text-gray-600">₹{product.price}</p>
                <p className="text-sm text-gray-500">{product.category}</p>
                <button 
                  onClick={() => window.location.href = `/product/${product.id}`}
                  className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  View Product
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading && <div className="text-center py-8">Loading related products...</div>}
    </div>
  );
};

export default ProductDetail;