# Firebase Backup Setup

This project now has Firebase Realtime Database cloud backup support.

## What It Does

- Admin can save the full Stock Report backup to Firebase.
- Admin can restore the full Stock Report backup from Firebase.
- Existing local file export and restore still works.
- Firebase stores the backup at:

```text
stock-report/main/backup
```

This is cloud backup first. Live multi-phone database sync is the next step after the backup is tested.

## Firebase Console Steps

1. Open Firebase Console.
2. Create a project.
3. Add a Web app.
4. Copy the Web API key.
5. Go to Authentication.
6. Enable Email/Password sign-in.
7. Create one Firebase user for admin cloud backup.
8. Go to Realtime Database.
9. Create a database.
10. Copy the database URL.
11. Open Rules and paste the contents of:

```text
firebase-database.rules.json
```

12. Publish the rules.

The rules must look like this:

```json
{
  "rules": {
    "stock-report": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

## App Setup

Create a file named `.env` in this project folder:

```text
EXPO_PUBLIC_FIREBASE_API_KEY=your-web-api-key
EXPO_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com
EXPO_PUBLIC_FIREBASE_BACKUP_PATH=stock-report/main/backup
```

Restart Expo after changing `.env`.

## How To Use In The App

1. Login as Admin.
2. Open Backup.
3. Check that Firebase Cloud Backup says Configured.
4. Enter the Firebase email and password.
5. Press Save to Cloud.
6. To recover data on another phone or browser, enter the same Firebase email/password and press Restore from Cloud.

## Important

- Do not make Realtime Database rules public.
- Do not share the Firebase admin backup user password.
- Keep manual Export Backup before major ledger updates.
- For Play Store launch, add the same Firebase values in the production build environment.
