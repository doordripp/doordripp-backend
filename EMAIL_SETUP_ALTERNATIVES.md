# Alternative Email Configuration for Testing

## Option 1: Activate Brevo (Recommended for Production)
Your Brevo account needs activation. 
- Visit: https://app.brevo.com
- Check verification email
- Contact: contact@sendinblue.com

## Option 2: Use Gmail SMTP (Quick Testing)
Replace the SMTP configuration in .env with:

```env
# Gmail SMTP (for testing only)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-app-password

# Generate App Password:
# 1. Go to https://myaccount.google.com/security
# 2. Enable 2-Factor Authentication
# 3. Go to App Passwords: https://myaccount.google.com/apppasswords
# 4. Create new app password for "Mail"
# 5. Use that password (NOT your Gmail password)
```

## Option 3: Console Mode (Development Only)
The system will automatically fall back to console logging if SMTP is not configured.
OTPs will be printed in the server console.

To use console mode, temporarily comment out SMTP config:
```env
# SMTP_HOST=smtp-relay.brevo.com
# SMTP_PORT=587
# SMTP_USER=9ccbf8001@smtp-brevo.com
# SMTP_PASS=xsmtpsib-67b0893bbb664da3019c0a0fe0a777fbd20617b704e20c4c7eba2c1d82777a31-5ybYTm8fbP6xqeai
```

Then check terminal logs after registration to see the OTP code.
