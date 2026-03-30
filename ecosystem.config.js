module.exports = {
  apps: [
    {
      name: 'doordripp-backend',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,

        // MongoDB
        MONGO_URI: 'mongodb://tyagi729:Tyagi123@ac-dnryibb-shard-00-00.gri9xvc.mongodb.net:27017,ac-dnryibb-shard-00-01.gri9xvc.mongodb.net:27017,ac-dnryibb-shard-00-02.gri9xvc.mongodb.net:27017/doordripp?ssl=true&replicaSet=atlas-99gm6c-shard-0&authSource=admin&retryWrites=true&w=majority',

        // JWT
        JWT_SECRET: 'Doordripp-jwt-secret-key-09012004',

        // URLs — VPS (same domain, Nginx reverse-proxy)
        FRONTEND_URL: 'https://doordripp.com',
        BACKEND_URL: 'https://doordripp.com',
        CLIENT_URL: 'https://doordripp.com',

        // ImageKit
        IMAGEKIT_PUBLIC_KEY: 'public_eZEGOkMzOtu8aYnlvXf0CGYz5gA=',
        IMAGEKIT_PRIVATE_KEY: 'private_o3CNVPdB4gDY8eYuvDPF/hmEpo8=',
        IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/xeuci3es7',

        // Google OAuth — Production
        GOOGLE_CLIENT_ID: '1000596440300-uh6fghi944507fmnbbm80jva2tuh18j3.apps.googleusercontent.com',
        GOOGLE_APP_CLIENT_ID_1: '72023349261-71l2pk4f8vptk9vgpll8iutjql0qj9ia.apps.googleusercontent.com',
        GOOGLE_APP_CLIENT_ID_2: '1000596440300-qpmt33mqedhlgsk435dov0o2g95hn8h9.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: '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',
        GOOGLE_CALLBACK_URL: 'https://doordripp.com/api/auth/google/callback',

        // Email / SMTP (Brevo)
        SMTP_HOST: 'smtp-relay.brevo.com',
        SMTP_PORT: '587',
        SMTP_USER: '9de917001@smtp-brevo.com',
        SMTP_PASS: 'xsmtpsib-cdee3884974519f2b0ca5f498738c226d55372734561239d92bd7e9a346ff810-keyZRld06ZNEZmfY',
        MAIL_FROM: 'noreply@doordripp.com',
        MAIL_FROM_NAME: 'DoorDripp',
        SUPPORT_EMAIL: 'support@doordripp.com',

        // Google Maps
        GOOGLE_MAPS_API_KEY: 'AIzaSyBAGxNYAFAyr04thViy41r76wWbHj9MXUg',

        // Razorpay (test keys)
        RAZORPAY_KEY_ID: 'rzp_test_Ru0cFoiSrCqVj7',
        RAZORPAY_KEY_SECRET: 'jJ0Up6FBAuwpQtG1uNykmnkA',
        RAZORPAY_WEBHOOK_SECRET: 'whsec_test_razorpay_webhook_secret',
        RAZORPAY_TEST_MODE_SKIP_VERIFICATION: 'true',

        // Security
        DISABLE_RATE_LIMIT: 'false',

        // Company Details
        COMPANY_NAME: 'DoorDripp',
        COMPANY_GSTIN: '09AAMCD3799E1Z5',
        COMPANY_STATE_CODE: '09',
        COMPANY_EMAIL: 'support@doordripp.com',
        COMPANY_PHONE: '+91-9286819663',
        COMPANY_ADDRESS_LINE1: 'LandCraft Metro Homes',
        COMPANY_ADDRESS_LINE2: 'Muradanagar, Ghaziabad',
        COMPANY_CITY: 'Ghaziabad',
        COMPANY_STATE: 'Uttar Pradesh',
        COMPANY_COUNTRY: 'India',
        COMPANY_PINCODE: '201206',
      },
    },
  ],
};
