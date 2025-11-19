// Lightweight product dataset copied from frontend to support API during integration
const NEW_ARRIVALS = [
  {
    id: 'na-1',
    name: 'T-shirt with Tape Details',
    image: '/assets/image7.png',
    price: 120,
    originalPrice: null,
    discount: null,
    rating: { rating: 4.5, reviews: 451, stars: [1,1,1,1,0] },
    category: 'T-Shirts',
    isNew: true
  },
  {
    id: 'na-2',
    name: 'Skinny Fit Jeans',
    image: '/assets/image8.png',
    price: 240,
    originalPrice: 260,
    discount: 20,
    rating: { rating: 3.5, reviews: 3143, stars: [1,1,1,0,0] },
    category: 'Jeans',
    isNew: true
  },
  {
    id: 'na-3',
    name: 'Checkered Shirt',
    image: '/assets/image9.png',
    price: 180,
    originalPrice: null,
    discount: null,
    rating: { rating: 4.5, reviews: 143, stars: [1,1,1,1,0] },
    category: 'Shirts',
    isNew: true
  },
  {
    id: 'na-4',
    name: 'Sleeve Striped T-shirt',
    image: '/assets/image10.png',
    price: 130,
    originalPrice: 160,
    discount: 30,
    rating: { rating: 4.5, reviews: 417, stars: [1,1,1,1,0] },
    category: 'T-Shirts',
    isNew: true
  }
]

const TOP_SELLING = [
  {
    id: 'ts-1',
    name: 'Vertical Striped Shirt',
    image: '/assets/image11.png',
    price: 212,
    originalPrice: 232,
    discount: 20,
    rating: { rating: 5.0, reviews: 2143, stars: [1,1,1,1,1] },
    category: 'Shirts',
    isTopSelling: true
  },
  {
    id: 'ts-2',
    name: 'Courage Graphic T-shirt',
    image: '/assets/image12.png',
    price: 145,
    originalPrice: null,
    discount: null,
    rating: { rating: 4.0, reviews: 1043, stars: [1,1,1,1,0] },
    category: 'T-Shirts',
    isTopSelling: true
  },
  {
    id: 'ts-3',
    name: 'Loose Fit Bermuda Shorts',
    image: '/assets/image8-1.png',
    price: 80,
    originalPrice: null,
    discount: null,
    rating: { rating: 3.0, reviews: 234, stars: [1,1,1,0,0] },
    category: 'Shorts',
    isTopSelling: true
  },
  {
    id: 'ts-4',
    name: 'Faded Skinny Jeans',
    image: '/assets/image7-1.png',
    price: 210,
    originalPrice: null,
    discount: null,
    rating: { rating: 4.5, reviews: 567, stars: [1,1,1,1,0] },
    category: 'Jeans',
    isTopSelling: true
  }
]

const ALL_PRODUCTS = [...NEW_ARRIVALS, ...TOP_SELLING]

const CATEGORIES = ['T-Shirts','Jeans','Shirts','Shorts']

module.exports = { NEW_ARRIVALS, TOP_SELLING, ALL_PRODUCTS, CATEGORIES }
