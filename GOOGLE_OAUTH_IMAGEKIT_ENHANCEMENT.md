# Google OAuth Enhancement - Profile Data & ImageKit Integration

## Overview
Enhanced Google OAuth login flow to extract all available profile information from Google and automatically upload profile photos to ImageKit.

## Changes Made

### 1. New Utility: ImageKit Upload Helper
**File**: `node-backend/src/utils/imagekit-upload.js`

- `uploadFromUrl()`: Downloads image from URL and uploads to ImageKit
- `uploadFromBase64()`: Uploads base64 image data to ImageKit
- `deleteFile()`: Deletes files from ImageKit
- Handles fallback gracefully if ImageKit is not configured

### 2. Updated Passport Google OAuth Strategy
**File**: `node-backend/src/config/passport.js`

#### Extracted Data from Google Profile:
- ✅ **Name**: `profile.displayName`
- ✅ **Email**: `profile.emails[0].value`
- ✅ **Profile Photo**: `profile.photos[0].value` → Uploaded to ImageKit
- ✅ **Gender**: `profile.gender` (if available with gender scope)
- ✅ **Date of Birth**: `profile._json.birthday` (if available with birthday scope)
- ✅ **Google ID**: `profile.id` (stored for future OAuth reference)

#### Workflow:
1. User clicks "Continue with Google"
2. Google redirects to callback with profile data
3. Backend extracts all available profile information
4. Profile photo is downloaded and uploaded to ImageKit under `avatars/google/` folder
5. User is created (if new) or updated (if existing) with all available data
6. Email is automatically marked as verified (Google verified)
7. Terms are auto-accepted for OAuth users

#### Smart Update Logic for Existing Users:
- Updates `avatar` only if user doesn't have one or has old Google URL
- Updates `name` if it's empty or is just email prefix
- Updates `gender` and `dob` only if not already set
- Always marks `emailVerified = true`

### 3. Updated User Model
**File**: `node-backend/src/models/User.js`

Added new field:
```javascript
googleId: { type: String, unique: true, sparse: true }
```

### 4. Dependencies Added
- **axios**: For downloading Google profile photos (`npm install axios`)

## Configuration

### Required Environment Variables
Already configured in your `.env`:
```env
# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

# ImageKit
IMAGEKIT_PUBLIC_KEY=public_eZEGOkMzOtu8aYnlvXf0CGYz5gA=
IMAGEKIT_PRIVATE_KEY=private_o3CNVPdB4gDY8eYuvDPF/hmEpo8=
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/xeuci3es7
```

### Optional: Request Additional Scopes
To get gender and birthday, update the Google OAuth scopes in `node-backend/src/routes/auth.js`:

```javascript
router.get('/google', (req, res, next) => {
  passport.authenticate('google', { 
    scope: [
      'profile', 
      'email',
      'https://www.googleapis.com/auth/user.birthday.read', // For DOB
      'https://www.googleapis.com/auth/user.gender.read'     // For gender
    ] 
  })(req, res, next);
});
```

**Note**: Gender and birthday scopes require additional Google API Console configuration and user consent.

## How It Works

### New User Registration (via Google):
```
User clicks "Continue with Google"
  → Google authentication
  → Extract: name, email, photo, gender, dob
  → Upload photo to ImageKit
  → Create user with all data
  → Set emailVerified = true
  → Auto-accept terms
  → Login user with JWT cookie
```

### Existing User Login (via Google):
```
User clicks "Continue with Google"
  → Google authentication
  → Find existing user by email
  → Update missing fields (avatar, gender, dob)
  → Mark emailVerified = true
  → Login user with JWT cookie
```

## ImageKit Photo Storage

### Storage Structure:
```
/avatars/google/
  ├── google_12345678901234567890_1734567890123.jpg
  ├── google_98765432109876543210_1734567890456.jpg
  └── ...
```

### Naming Convention:
`google_{googleId}_{timestamp}.jpg`

### Benefits:
- ✅ Persistent storage (survives server restarts)
- ✅ CDN delivery (fast image loading)
- ✅ Automatic optimization
- ✅ Unique filenames prevent conflicts
- ✅ Organized by OAuth provider

## Fallback Behavior

### If ImageKit Fails:
- Falls back to original Google photo URL
- Logs error but doesn't break authentication
- User still logs in successfully

### If Google Doesn't Provide Data:
- Only name and email are required
- Gender, DOB, and phone can be collected later via profile completion form

## Testing

### Test Google OAuth Flow:
1. Start backend: `cd node-backend && npm run dev`
2. Start frontend: `cd node-frontend && npm run dev`
3. Navigate to: `http://localhost:5173/login`
4. Click "Continue with Google"
5. Authorize with your Google account
6. Check MongoDB to verify:
   - User created with `emailVerified: true`
   - Avatar URL points to ImageKit
   - Gender and DOB populated (if available)
   - `googleId` stored

### Verify ImageKit Upload:
1. Log in to ImageKit dashboard: https://imagekit.io/dashboard
2. Navigate to Media Library → `avatars/google/`
3. Verify uploaded profile photos appear

## Future Enhancements

### Profile Completion Flow:
If Google doesn't provide phone/gender/DOB, you can add a profile completion step:

1. After OAuth login, check if user is missing data
2. Redirect to `/profile/complete` page
3. Collect missing fields (phone, gender, DOB)
4. Update user record

### Phone Number Collection:
Google doesn't provide phone numbers. Add a step to collect it:
- Show modal/page after first OAuth login
- Send OTP to verify phone
- Update user record with verified phone

## Troubleshooting

### Photos Not Uploading to ImageKit:
- Check `.env` has correct `IMAGEKIT_*` credentials
- Verify ImageKit account is active
- Check backend logs for upload errors
- Photos will fall back to Google URLs if ImageKit fails

### Missing Gender/DOB:
- Default Google OAuth only provides profile + email
- Must request additional scopes (see Configuration section)
- User must grant permission for these scopes
- Not all Google accounts have this data set

### "Email already in use" Error:
- User may have registered with email/password before using OAuth
- Current logic handles this by updating existing user
- Check that `emailVerified` gets set to `true` for OAuth users

## Security Notes

- ✅ JWT tokens use httpOnly cookies (XSS protection)
- ✅ SameSite=None + Secure for cross-origin (HTTPS only in prod)
- ✅ Google email is verified by Google (trusted)
- ✅ Random password generated for OAuth users (they can't login with password)
- ✅ GoogleId stored for future re-authentication
- ⚠️ Ensure HTTPS in production for secure cookies
- ⚠️ Consider rate limiting OAuth endpoints

## API Endpoints

### Initiate Google OAuth:
```
GET /api/auth/google
```

### Google OAuth Callback:
```
GET /api/auth/google/callback
```

### Check Current User:
```
GET /api/auth/me
Headers: Cookie: token=<jwt_token>
```

---

**Implementation Date**: December 19, 2025  
**Modified Files**: 
- `src/config/passport.js`
- `src/models/User.js`
- `src/utils/imagekit-upload.js` (new)
- `package.json` (added axios)
