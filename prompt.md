# Sparkline — Master Development Prompt

## 1. PROJECT OVERVIEW

Build a modern communication platform called **Sparkline**.

Sparkline should allow people to:

- Chat instantly
- Create/join conversations using a unique code
- Make high-quality audio calls
- Make high-quality video calls
- Share files and media
- Send voice messages
- Create group conversations
- Use the platform without mandatory email/password registration
- Work smoothly on mobile, tablet, laptop, and desktop
- Install Sparkline as an app from the website
- Automatically detect the device and provide the best possible interface

The final product should feel like a polished combination of a modern messaging app, calling application, and lightweight social communication platform.

---

# 2. IMPORTANT PRODUCT PRINCIPLE

Do **not** create a complicated traditional registration flow.

Instead, make the primary onboarding system:

**Enter Sparkline → Create Your Code / Enter Someone's Code → Connect → Start Chatting**

Every user should receive a unique Sparkline ID/code.

Example:

`SPK-7X4K9Q`

A user can share this code with another person.

The other person enters the code and can request/connect with that user.

For privacy, do not expose unnecessary personal information before a connection is accepted.

---

# 3. BRAND

## Name

**Sparkline**

## Suggested tagline

**Connect instantly. Talk freely.**

Alternative:

**One code. One connection.**

## Visual style

Create a premium modern interface:

- Minimal
- Fast
- Clean
- Friendly
- Modern
- Responsive
- Slightly futuristic
- Smooth animations
- Excellent dark mode
- Excellent light mode

Avoid excessive gradients, unnecessary animations, or clutter.

---

# 4. PLATFORM SUPPORT

Sparkline must work on:

- Android
- iPhone/iPad
- Windows
- macOS
- Linux
- Chrome
- Edge
- Firefox
- Safari

Build it as:

1. Responsive website
2. Progressive Web App (PWA)
3. Installable mobile experience
4. Desktop-friendly web application

The interface should automatically adapt to:

- Screen size
- Touch input
- Mouse input
- Keyboard
- Orientation

---

# 5. HOME PAGE

Create a beautiful landing page.

Sections:

### Hero

Display:

**Connect instantly. Talk freely.**

Buttons:

- Start Sparkline
- Enter a Code
- Download App

Show a visual preview of:

- Chat
- Voice call
- Video call
- Connections

### Features

Show:

- Instant messaging
- Audio calling
- Video calling
- Code-based connections
- File sharing
- Voice messages
- Group chats
- Notifications
- Cross-device support
- Dark mode
- PWA installation

### How It Works

Step 1:

**Create your Sparkline code**

Step 2:

**Share your code**

Step 3:

**Connect**

Step 4:

**Chat or call**

### Download section

Automatically detect the user's device.

For Android:

**Install Sparkline**

For iPhone:

**Add Sparkline to Home Screen**

For desktop:

**Install Sparkline**

If the browser does not support installation:

**Open Sparkline in Browser**

---

# 6. ONBOARDING

Create an extremely simple onboarding system.

Screen 1:

**Welcome to Sparkline**

Button:

`Continue`

Screen 2:

Ask for:

- Display name
- Optional profile picture
- Optional status

Then generate a unique Sparkline code.

Example:

`SPK-A82K7P`

Display:

> Your Sparkline Code

Buttons:

- Copy Code
- Share Code
- Continue

Do not force users to provide unnecessary personal information.

---

# 7. CODE CONNECTION SYSTEM

Users should be able to connect using codes.

Create:

### My Code

Example:

`SPK-A82K7P`

Buttons:

- Copy
- Share
- QR Code

### Connect With Someone

Input:

`Enter Sparkline Code`

Button:

`Connect`

After entering a valid code:

Show limited profile information:

- Name
- Profile picture
- Status

Button:

`Send Connection Request`

The recipient receives:

> Someone wants to connect with you.

Buttons:

- Accept
- Decline

After acceptance:

The conversation becomes available.

---

# 8. QR CODE

Every Sparkline code should optionally have a QR representation.

Users can:

- Display QR
- Scan QR
- Share QR

Scanning a Sparkline QR should open the connection flow.

---

# 9. CHAT SYSTEM

Create a fast real-time messaging interface.

Features:

