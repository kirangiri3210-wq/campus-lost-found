# Campus Lost & Found

A student-built mobile prototype that lets campus users report lost and found items, browse reports, upload photos, see possible matches, chat about a specific item, and mark items recovered.

This is a **capstone / coursework project**, not an official Southwest Minnesota State University (SMSU) production system. It is **not** published on the App Store or Google Play. There is **no** public live demo URL. The app is meant to run locally with Expo Go.

The React Native application lives in `mobile/` (`mobile/App.tsx`).

## Why I built it

Campus lost-and-found is usually a bulletin board, email thread, or front desk. I wanted a working mobile flow students could actually try: report an item, attach a photo, find likely counterparts, and message the other person until the item is marked recovered. The project is a learning exercise in Expo, TypeScript, and Firebase (Auth, Firestore, Storage), with room to move toward a more production-ready campus tool later.

## Key features

Implemented in the current codebase:

- Email/password authentication and password reset
- Lost and found reports (title, description, category, location, date)
- Browse with search, type/category/location filters, and sorting
- Optional camera or gallery photos stored in Firebase Storage
- Client-side weighted matching with a score and short explanation
- Item-based real-time chat
- In-app notifications stored in Firestore (not phone push)
- User profile with email, report counts, and personal report history
- Mark item as recovered (removed from matching)
- Moderation: hide/unhide/delete posts for a hardcoded admin email

## Tech stack

- React Native
- Expo
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Expo Image Picker
- AsyncStorage (auth session persistence)

There is no custom Node/Express or SQL backend.

## How the architecture works

The Expo client talks **directly** to Firebase using the JavaScript SDK. Navigation is a `screen` string inside one main component, not Expo Router.

- **Items, chats, and in-app notifications** are Firestore documents.
- **Photos** are uploaded to Storage; the download URL is saved on the item.
- **Matching** runs on the device: it loads items, scores lost vs found pairs, and can write MATCH notification documents.
- **Chat** uses a conversation document plus a `messages` subcollection. An open chat and the inbox use Firestore listeners (`onSnapshot`).
- **Access control** is intended to come from published Firestore and Storage rules (`firestore.rules`, `storage.rules`), not from a server API.

## Firebase services used

| Service | Role in this project |
|---|---|
| Authentication | Email/password accounts, password reset, session persistence |
| Cloud Firestore | `items`, `conversations`, `conversations/{id}/messages`, `notifications` |
| Storage | Item images under `item-images/{userId}/` |

Client config lives in `mobile/firebaseConfig.ts` (standard public Firebase web/app config). Do not commit service-account JSON or `.env` secrets. This README does not include API keys.

Indexes used by queries are listed in `firestore.indexes.json`. Rules must be published in the Firebase console for them to apply.

## Authentication

Users register and log in with email and password. Password reset uses Firebase email. Login state is persisted with AsyncStorage.

The app currently **allows `@smsu.edu` and `@gmail.com`** on the client. Firebase Authentication itself does not restrict domains. Registration also requires agreeing to an in-app privacy notice.

## Lost/found reporting and photos

Users submit a lost or found report with required text fields, a category picker, a date picker, and an optional photo. Photos can come from the camera or the gallery (`expo-image-picker`) and are uploaded with `uploadBytes`. Owners can edit fields, change the photo, delete their report, and mark it recovered.

Browse supports search, Lost/Found/All filters, category and location filters, and sort options (newest/oldest/A–Z/Z–A). **Newest/oldest currently sorts `MM/DD/YYYY` strings**, not true calendar order.

## Smart matching

Matching is **client-side**, not ML or computer vision. `getMatchScore` compares an active lost item to an active found item:

- Category match: 40
- Location: 25 exact, 15 substring, 10 shared word
- Title/description keywords: 8, 15, or 20
- Date proximity: 5, 10, or 15
- Score capped at 100; pairs at **40 or above** are listed

Recovered and moderator-hidden items are excluded. Matching is run from Home (Possible Matches) against **all** qualifying lost/found items, not only the current user’s reports. Creating a report can also write MATCH notifications to other owners when the score meets the threshold.

## Messaging and notifications

Messaging is tied to an item. A conversation has two participant UIDs. Messages are written to Firestore and shown live in the open thread. The inbox updates with a listener. Users cannot message themselves.

In-app notifications are Firestore documents (`MATCH`, `MESSAGE`, `STATUS`) with an unread count on Home. MESSAGE notifications can include a `conversationId` and open that chat. STATUS notifications can be sent to other people in that item’s conversations when the owner marks it recovered.

**OS / Expo push notifications are not implemented.**

## Current limitations

These are incomplete or not production-ready:

- Not an official SMSU product
- Not on the App Store or Google Play
- No hosted live demo
- Push notifications not implemented
- Email domain rules are client-side only; Gmail is still allowed
- Moderator access is a **hardcoded email list** (`lostandfound@smsu.edu` in the app and rules), not Firebase custom claims
- Almost all UI and logic live in a single `mobile/App.tsx`
- Item list for browse/dashboard is fetch-based, not a live listener
- Deleting an item does not delete the Storage file
- Date sort on browse is lexicographic on date strings

## Future improvements

Reasonable next steps, not claimed as done:

- Enforce campus email in Firebase (blocking functions or similar), not only in the app
- Replace hardcoded admin emails with proper roles
- Expo push notifications
- Chronological sort using stored timestamps
- Storage cleanup on delete
- Native store builds (EAS) **if** a campus pilot is approved

## How to run locally with Expo Go

1. Clone this repository.
2. Install dependencies: `npm install`
3. Start the bundler: `npx expo start`
4. Install **Expo Go** on a phone.
5. Scan the QR code (same Wi-Fi), or use `npx expo start --tunnel` if the LAN connection fails.
6. Sign in with an allowed email (`@smsu.edu` or Gmail in the current build).

The product to open is the Expo app under `mobile/`. Do not use leftover static HTML in the project folder as the application.

You need a Firebase project with Auth, Firestore, and Storage enabled, and the published rules/indexes that match this repo.

## Project status

**Student-built capstone prototype.** Core flows (auth, report, photo, browse, match, chat, recover, in-app notifications) are implemented and intended for Expo Go demos and coursework. It is **not** a deployed campus service, **not** store-published, and **not** backed by a custom server API.
