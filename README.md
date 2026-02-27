# Doordripp Backend 🚀

Node.js + Express backend for Doordripp e-commerce platform. Built with MongoDB, JWT authentication, Google OAuth, and Razorpay payment integration.

## ✨ Features

- 🔐 **JWT Authentication** - Secure token-based auth with httpOnly cookies
- 🔑 **Google OAuth 2.0** - Social login integration
- 🛒 **Shopping Cart** - Full cart management with MongoDB
- 📦 **Order Management** - Complete order processing system
- 💳 **Razorpay Integration** - Payment gateway support
- 🖼️ **ImageKit CDN** - Cloud image storage and optimization
- 👤 **User Management** - Profile, authentication, and role-based access
- 📱 **Product Collections** - New Arrivals, Top Selling, Featured products
- 🛡️ **Admin Panel API** - Complete admin management endpoints

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed
- MongoDB database (we use MongoDB Atlas - shared cluster included)
- Git installed

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/doordripp/doordripp-backend.git
cd doordripp-backend/node-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment Setup**

The `.env.example` file is already configured with working credentials for development:

```bash
# Copy the example file (already has working credentials)
cp .env.example .env
```

**⚠️ IMPORTANT:** The `.env.example` includes real credentials for:
- ✅ **Shared MongoDB Atlas database** - Ready to use
- ✅ **ImageKit credentials** - For image uploads
- ✅ **Google OAuth credentials** - For social login

**No additional configuration needed for development!** Just copy and run.

4. **Start the server**
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

Server will start on **http://localhost:4000/**

5. **Create Admin User (Optional)**
```bash
npm run create-admin
```

## 📁 Project Structure

```
node-backend/
├── src/
│   ├── config/          # Database, Passport, Auth configs
│   ├── controllers/     # Route handlers (Auth, Products, Orders, Cart, Admin)
│   ├── models/          # MongoDB Mongoose models
│   ├── routes/          # API route definitions
│   ├── middleware/      # Authentication & authorization
│   └── utils/           # Razorpay, helpers
├── scripts/             # Utility scripts (seed data, create admin)
└── .env.example         # Environment variables with REAL credentials
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (email/phone + password)
- `GET /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `GET /api/auth/google` - Google OAuth login
- `GET /api/auth/google/callback` - Google OAuth callback

### Products
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get single product
- `GET /api/products/frontend/data` - Get products with collection flags

### Cart
- `GET /api/cart` - Get user cart
- `POST /api/cart/add` - Add item to cart
- `POST /api/cart/remove` - Remove item from cart
- `POST /api/cart/checkout` - Checkout cart

### Orders
- `GET /api/orders` - Get user orders
- `GET /api/orders/:id` - Get single order
- `POST /api/orders` - Create order

### Admin (Protected Routes)
- `GET /api/admin/users` - Get all users
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `DELETE /api/admin/products/:id` - Delete product
- `GET /api/admin/orders` - Get all orders
- `PUT /api/admin/orders/:id` - Update order status

## 🗄️ Database

**MongoDB Atlas** cluster is already configured in `.env.example`:
- **Connection String:** `mongodb+srv://tyagi729:Tyagi123@cluster0.gri9xvc.mongodb.net/doordripp`
- **Database Name:** `doordripp`
- **Shared Access:** All team members can use this database

### Collections
- `users` - User accounts and authentication
- `products` - Product catalog with collection flags
- `orders` - Order history and status
- `carts` - Shopping cart data
- `otps` - OTP verification tokens

## 🔑 Environment Variables

All credentials are **pre-configured** in `.env.example`:

```env
# MongoDB (Shared Atlas Cluster)
MONGO_URI=mongodb+srv://tyagi729:Tyagi123@cluster0.gri9xvc.mongodb.net/doordripp

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-here

# Server URLs
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:4000/

# ImageKit (Cloud Image Storage)
IMAGEKIT_PUBLIC_KEY=public_eZEGOkMzOtu8aYnlvXf0CGYz5gA=
IMAGEKIT_PRIVATE_KEY=private_o3CNVPdB4gDY8eYuvDPF/hmEpo8=
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/xeuci3es7

# Google OAuth
GOOGLE_CLIENT_ID=435840667821-ibluemm3j9cvlaj3pslt2pgj8aklms7n.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
GOOGLE_CALLBACK_URL=http://localhost:4000//api/auth/google/callback
```

## 🛠️ Scripts

```bash
npm run dev          # Start development server with nodemon
npm start            # Start production server
npm run seed         # Seed MongoDB with sample products
npm run create-admin # Create admin user
```

## 🔒 Authentication Flow

1. **JWT Tokens:** Stored in httpOnly cookies (`token`)
2. **Auto-refresh:** Tokens refresh automatically on valid requests
3. **Google OAuth:** Redirect-based flow with Passport.js
4. **Role-based:** Admin routes protected with middleware

## 💳 Payment Integration

**Razorpay** is configured for payments:
- Checkout creates Razorpay order
- Frontend handles payment UI
- Backend verifies payment signatures

## 📸 Image Storage

**ImageKit** CDN is used for product images:
- Public Key: `public_eZEGOkMzOtu8aYnlvXf0CGYz5gA=`
- Upload endpoint: `/api/imagekit/auth`
- Admin can upload images directly from admin panel

## 🚦 Testing

```bash
# Test MongoDB connection
node -e "require('./src/config/db.js')"

# Test server health
curl http://localhost:4000//api/health
```

## 📝 Notes

- ✅ MongoDB credentials are **shared** for team development
- ✅ Google OAuth works immediately (credentials included)
- ✅ ImageKit uploads work out of the box
- ⚠️ For production, rotate all secrets and use environment-specific configs
- ⚠️ Add rate limiting for production deployment
- ⚠️ Never commit real `.env` file to GitHub (only `.env.example`)

## 🔗 Related Repositories

- **Frontend:** [doordripp-frontend](https://github.com/doordripp/doordripp-frontend)

## 📄 License

Private - Doordripp Team

---

**Made with ❤️ by Doordripp Team**

API endpoints (initial):
- `POST /api/auth/register` — register user
- `POST /api/auth/login` — login user (returns JWT)
- `GET /api/products` — list products
- `POST /api/products` — create product (admin)
- `POST /api/orders` — create order (creates Razorpay order id payload)

Next steps: seed admin, add more validations, webhooks, file uploads, and admin dashboards.