- One-to-one chat
- Group chat
- Text messages
- Emoji
- GIF support if an appropriate service is configured
- Stickers
- Voice messages
- Images
- Videos
- Documents
- File sharing
- Reply to message
- Forward message
- Edit message
- Delete message
- Copy message
- Message reactions
- Pin message
- Search messages

Message states:

- Sending
- Sent
- Delivered
- Read

Show timestamps cleanly.

---

# 10. CHAT UI

Desktop:

Left sidebar:

- Search
- Chats
- Connections
- Calls
- Settings

Middle:

- Conversation list

Right/main area:

- Active conversation

Mobile:

Use a mobile-first navigation structure.

Bottom navigation:

- Chats
- Calls
- Connections
- Profile

The chat interface should feel extremely fast.

Avoid unnecessary page reloads.

---

# 11. REAL-TIME CHAT

Use a proper real-time communication architecture.

Messages should appear immediately without manually refreshing.

Handle:

- Connection state
- Reconnection
- Offline mode
- Message queue
- Failed messages
- Duplicate messages
- Delivery state
- Read state

If the connection temporarily disappears, automatically reconnect.

---

# 12. AUDIO CALLING

Implement real-time audio calling.

Features:

- Start call
- Accept call
- Reject call
- End call
- Mute microphone
- Speaker control
- Call duration
- Incoming call screen
- Outgoing call screen
- Missed call notification
- Reconnect handling

Use browser/device-supported real-time communication technology such as **WebRTC** where appropriate.

Do not fake calling functionality.

---

# 13. VIDEO CALLING

Create high-quality real-time video calling.

Features:

- Camera on/off
- Microphone on/off
- Speaker controls
- Switch camera on supported devices
- Fullscreen
- Picture-in-picture where supported
- Connection quality indicator
- Call duration
- End call
- Reconnection
- Incoming video-call screen

Support:

- 1-to-1 video calls
- Small group calls if infrastructure supports it

Prioritize:

- Low latency
- Stable connection
- Adaptive video quality
- Mobile performance

Automatically reduce video quality when bandwidth becomes poor.

---

# 14. CALL QUALITY SYSTEM

Build adaptive communication.

Monitor:

- Network quality
- Packet loss
- Latency
- Connection state
- Available bandwidth

Automatically adjust:

- Video resolution
- Frame rate
- Bitrate

If the network becomes weak:

1. Reduce video quality
2. Preserve audio quality
3. Attempt reconnection
4. Display a simple connection indicator

Do not crash the application because of temporary network problems.

---

# 15. GROUP CHAT

Allow users to create groups.

Group features:

- Group name
- Group picture
- Group description
- Add members
- Remove members
- Leave group
- Admin roles
- Group permissions
- Group messages
- Group media
- Group calls where supported

Generate a group invitation code.

Example:

`SPK-GROUP-82K7`

---

# 16. FILE SHARING

Allow users to share:

- Images
- Videos
- PDFs
- Documents
- Audio
- Other supported files

Show:

- Upload progress
- File size
- File type
- Download/open action

Do not load huge files entirely into memory.

Use streaming/chunked uploads where appropriate.

---

# 17. VOICE MESSAGES

Create voice messaging.

Features:

- Record
- Pause
- Cancel
- Send
- Playback
- Playback speed
- Waveform visualization

Make it work well on mobile devices.

---

# 18. NOTIFICATIONS

Create notification support for:

- New messages
- Connection requests
- Incoming calls
- Missed calls
- Group activity

Use browser/PWA push notifications where supported.

Respect notification permissions.

Never repeatedly ask for permission.

---

# 19. PRESENCE

Show:

- Online
- Away
- Offline
- Last active

Presence should be efficient and privacy-conscious.

Do not constantly send unnecessary network requests.

---

# 20. TYPING INDICATOR

Show:

`Someone is typing...`

But optimize it so typing events are throttled/debounced.

Never send a network event for every keystroke.

---

# 21. SEARCH

Create global search.

Search:

- People
- Sparkline codes
- Chats
- Groups
- Messages
- Shared files

Make search fast.

---

# 22. PROFILE

Profile should contain:

- Profile picture
- Display name
- Sparkline code
- Status
- About
- Connected people

Buttons:

- Copy code
- Share code
- Generate QR
- Edit profile

---

# 23. PRIVACY SETTINGS

Add privacy controls.

Options:

- Who can send connection requests
- Who can call me
- Who can see my online status
- Who can see last active
- Who can add me to groups
- Read receipts
- Typing indicator
- Profile visibility

