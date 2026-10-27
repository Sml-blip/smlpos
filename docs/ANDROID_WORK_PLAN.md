# SMLPOS Native Android — Work Plan

Prepared: 2026-10-26 (Africa/Tunis)

Status: PLANNING. No Android application, APK, or feature parity is delivered by this document.

## 1. Product commitment

Build a professional native Android SMLPOS application with **all desktop business features**. Full feature parity is mandatory. This is a complete POS application, including administration and financial workflows.

- Preserve business behavior, calculations, permissions, document content, and data relationships.
- Adapt every screen for touch, phone keyboards, Android navigation, and small displays.
- Support offline business operations and synchronization with the existing Hetzner platform.
- Preserve SML branding and familiar French terminology.
- Treat staged implementation as delivery order, never as permission to omit remaining features.
- Do not declare the app complete while any required capability is unimplemented, blocked, or unverified.
- Translate Windows-specific mechanisms into Android equivalents. Every substitution requires a documented mapping and verification of the user outcome. An unavailable integration remains an open requirement.

## 2. Repository baseline and evidence

The inspected checkout is an Electron application using React, TypeScript, Tailwind, Zustand, SQLite through better-sqlite3, and a large preload API. Its package version at inspection is 1.9.1039. The checkout contains ongoing, uncommitted sync work; this plan does not change it.

Starting points for the implementation audit:

- `../src/preload/index.ts`: exposed desktop operations, including printing, backup, seed, and synchronization.
- `../src/main/index.ts`: IPC handlers and business transaction behavior.
- `../src/main/db.ts`: local schema, migrations, and data rules.
- `../src/main/backupService.ts` and `../src/main/printer/PrinterService.ts`: platform-dependent services.
- `../src/renderer/src/App.tsx`: module navigation, session, lock, and startup behavior.
- `../src/renderer/src/modules/`: all business screens, forms, menus, and workflows.
- `../src/renderer/src/components/`: shared workflows, dialogs, documents, and printing.
- `../src/renderer/src/lib/types.ts`: existing domain types.
- `../deploy/api/src/` and `../deploy/api/schema/sync2-contract.json`: server and synchronization contracts.
- `data-audit/`, `sync-implementation-status.md`, and `RELEASE_CHECKLIST.md`: existing data and readiness evidence.

Historical status documents describe different checkpoints. The newer release checklist records staging and physical validation blockers. Reconcile these against current code and actual staging evidence before relying on any sync claim. No existing server capability is assumed production-ready merely because a document mentions it.

## 3. Proposed technology decisions

| Area | Decision | Implementation note |
|---|---|---|
| Language | Kotlin | Native Android application; business behavior ported with parity fixtures |
| UI | Jetpack Compose | Native controls, lifecycle, keyboard behavior, and navigation |
| Design system | Material 3 with SML tokens | Custom branding and consistent reusable components |
| Presentation state | ViewModels, StateFlow, Coroutines | Unidirectional events and lifecycle-aware collection |
| Persistence | Room over SQLite | Versioned migrations, transactions, indexed queries, durable drafts and outbox |
| Network | Retrofit, OkHttp, Kotlin serialization | Typed API contracts and authenticated HTTPS |
| Background work | WorkManager | Durable retries; Android schedules execution, so no fixed background latency promise |
| Foreground synchronization | Lifecycle-aware sync coordinator | Catch up while app is active; serialize work with background workers |
| Preferences | DataStore | Non-secret preferences; distinguish business settings from device settings |
| Credential protection | Android Keystore-backed storage | Keep credentials out of logs, exports, and ordinary preferences |
| Dependency injection | Hilt | Explicit service boundaries and replaceable test dependencies |
| Camera/scanning | CameraX + barcode recognition adapter | Prove formats, offline availability, focus, and low-light behavior |
| Printing | Android print framework and device/protocol adapters | Validate actual receipt and label printers before selecting SDKs |
| Files and sharing | Android document picker and share sheet | Explicit import/export destinations and file access |
| Builds | Gradle Kotlin DSL, Android Studio | Reproducible debug and signed release builds |
| Verification | JVM, Room instrumentation, Compose UI, real hardware | Financial parity and complete business flows |

