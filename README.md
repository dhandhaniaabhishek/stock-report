# Stock Report

Expo app and web workspace for the original stock ledger workflow with separate Admin Login and Employee Login, local data storage, ledger import, staff rights, audit reports, global counts, instructions, CSV export, and backup restore.

The previous HTML tools remain in this folder:

- `admin_inventory_app.html`
- `inventory_management_system.html`

## Default Login

Admin login:

```text
EMP Code: admin
Password: admin
```

Employees are created from the Admin > Staff screen. Employee login uses the EMP Code and password created there.

## Features

Admin side:

- Summary
- Ledger upload
- Stores
- Staff and rights
- Count approval
- Audit register
- InterStore transfer approval
- Customer Approval approval / returned / sold tracking
- Messages
- Backup

Employee side:

- Stock
- Article number suggestions while typing or scanning
- Ledger upload when allowed
- InterStore transfer request
- Customer Approval request
- Camera barcode scan / scanner input for stock search, audit, transfer, approval, and summary
- Audit scan / manual count
- Global count
- Instructions
- Password change

## Launch

Install dependencies first:

```bash
npm install
```

Start Expo for phone preview:

```bash
npm run start
```

Start the web page:

```bash
npm run web
```

On this Windows workspace, the Codex Run actions call:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\build_and_run.ps1 -Mode web
```

Export the web build:

```bash
npm run export:web
```

## Data

The app saves locally with the Expo SQLite localStorage layer and a compact stock-ledger format so large ledgers do not fill browser storage. On web, it can also migrate stock data from the previous browser app key: `simple-stock-ledger-v2`.

Current database mode:

- Local device/browser database for admin, employee, stock ledger, audit, count, transfer, approval, messages, and article photos.
- Same browser/device users share the same saved store data.
- Firebase Realtime Database cloud backup can save and restore the full app backup from Admin > Backup. See `FIREBASE_SETUP.md`.
- For real automatic multi-device live sync between separate phones/computers, the next backend step is to move each stock, count, audit, transfer, and approval record into separate Firebase database paths.

## Release Checklist

Before Play Store or public web launch:

- Re-upload each store ledger after selecting the correct store.
- Create or verify employee store and department/group allotment.
- Test Admin Login, Employee Login, Stock Search, Count, Audit, Transfer, Approval, Backup Export, and Restore.
- Test barcode scanning on the target Android phone.
- Export a manual backup before every production build.
- Test Firebase Save to Cloud and Restore from Cloud after setting `.env`.
- Prepare Play Store assets: app icon, screenshots, short description, full description, privacy policy URL, support email, and data safety answers.
- Use Android internal testing first, then closed/open/production tracks.

## Deploy

For native store builds, sign in to Expo and use the EAS profiles in `eas.json`:

```bash
npm run eas:init
npm run eas:build:android
npm run eas:build:ios
```

Submit Android to Play Store internal testing after the production build is ready:

```bash
npx eas-cli@latest submit -p android --profile production
```

For web hosting through EAS:

```bash
npm run eas:deploy:web
```