---

# 24. BLOCK AND REPORT

Users should be able to:

- Block
- Unblock
- Report
- Remove connection

Blocked users must not be able to initiate normal communication with the blocker.

---

# 25. SETTINGS

Create a complete settings system.

Sections:

### Account

- Profile
- Sparkline code

### Appearance

- Light
- Dark
- System

### Notifications

- Messages
- Calls
- Connections
- Groups

### Privacy

- Online status
- Read receipts
- Calls
- Connection requests

### Storage

- Media
- Downloads
- Cache

### Accessibility

- Text size
- Reduced motion
- High contrast where supported

### About

- Version
- Terms
- Privacy
- Help

---

# 26. DARK MODE

Dark mode should be designed properly rather than simply inverting colors.

Use:

- Dark backgrounds
- High readability
- Clear message bubbles
- Accessible contrast
- Comfortable borders
- Consistent icons

Remember the user's theme preference.

---

# 27. PERFORMANCE

Performance is a major requirement.

Optimize:

- Initial loading
- JavaScript bundles
- Images
- Video
- Chat rendering
- Network requests
- Database queries
- Caching

Use:

- Lazy loading
- Code splitting
- Virtualized message lists
- Optimized images
- Service worker caching
- Efficient state management

The app should remain responsive even with large conversations.

---

# 28. OFFLINE SUPPORT

Create graceful offline behavior.

When offline:

- Show offline indicator
- Preserve unsent messages locally
- Allow viewing cached conversations where possible
- Queue messages
- Automatically retry when connection returns

Do not falsely show messages as delivered while offline.

---

# 29. SECURITY

Security must be considered throughout the architecture.

Implement:

- Secure authentication/session handling
- Authorization
- Input validation
- Rate limiting
- Abuse protection
- Secure file handling
- Secure WebRTC signaling
- Protection against unauthorized access
- Server-side permission checks
- Safe error handling
- HTTPS

Never trust client-side authorization.

Never store sensitive credentials in plain text.

Never expose private database credentials in frontend code.

---

# 30. DATABASE DESIGN

Create a scalable database structure.

Suggested entities:

### users

- id
- sparklineCode
- displayName
- avatar
- status
- about
- createdAt
- updatedAt

### connections

- id
- requesterId
- recipientId
- status
- createdAt

### conversations

- id
- type
- createdAt
- updatedAt

### conversationMembers

- conversationId
- userId
- role
- joinedAt

### messages

- id
- conversationId
- senderId
- type
- content
- attachmentUrl
- replyTo
- createdAt
- updatedAt
- deletedAt

### calls

- id
- conversationId
- callerId
- callType
- status
- startedAt
- endedAt

### notifications

- id
- userId
- type
- data
- read
- createdAt

---

# 31. REAL-TIME ARCHITECTURE

Design the system around real-time events.

Examples:

`message:new`

`message:delivered`

`message:read`

`typing:start`

`typing:stop`

`presence:update`

`call:incoming`

`call:accepted`

`call:rejected`

`call:ended`

`connection:request`

`connection:accepted`

Use appropriate real-time infrastructure rather than repeatedly polling the server.

---

# 32. WEBRTC ARCHITECTURE

For calls, use a production-ready WebRTC architecture.

Include:

- Signaling
- ICE
- STUN
- TURN where required
- Connection negotiation
- Reconnection
- Device selection
- Media permissions
- Network adaptation

Do not assume peer-to-peer connections will always work directly.

Use TURN infrastructure when NAT/firewall conditions require it.

---

# 33. DEVICE PERMISSIONS

Request permissions only when necessary.

Examples:

Camera:

Only request when starting a video call.

Microphone:

Only request when starting an audio/video call or recording a voice message.

Notifications:

Request when notification functionality becomes relevant.

Explain why permission is needed.

---

# 34. RESPONSIVE DESIGN

Create breakpoints for:

- Small phones
- Large phones
- Tablets
- Small laptops
- Desktop
- Large desktop

Never allow:

- Horizontal overflow
- Broken buttons
- Tiny touch targets
- Text overlapping
- Unusable call controls

Use touch-friendly controls.

---

# 35. ACCESSIBILITY

Support:

- Keyboard navigation
- Screen readers
- Focus states
- ARIA labels
- Sufficient contrast
- Reduced motion
- Accessible form labels