Select mutually compatible stable dependency versions during setup and pin them. Set minimum and target Android SDK levels after checking shop phones, peripheral SDK requirements, and distribution requirements. Hardware SDKs, OCR, spreadsheet, and PDF libraries remain selection tasks, not implemented capabilities.

References: [Android offline-first architecture](https://developer.android.com/topic/architecture/data-layer/offline-first), [Compose adaptive UI](https://developer.android.com/jetpack/androidx/releases/compose-material3-adaptive).

## 4. Architecture and code sharing

```text
Native Compose screens
        |
ViewModels and Kotlin business use cases
        |
Repositories and transaction boundary
        |
Room / SQLite + durable outbox  <-->  sync coordinator  <-->  Hetzner API
        |
Native device services: camera, printers, files, credentials
```

- Keep the Electron desktop application operational while Android is developed.
- Reuse API specifications, protocol definitions, design references, test fixtures, and business specifications.
- React screens, Electron IPC, Node packages, and better-sqlite3 cannot be reused directly as native Android implementations.
- Port desktop rules into Kotlin and compare both implementations against the same expected outcomes.
- Keep business logic out of composables. Use explicit commands and typed repositories rather than remote raw SQL.
- Capture local financial writes, stock effects, and outbox entries atomically.
- Map legacy IDs, replica IDs, timestamp semantics, and money representations explicitly at boundaries.
- Use integer millimes for stored money and exact decimal conversion with documented rounding. Validate quantities, discounts, VAT, costs, profits, and refunds against desktop fixtures; do not introduce binary floating-point money errors.
- Preserve business-day and Matin/Soir semantics independently of device timezone changes.

Proposed source root: `android/`, with native app build files scoped inside it. Confirm module boundaries during setup: app, design system, domain, data, network, database, sync, device services, and feature modules. No new chat, branch, deployment, or release is created by this plan.

## 5. Native UX and design system

### Navigation and screen structure

- Initial phone navigation proposal: Vente, Produits, Clients, Activité, Plus.
- Plus exposes every remaining module and settings according to permissions. It must not hide a missing implementation.
- Keep global search, module filters, and frequently used actions easy to reach.
- Use full-screen forms for complex tasks, bottom sheets for short contextual choices, and confirmation dialogs for consequential actions.
- Preserve draft entries on navigation, rotation, process recreation, and interrupted checkout.
- Respect Android Back, predictive-back behavior where supported, edge-to-edge insets, and the on-screen keyboard.
- Use adaptive list/detail panes for tablets and landscape; verify small phones independently.

### SML design tokens and components

- Derive actual brand colors from desktop assets. Define semantic primary, surface, text, border, success, warning, and error tokens.
- Define light/dark palettes and verify contrast; business statuses must not depend only on color.
- Use a consistent spacing scale: 4, 8, 12, 16, 24, 32 dp.
- Use touch targets of at least 48 dp, scalable text, TalkBack labels, and logical focus order.
- Define typography for page titles, section labels, body text, metadata, and financial totals; align numerical columns consistently.
- Create shared buttons, fields, money inputs, quantity controls, product cards, status chips, filters, date selectors, empty/error/loading states, and confirmation patterns.
- Format TND amounts consistently with three decimal places and familiar French labels.
- Apply short, purposeful motion and restrained haptics; respect system animation settings.

### Key workflow designs

| Workflow | Phone experience | Required behavior |
|---|---|---|
| POS | Search/scan, product results, persistent cart summary, dedicated checkout | All sale types, discounts, payments, serials, credit, documents, and drafts remain available |
| Inventory | Searchable cards, stock indicators, details and action menu | Full editing, adjustments, serials, categories, import, export, and labels |
| Financial records | Summary, filters, readable records, drill-down | Complete movements, acceptance, reconciliation, and audit trail |
| Reports | Summary totals followed by charts and detailed records | Same date filters, calculations, printable output, and exports |
| Complex forms | Grouped sections, correct keyboards, visible validation | All fields and rules; retain user input on failures |
| Sync | Clear local-save, pending, synced, and failed states | Server reachability must never be shown as proof that data has synced |

First design checkpoint: review interactive POS, inventory, and Trésorerie screens in loading, empty, populated, error, and offline states. This establishes components for all remaining modules.

## 6. Mandatory feature coverage register

Every row below starts as **NOT AUDITED / NOT IMPLEMENTED**. This is a starting inventory, not a claim that every desktop subfeature has already been discovered.

| ID | Feature family | Required coverage to audit and implement |
|---|---|---|
| AND-01 | Startup, operators and access | Onboarding, operator selection, permissions, PIN unlock, inactivity lock, sessions, organization context |
| AND-02 | Shifts and cash closure | Opening float, active shift, Matin/Soir, closure, summaries, daily reports, combined daily totals and transfers |
| AND-03 | POS products and cart | Search, barcode lookup, unknown barcode, categories, price/quantity edits, discounts, serial selection, saved carts, draft recovery |
| AND-04 | Checkout and customer invoicing | Every existing payment mode, split/partial behavior if present, credit, free-sale reasons, numbering, customer invoices, receipt generation |
| AND-05 | POS services | Service catalog, service lookup, transactions, note suggestions, shift totals |
| AND-06 | Repairs | Intake, parts, damage costs, status changes, finalization, payments, numbering, profit statistics, supporting documents |
| AND-07 | Sales history | Search/filter, details, edit paths where supported, cancellation, exchanges, refunds, reprints, related documents |
| AND-08 | Inventory | CRUD, stock adjustment, categories, source tags, barcode uniqueness, serial lifecycle, bulk imports and labels |
| AND-09 | Suppliers and purchasing | Suppliers, commercial contacts, purchase invoices, line items, drafts, edits, receipt, cancellation, payments and adjustments |
| AND-10 | Invoice scanning | Image/file capture, recognition, review/correction, import into purchases; Android equivalent of desktop scanner acquisition |
| AND-11 | Online sales | Order creation, listing, statuses, delivery/return behavior, fees, numbering, customer and stock effects, printing |
| AND-12 | Customers and loyalty | Customer CRUD, search, loyalty lookup/card assignment, movements and all existing accrual/redemption rules |
| AND-13 | Customer credit and advances | Debt creation/update, payments, settlement, advances, balances, history and receipts |
| AND-14 | Returns | Create/list, statuses, reason, refund/exchange paths, stock and financial effects |
| AND-15 | Personnel | CRUD, movements, balances, salary/advance/other movement types found in audit, reports and permissions |
| AND-16 | Trésorerie | Internal/external cash-outs, parcel return fees, pending inbox, individual/bulk acceptance, badges, shift transfers, statistics; no double deduction |
| AND-17 | Documents | Factures, devis, BL, details/edits, lines, numbering, revocation, cancellation with avoir/refund, pending BL, daily Facture F and missing-day recovery |
| AND-18 | Reports and dashboard | Today/date-range statistics, all dashboard metrics and filters, sales bilan, TVA exports, cash reports and PDFs |
| AND-19 | Requests and reminders | Create, filter/list, pending counts, status changes, operator attribution and existing notifications |
| AND-20 | Organizations | List/create/update/delete and every related balance/document behavior |
| AND-21 | Settings and diagnostics | All business/device settings, batch settings, health/version, logs, default catalog, demo behavior, reset diagnostics and controlled reset |
| AND-22 | Printing and labels | Printer discovery/selection, receipt/document output, copies, labels/barcodes, TSPL/Gainscha-equivalent workflows, previews and failure recovery |
| AND-23 | Files and exports | Excel import/export, PDF save/share, image selection, templates, filenames, document destinations and error handling |
| AND-24 | Local and cloud backup | Create/list/stats, destination selection, discovery, validated restore, R2 status/test/list/upload/restore with protected credentials |
| AND-25 | Multi-device sync and seed | Registration/login, device management, join, seed status/preflight/backup/approval/run/pause/retry/report workflows, number reservation, queue/issues/export and recovery |
| AND-26 | Application lifecycle | Install/update, data-preserving upgrades, Android lifecycle equivalents of desktop window controls, process death and restart recovery |

### Exhaustive audit rule

Before declaring the feature inventory complete:

1. Enumerate every renderer screen, dialog, menu item, setting, keyboard-only action, and report.
2. Enumerate preload methods, IPC handlers, raw database calls, schema tables, migrations, scheduled services, and direct integrations. The preload surface alone is insufficient.
3. Record a row for each user-observable behavior with desktop source reference, permissions, inputs, side effects, Android screen/use case, offline behavior, and verification scenario.
4. Record implementation and verification separately: NOT STARTED, IN PROGRESS, IMPLEMENTED, VERIFIED, or BLOCKED; attach evidence and blocker details.
5. Map Windows-only mechanisms to named Android outcomes. Never silently mark them N/A. Any proposed scope change needs explicit user agreement; until then it remains required.
6. Reconcile added desktop features throughout development so parity targets do not become stale.

Deliverable: `ANDROID_FEATURE_PARITY.md`, including stable per-behavior IDs, source revision, implementation references, and evidence links.

## 7. Synchronization and offline contract

- Reuse the existing authenticated server protocol after verifying its current schema and endpoint behavior.
- Persist transactions locally before showing success; add their synchronization intent in the same database transaction.
- Make retries idempotent, preserve durable cursors, and prevent overlapping workers from duplicating uploads or applying pulls twice.
- Prove restart-safe join/seed, pagination, deletion/tombstone semantics, schema negotiation, reference ordering, and failed-batch recovery.
- Specify conflict resolution per entity. Financial and stock conflicts require explicit ledger-safe rules; generic last-write-wins is insufficient.
- Agree offline numbering and concurrent-device behavior with the server. Do not promise globally reserved invoice numbers without an offline allocation policy.
- Prove compatibility with desktop opening movements and money conversion; never replay historical effects twice.
- Separate foreground catch-up targets from Android background scheduling. WorkManager cannot guarantee a sync every few seconds while the app is closed.
- Device revocation, expired credentials, rejected transactions, and failed integrity checks need actionable screens without discarding pending local work.
- Maintain a compatible contract with the sync workstream; coordinate changes before implementing clients against changing endpoints.

## 8. Implementation sequence and exit gates

| Phase | Work | Exit evidence |
|---|---|---|
| 0. Inventory and contracts | Exhaustive parity register; identify business rules, schema, hardware, SDK/toolchain needs and sync gaps | Every discovered desktop behavior mapped; baseline revision recorded; blockers explicit |
| 1. Native foundation | Gradle project, architecture, CI build, design tokens, navigation, database/network skeleton, test fixtures | Debug APK installs on emulator and a real phone; basic lifecycle/accessibility checks pass |
| 2. Design checkpoint | POS, inventory, Trésorerie prototypes using synthetic data; phone/tablet adaptation | Reviewable interactive screens covering all visual states; reusable component catalog |
| 3. Local domain foundation | Schema/migrations, money/date rules, sessions/permissions, repositories, atomic outbox and durable drafts | JVM parity fixtures and Room migration/transaction/process-recovery tests pass |
| 4. Complete local workflows | Implement AND-01 through AND-21 with full subfeature coverage | Each behavior implemented and verified locally; no buttons that only simulate completion |
| 5. Native integrations | Complete AND-22 through AND-24 and AND-26; real scanning, imports/exports, printing, backups and updates | Verified outputs and restores; actual peripheral compatibility recorded |
| 6. Staging synchronization | Complete AND-25 against isolated staging; test Android with Electron | Real phone/PC convergence, retry, conflict and reconciliation evidence |
| 7. Full regression and release readiness | Audit entire parity register, usability, accessibility, performance, security and update recovery | Every required row VERIFIED; zero unresolved critical data/financial faults; signed candidate and review report |
| 8. Controlled pilot | Use explicit pilot authorization after staging review; monitor agreed shop workflow | Documented pilot results, recovery proof and release decision |

Design and local feature development can proceed while the existing sync workstream resolves staging. Phase 6 depends on verified staging access and a compatible contract. Phase order does not remove the full feature requirement. Estimate duration only after Phase 0 exposes the real scope and hardware dependencies.

## 9. Verification and acceptance

### Business correctness

- Use synthetic golden fixtures shared with desktop for sales, discounts, VAT, free sales, repairs, purchasing, debt, loyalty, advances, returns, exchanges and cancellations.
- Reconcile stock, serial ownership, customer/supplier/personnel balances, cash movements and report totals after each workflow.
- Specifically verify Matin + Soir totals and Trésorerie acceptance without duplicate deductions.
- Verify all supported monetary precision and rounding boundaries, timezone/day boundaries, repeated taps, retries and concurrent device operations.

### Android quality

- Verify small and large phones, tablet/landscape, larger font settings, TalkBack, keyboard overlap, back gestures and denied permissions.
- Test rotation, screen lock, process death, interrupted import/export/checkout, low storage, and upgrade with pending unsynced data.
- Measure startup, search, long lists, checkout save and scrolling on a representative shop phone using a production-scale synthetic dataset; record device, dataset, and agreed budgets before sign-off.
- Exercise printer disconnection, paper/layout problems, repeated jobs, scanner focus, invalid files and interrupted backup/restore.
- Verify authenticated access and tenant/device isolation. Redact credentials and customer data from diagnostics.

### Staging integration

- Test a physical Android phone and Windows Electron PC against isolated staging, including sales and edits from both devices.
- Test simultaneous stock/serial use, refunds, duplicate submissions, disconnection, restart, expired authentication, revoked devices and server rejection.
- Reconcile row counts, relationships, integer money totals, stock movements, cursors and pending queues. Skipped tests are not passing tests.
- Use synthetic or approved copied datasets. Existing production restrictions continue to apply; this document authorizes no production deployment or data migration.

Release acceptance requires complete parity evidence, a tested data-preserving upgrade, verified backup/restore, actual supported printer/scanner evidence, and a documented pilot/recovery procedure. APK installation or a polished demo alone does not satisfy acceptance.

## 10. Open decisions and immediate next work

Resolve during preparation without blocking independent design work:

- Shop phone/tablet models and Android versions.
- Exact printer models, connection types (USB, Bluetooth, network), label sizes, receipt widths and scanner hardware.
- Distribution method and signing ownership: managed APK, Google Play, or another agreed channel.
- Current server protocol maturity, isolated staging connectivity, and Android device policy under existing device limits.
- Whether phone-first installations must act as seed sources; preserve the existing administrative seed outcomes until an equivalent is agreed and tested.
- Backup format interoperability and R2 access architecture; never embed shared administrator credentials in the app.
- All monetary/date rules and unusual historical data identified by the audit.

Next implementation tasks:

- [ ] Produce the exhaustive `ANDROID_FEATURE_PARITY.md` register from the current desktop source.
- [ ] Record architecture decisions and sync/hardware blockers.
- [ ] Inspect available Android SDK/JDK/Gradle tooling and define the reproducible build.
- [ ] Scaffold the native project in the agreed source root with pinned stable dependencies.
- [ ] Implement SML design tokens and the first three interactive screen prototypes.
- [ ] Add representative business fixtures and prove native money/database behavior before wiring financial actions.

## 11. Progress reporting rules

Report implementation, automated verification, physical verification, and remaining blockers separately. Update the parity register as work progresses. Keep mock/prototype behavior visibly identified. Never report a desktop-only test, emulator-only test, reachable API, or synthetic dataset as proof of a complete native workflow or production readiness.
