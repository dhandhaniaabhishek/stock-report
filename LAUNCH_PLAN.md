# Stock Report Launch Plan

## Current Status

- Expo app and web app are already set up.
- Admin and Employee login flows are present.
- Ledger upload, stock search, barcode scan, counts, audit, transfer, approval, messages, and backup flows are present.
- Data is currently saved on the local device/browser.
- Web preview works locally.
- EAS build profiles are already present in `eas.json`.

## Important Missing Items Before Real Launch

### 1. Cloud Database And Backup

Selected first step: Firebase Realtime Database cloud backup.

Added now:

- Firebase cloud backup service.
- Admin Backup screen Save to Cloud and Restore from Cloud.
- Firebase environment example.
- Realtime Database rules file.
- Firebase setup guide.

Still needed for full live database mode:

Needed tables:

- stores
- employees
- employee_groups
- stock_items
- stock_ledger_imports
- counts
- audits
- transfers
- approvals
- messages
- article_photos
- backup_exports

Needed behavior:

- Admin upload updates all employees of the same store.
- Employee upload updates admin and employees of the same store if allowed.
- Store data should sync across phones and web.
- Article photos should upload to cloud storage, not only local storage.
- Manual export backup should remain available.

### 2. Login And Security

Current login is simple local login. Production needs:

- Secure admin login.
- Secure employee login.
- Password reset/change process.
- Store-level and group-level permission checks from the backend.
- Activity log for ledger upload, transfer approval, count approval, and customer approval.

### 3. App Design Polish

Needed design improvements:

- Cleaner mobile-first layout for employee screens.
- Faster admin dashboard for large stock ledgers.
- Better table layout for small phones.
- Clear status colors for pending/approved/rejected/sold/returned.
- Better camera scan screen with manual entry fallback.
- App icon and splash screen.
- Empty states and error messages for no stock, no groups, upload failure, offline mode, and permission denial.

### 4. Play Store Launch

Needed before Play Store:

- Google Play Developer account.
- Final Android package name.
- App icon, feature graphic, screenshots, short description, full description.
- Privacy policy URL.
- Data Safety form answers.
- Internal testing release first.
- Production build from EAS.
- First upload to Play Console manually, then EAS Submit can automate later.

### 5. Web App Launch

Needed before public web:

- Decide hosting: EAS Hosting, Sites, or another web host.
- Production cloud database URL.
- Custom domain if needed.
- Web privacy policy page.
- Test ledger upload on Chrome and Edge.
- Test barcode scanner support and manual fallback.

### 6. Testing Checklist

Test these before launch:

- Admin login.
- Employee login.
- Store selection.
- Ledger import from `.xls`.
- Group allotment to employee.
- Employee stock visibility after admin ledger upload.
- Count by employee group.
- Audit scan with barcode and manual entry.
- Inter-store transfer approval.
- Customer approval approval/reject/sold/returned.
- Article photo upload.
- Manual backup export and restore.
- Offline behavior.
- App restart behavior.

## Recommended Next Build Order

1. Add cloud database connection and sync layer.
2. Move admin, employee, stock, audit, transfer, approval, and messages data to cloud-backed storage.
3. Add cloud photo/file upload.
4. Polish mobile design and app icon/splash.
5. Run full QA with your real ledger.
6. Create internal Android build.
7. Publish web app.
8. Complete Play Store internal testing.
9. Move to production launch.
