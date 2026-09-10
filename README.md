# Campus Lost & Found

A student-built mobile lost-and-found prototype for campus use.

## Overview

Campus Lost & Found is an Expo / React Native app that helps students report lost and found items, browse and search reports, upload photos, see possible match suggestions, message the other person about a specific item, and mark items as recovered. The app talks directly to Firebase (Authentication, Cloud Firestore, and Storage). It is a capstone/hackathon prototype, not a published store app.

The mobile application lives in `mobile/` (`mobile/App.tsx`). That is the product to run and review.

## Features

- Email/password authentication
- Password reset
- Lost and found reports
- Search, filtering, and sorting
- Camera and gallery photo uploads
- Photos stored in Firebase Storage
- Client-side weighted matching (category, location, keywords, date)
- Real-time, item-based messaging
- In-app notifications (Firestore; not OS push)
- Recovered item tracking
- User profile and report statistics
- Moderation tools (hide/unhide/delete for a hardcoded admin email)

## Tech Stack

- React Native
- Expo
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Expo Image Picker
- AsyncStorage

## Architecture

The client uses the Firebase JavaScript SDK. There is no custom Node/Express API. Matching scores and in-app notification documents are created on the device. Chat messages in an open conversation use a Firestore realtime listener. Navigation is screen state inside the main app component (not Expo Router).

## Current Status

- Student/capstone prototype
- Intended to run with Expo Go (`npx expo start`)
- Not an official SMSU product
- Not published to the App Store or Google Play
- Push notifications are not implemented
- Campus email checks are client-side (`@smsu.edu` and Gmail are both allowed in the current app)
- Admin/moderator access is a hardcoded email list in the app and in Firestore rules, not Firebase custom claims

## Running Locally

1. Clone the repository.
2. Install dependencies: `npm install`
3. Start Expo: `npx expo start`
4. Open the project in **Expo Go** on a phone (same network, or use tunnel if needed).

Do not treat any leftover static HTML/CSS/JS in the project folder as the mobile app.

## Firebase Setup

The project uses:

- **Authentication** — email and password
- **Cloud Firestore** — items, conversations, messages, and in-app notifications
- **Storage** — item photos under `item-images/`

Client Firebase config is in `mobile/firebaseConfig.ts`. That is the public web/app configuration Firebase expects in a client. Access control depends on Firestore and Storage **rules** published in the Firebase console (`firestore.rules`, `storage.rules`). Composite indexes are described in `firestore.indexes.json`.

This README does not include service-account keys or other private credentials. Do not commit `.env` files or Google service-account JSON.

## Project Notes

This is a learning and capstone project. The goal is a working campus lost-and-found flow (report, match, chat, recover) that can be demonstrated in Expo Go and improved toward a more production-ready campus application over time.