All important actions must be usable without a mouse.

---

# 36. INSTALLABLE APP

Create a proper PWA.

Include:

- Web app manifest
- Service worker
- App icons
- Splash/loading experience
- Offline caching strategy
- Install prompt

Detect installation status.

If already installed:

Do not repeatedly show installation prompts.

---

# 37. DOWNLOAD EXPERIENCE

The website should have a dedicated:

**Download Sparkline**

page.

Automatically determine platform.

Show the appropriate option:

### Android

Install PWA / Android application when an official package exists.

### iPhone

Provide installation instructions for supported PWA installation.

### Desktop

Provide PWA installation.

Do not provide fake download buttons.

Every download/install action must actually work.

---

# 38. ADMIN DASHBOARD

Create a protected admin panel.

Admin features:

- User management
- Reports
- Blocked users
- Connection statistics
- Message statistics
- Call statistics
- Storage usage
- System health
- Abuse reports
- Moderation tools
- Feature configuration

Never expose admin routes or privileges to ordinary users.

---

# 39. ANALYTICS

Create privacy-conscious analytics.

Track useful aggregate metrics such as:

- Active users
- New connections
- Messages sent
- Calls started
- Call success rate
- Average call duration
- Errors
- Performance metrics

Avoid collecting unnecessary personal data.

---

# 40. ERROR HANDLING

Every major operation needs useful error handling.

Examples:

Invalid code:

> Sparkline code not found.

Connection failed:

> Unable to connect right now. Please try again.

Call failed:

> The call could not connect. Check your network and try again.

File upload failed:

> Upload failed. Try again.

Never show raw stack traces to users.

Log technical errors safely for developers/admins.

---

# 41. LOADING EXPERIENCE

Use:

- Skeleton screens
- Lightweight loaders
- Optimistic UI where safe
- Smooth transitions

Avoid full-screen spinners for every small action.

---

# 42. UI COMPONENTS

Create a reusable component system.

Components should include:

- Button
- Input
- Modal
- Drawer
- Avatar
- Badge
- Toast
- Dropdown
- Tabs
- Message bubble
- Chat list
- Call controls
- Video tiles
- File attachment
- Audio player
- Search bar
- Connection card
- Notification item

Keep styling consistent.

---

# 43. ANIMATIONS

Use subtle animations for:

- Page transitions
- Message appearance
- Connection requests
- Call transitions
- Modal opening
- Navigation

Animations must never interfere with usability.

Respect:

`prefers-reduced-motion`

---

# 44. MOBILE NAVIGATION

On mobile use a bottom navigation bar.

Suggested:

**Chats | Calls | Connections | Profile**

Keep call controls easily reachable.

During calls, use a dedicated immersive call interface.

---

# 45. DESKTOP NAVIGATION

Desktop can use:

Sidebar:

- Chats
- Calls
- Connections
- Groups
- Settings

Keep the main conversation area large.

---

# 46. SECURITY AGAINST ABUSE

Build protections against:

- Spam
- Connection-request flooding
- Message flooding
- Automated abuse
- Malicious uploads
- Fake accounts
- Call spam

Implement rate limits and moderation controls.

---

# 47. SCALABILITY

Do not build the architecture only for a small demo.

Structure it so it can later support:

- Thousands of users
- Large message volumes
- Large groups
- Multiple real-time servers
- Object storage
- CDN
- Horizontal scaling

Keep infrastructure replaceable.

---

# 48. SEO

The public landing pages should be SEO-friendly.

Add:

- Title
- Description
- Open Graph metadata
- Twitter/X metadata
- Canonical URL
- Structured metadata where useful
- Sitemap
- Robots configuration

The private chat application itself does not need to expose private content to search engines.

---

# 49. PWA + APP ARCHITECTURE

Structure the project so the same core application can support:

**Web**

**PWA**

**Mobile wrapper/native app if later required**

Avoid tightly coupling platform-specific functionality into the entire codebase.

Create reusable services for:

- Authentication
- Messaging
- Calls
- Notifications
- Storage
- User profile
- Connections

---

# 50. AUTOMATIC DEVICE DETECTION

On the landing/download page:

Detect:

- Android
- iOS
- Windows
- macOS
- Linux
- Browser

Then dynamically show the correct installation experience.

Do not make incorrect assumptions based only on user-agent strings where better browser APIs are available.

---

