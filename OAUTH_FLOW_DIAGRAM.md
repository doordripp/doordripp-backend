# Google OAuth Enhanced Flow Diagram

## Complete Authentication & Profile Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant Google
    participant ImageKit
    participant MongoDB

    User->>Frontend: Click "Continue with Google"
    Frontend->>Backend: GET /api/auth/google
    Backend->>Google: Redirect to Google OAuth
    Google->>User: Show consent screen
    User->>Google: Grant permissions
    Google->>Backend: Callback with profile data
    
    Note over Backend: Extract profile data:<br/>- name<br/>- email<br/>- photo URL<br/>- gender (if available)<br/>- DOB (if available)<br/>- Google ID
    
    Backend->>ImageKit: Download & upload profile photo
    ImageKit-->>Backend: Return ImageKit URL
    
    Backend->>MongoDB: Check if user exists by email
    
    alt New User
        Backend->>MongoDB: Create user with all data
        Note over MongoDB: User {<br/>  name, email,<br/>  avatar (ImageKit URL),<br/>  googleId, gender, dob,<br/>  emailVerified: true,<br/>  termsAccepted: true<br/>}
    else Existing User
        Backend->>MongoDB: Update missing fields
        Note over MongoDB: Update:<br/>- avatar (if not set)<br/>- emailVerified: true<br/>- gender, dob (if not set)
    end
    
    Backend->>Backend: Generate JWT token
    Backend->>Frontend: Set httpOnly cookie + redirect
    Frontend->>User: Show logged in dashboard
    
    Note over User,MongoDB: User now has:<br/>✓ Name from Google<br/>✓ Verified email<br/>✓ Profile photo in ImageKit<br/>✓ Gender & DOB (if available)<br/>✓ Terms accepted
```

## Profile Photo Upload Flow

```mermaid
flowchart TD
    A[Google Profile Photo URL] --> B{ImageKit Configured?}
    B -->|Yes| C[Download photo via axios]
    B -->|No| D[Use Google URL directly]
    C --> E[Upload to ImageKit]
    E --> F{Upload Success?}
    F -->|Yes| G[Save ImageKit URL to DB]
    F -->|No| H[Log error & use Google URL]
    D --> I[Save Google URL to DB]
    G --> J[Profile photo available via CDN]
    H --> K[Profile photo from Google]
    I --> K

    style G fill:#90EE90
    style J fill:#90EE90
    style H fill:#FFD700
    style K fill:#FFD700
```

## Data Extraction Priority

```mermaid
flowchart LR
    subgraph Google Profile
        G1[displayName]
        G2[emails]
        G3[photos]
        G4[gender]
        G5[birthday]
        G6[id]
    end

    subgraph User Model
        U1[name]
        U2[email]
        U3[avatar]
        U4[gender]
        U5[dob]
        U6[googleId]
        U7[emailVerified]
        U8[termsAccepted]
    end

    G1 -->|Required| U1
    G2 -->|Required| U2
    G3 -->|Upload to ImageKit| U3
    G4 -->|Optional| U4
    G5 -->|Optional| U5
    G6 -->|Required| U6
    U2 --> U7
    U1 --> U8

    style G1 fill:#90EE90
    style G2 fill:#90EE90
    style G3 fill:#87CEEB
    style G4 fill:#FFD700
    style G5 fill:#FFD700
    style G6 fill:#90EE90
```

## Smart Update Logic for Existing Users

```mermaid
flowchart TD
    A[User logs in with Google] --> B{User exists?}
    B -->|No| C[Create new user<br/>with all data]
    B -->|Yes| D{Email verified?}
    
    D -->|No| E[Mark emailVerified = true]
    D -->|Yes| F{Has avatar?}
    
    E --> F
    F -->|No| G[Set ImageKit avatar]
    F -->|Has old Google URL| H[Update to ImageKit]
    F -->|Has custom avatar| I{Has gender?}
    
    G --> I
    H --> I
    I -->|No| J[Set gender from Google]
    I -->|Yes| K{Has DOB?}
    
    J --> K
    K -->|No| L[Set DOB from Google]
    K -->|Yes| M[Save updates]
    
    L --> M
    C --> N[Generate JWT & login]
    M --> N

    style C fill:#90EE90
    style N fill:#87CEEB
```

## File Organization

```
node-backend/
├── src/
│   ├── config/
│   │   └── passport.js ⭐ ENHANCED - Full profile extraction
│   ├── models/
│   │   └── User.js ⭐ ENHANCED - Added googleId field
│   ├── utils/
│   │   └── imagekit-upload.js ✨ NEW - ImageKit utility
│   └── routes/
│       └── auth.js (OAuth routes)
└── package.json ⭐ UPDATED - Added axios
```

## Environment Variables

```env
# Required for OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000//api/auth/google/callback

# Required for ImageKit photo storage
IMAGEKIT_PUBLIC_KEY=public_xxxxx
IMAGEKIT_PRIVATE_KEY=private_xxxxx
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/xxxxx
```

## ImageKit Storage Structure

```
ImageKit Media Library
└── avatars/
    └── google/
        ├── google_123456789_1734567890123.jpg
        ├── google_987654321_1734567890456.jpg
        └── google_555555555_1734567890789.jpg
```

**Naming**: `google_{googleId}_{timestamp}.jpg`

## Testing Checklist

- [ ] User can sign in with Google
- [ ] Name extracted from Google profile
- [ ] Email marked as verified
- [ ] Profile photo uploaded to ImageKit
- [ ] ImageKit URL saved in database
- [ ] Gender extracted (if available)
- [ ] DOB extracted (if available)
- [ ] Google ID stored in database
- [ ] Existing users updated correctly
- [ ] JWT cookie set properly
- [ ] User redirected to frontend

---

**Implementation Date**: December 19, 2025  
**Status**: ✅ Complete and ready for testing