# 51. SMART FEATURES TO ADD YOURSELF

Add useful features beyond the basic requirements.

Potential features:

### Message pinning

Pin important messages.

### Saved messages

Users can save messages for later.

### Chat folders

Organize conversations.

### Unread counter

Display unread messages.

### Reply preview

Show referenced messages.

### Link previews

Generate safe previews for supported URLs.

### Media gallery

View shared media in one place.

### Call history

Show previous calls.

### Contact QR

Quickly connect by scanning.

### Disappearing messages

Optional configurable message expiration.

### Chat mute

Mute noisy conversations.

### Archive

Archive conversations without deleting them.

### Drafts

Save unfinished messages.

### Multi-device sessions

Allow the same account/profile to work across supported devices securely.

---

# 52. NO FAKE FEATURES

This is extremely important.

Do not create UI buttons that only look functional.

If a feature is displayed:

- Implement it properly
- Connect it to the backend
- Handle errors
- Test it

If a service cannot be implemented in the current environment, clearly separate it as a future integration rather than pretending it works.

---

# 53. DEVELOPMENT WORKFLOW

Build the project in phases.

## Phase 1

Create:

- Landing page
- Branding
- Responsive UI
- PWA foundation

## Phase 2

Create:

- User onboarding
- Sparkline codes
- Profiles
- Connection system

## Phase 3

Create:

- Real-time chat
- Message system
- Attachments
- Notifications

## Phase 4

Create:

- Audio calls
- Video calls
- WebRTC
- Call history

## Phase 5

Create:

- Groups
- Voice messages
- Advanced media sharing

## Phase 6

Create:

- Admin dashboard
- Moderation
- Analytics

## Phase 7

Create:

- Performance optimization
- Accessibility
- Security hardening
- PWA installation
- Cross-device testing

## Phase 8

Perform complete production testing.

---

# 54. TESTING

Test:

### Chat

- Send
- Receive
- Edit
- Delete
- Reply
- Reactions
- Files
- Offline recovery

### Connections

- Valid code
- Invalid code
- Request
- Accept
- Decline
- Block

### Calls

- Audio
- Video
- Permissions
- Reconnection
- Poor network
- Camera switching
- Microphone controls
- Call ending

### Devices

- Android Chrome
- iOS Safari
- Desktop Chrome
- Desktop Edge
- Firefox
- Safari

### Accessibility

- Keyboard
- Screen reader
- Reduced motion
- Contrast

---

# 55. PRODUCTION QUALITY

The final result must not look like an AI-generated template.

It should feel like a real product.

Requirements:

- Consistent spacing
- Strong typography
- Professional icons
- Smooth interactions
- Excellent responsive behavior
- No broken layouts
- No placeholder lorem ipsum
- No fake buttons
- No console errors
- No exposed secrets
- No unnecessary dependencies

---

# 56. FINAL DELIVERABLE

Generate the complete Sparkline application.

Include:

- Complete source code
- Frontend
- Backend
- Database schema
- Real-time communication
- WebRTC calling
- PWA
- Authentication/onboarding
- Connection system
- Chat
- Voice messages
- File sharing
- Audio calling
- Video calling
- Groups
- Notifications
- Privacy settings
- Admin dashboard
- Error handling
- Security
- Accessibility
- SEO
- Documentation
- Environment-variable example
- Deployment instructions
- Production checklist

---

# 57. FINAL AI INSTRUCTION

You are the lead product designer, UX designer, frontend developer, backend developer, database architect, WebRTC engineer, security engineer, performance engineer, QA engineer, and deployment engineer.

Do not simply generate a visual prototype.

Build a **real, functional, production-ready Sparkline communication platform**.

Before writing code:

1. Analyze the complete requirements.
2. Design the architecture.
3. Choose technologies appropriate for real-time messaging and WebRTC.
4. Create the database schema.
5. Create the API/realtime architecture.
6. Create the UI component system.
7. Implement the application.
8. Test every major feature.
9. Fix errors.
10. Optimize performance.
11. Check mobile and desktop compatibility.
12. Verify security.
13. Prepare deployment configuration.
14. Provide complete setup documentation.

If a requirement conflicts with platform limitations, choose the safest technically correct implementation and explain the limitation.

Never fake functionality.

Build Sparkline as a **fast, secure, scalable, beautiful communication platform where people can connect using a simple code and immediately start communicating.**