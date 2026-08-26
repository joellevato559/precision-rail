# Precision Rail — MVP Screen Flows & Wireframes

Text wireframes for **Driver PWA** and **Manager Web**.  
Layout: mobile-first for driver (390px); desktop for manager (1280px+).

---

## 1. Navigation maps

### Driver app

```
Login
  └── Home (Today)
        ├── Duty Status (sheet)
        ├── Pre-Trip Inspection
        ├── Start / End Drive
        ├── Clock In / Out
        ├── Log Fuel
        ├── Jobs
        ├── Trip Report (last drive)
        └── Settings (vehicle select if multi)
```

### Manager web

```
Login
  └── Dashboard (Live Fleet)
        ├── Vehicle Detail
        │     ├── Timeline
        │     ├── Approvals (for vehicle)
        │     └── Trip Report
        ├── Approvals Queue
        ├── Payroll
        ├── Fuel Integrity
        ├── IFTA Summary
        ├── Audit Log
        └── Admin (if role)
              ├── Users
              ├── Vehicles & Trackers
              └── Company Settings
```

---

## 2. Driver screens

### 2.1 Login

```
┌─────────────────────────────────┐
│  Precision Rail                 │
│  Time & Mileage                 │
│                                 │
│  Email                          │
│  [________________........]     │
│  Password                       │
│  [________________........]     │
│                                 │
│  [       Sign In            ]   │
│                                 │
│  Problem signing in? Contact    │
│  your manager                   │
└─────────────────────────────────┘
```

**Flow:** Submit → `POST /auth/login` → store tokens → Home.

---

### 2.2 Home (Today)

```
┌─────────────────────────────────┐
│ TRUCK-01              [Sync ✓]  │
│ John Driver                     │
├─────────────────────────────────┤
│ Duty: ON DUTY (Not Driving)     │
│ [Change status]                 │
├─────────────────────────────────┤
│ HOS Assist                      │
│ Drive today     3.2 / 11 h  ████│
│ On-duty window  5.1 / 14 h  ████│
│ 8-day total    42.0 / 70 h  ████│
│ ⚠ Approaching drive limit       │
├─────────────────────────────────┤
│ Work    2.50 h    Drive 3.20 h  │
│ Miles today           87.4 mi   │
│ Odometer           14,523.1 mi  │
├─────────────────────────────────┤
│ [ Start Drive ]  [ Clock In ]   │
│ [ Pre-Trip    ]  [ Log Fuel ]   │
├─────────────────────────────────┤
│ Jobs (2 open)                ›  │
│ Last drive — Trip report     ›  │
└─────────────────────────────────┘
│ Home  Jobs  Fuel  More          │
```

**Actions**
- **Start Drive** → if no valid pre-trip → force Pre-Trip screen (or 409).  
- **Start Drive** while HOS critical → modal warning; company setting may block.  
- **Change status** → bottom sheet: Off / Sleeper / Driving / On Duty.  
  - Choosing **Driving** triggers same path as Start Drive.

---

### 2.3 Pre-Trip / Post-Trip inspection

```
┌─────────────────────────────────┐
│ ← Inspection                    │
│ Type: (•) Pre-Trip  ( ) Post   │
├─────────────────────────────────┤
│ Brakes              [ OK ▾ ]    │
│ Lights / Reflectors [ OK ▾ ]    │
│ Tires / Wheels      [ OK ▾ ]    │
│ Steering            [ OK ▾ ]    │
│ Horn                [ OK ▾ ]    │
│ Windshield / Wipers [ OK ▾ ]    │
│ Mirrors             [ OK ▾ ]    │
│ Coupling Devices    [ N/A ▾ ]   │
│ Fluid Levels        [ OK ▾ ]    │
│ Emergency Equipment [ Defect ▾] │
├─────────────────────────────────┤
│ Notes                           │
│ [Left rear tire wear........]   │
│                                 │
│ Safe to operate?                │
│ (•) Yes   ( ) No                │
│                                 │
│ [ Submit Inspection ]           │
└─────────────────────────────────┘
```

**Flow:** Submit → `POST /inspections` → if pre-trip and safe → return to Home with Start Drive enabled.

---

### 2.4 Active drive

```
┌─────────────────────────────────┐
│ DRIVING                    LIVE │
│ Started 08:14 AM                │
├─────────────────────────────────┤
│ Duration              1h 22m    │
│ Miles this drive       54.3 mi  │
│ Start odo          14,468.8 mi  │
│ Current odo        14,523.1 mi  │
│ Jurisdiction              [TX▾] │
├─────────────────────────────────┤
│ [      End Drive            ]   │
│                                 │
│ HOS: Drive 4.4 / 11 h           │
└─────────────────────────────────┘
```

**End Drive:** confirm sheet → `POST /drives/end` → prompt Post-Trip → Home.

---

### 2.5 Log fuel

```
┌─────────────────────────────────┐
│ ← Log Fuel                      │
│ Date        [2026-08-18]        │
│ Vendor      [Shell #442....]    │
│ Amount $    [128.50]            │
│ Gallons     [32.1]              │
│ $/gal       [auto]              │
│ Payment     [Company Card ▾]    │
│ Jurisdiction[TX ▾]              │
│ Receipt photo                   │
│ [ Take / Upload ]               │
│ [preview thumb]                 │
│ [ Save Expense ]                │
└─────────────────────────────────┘
```

---

### 2.6 Jobs

```
┌─────────────────────────────────┐
│ Jobs — TRUCK-01                 │
│ 1. 1200 Industrial Blvd         │
│    Status: EN ROUTE             │
│    [ Mark Arrived ]             │
│ 2. Customer Yard B              │
│    Status: PENDING              │
│    [ Start / En Route ]         │
└─────────────────────────────────┘
```

---

## 3. Manager screens

### 3.1 Live fleet dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│ Precision Rail          Approvals(3)  Payroll  Integrity  Admin  │
├────────────────────────────┬─────────────────────────────────────┤
│ LIVE MAP                   │ Fleet                               │
│  [map with vehicle pins]   │ TRUCK-01  Driving  54 mph           │
│                            │   12.4 mi today · John              │
│                            │ TRUCK-02  Idle · On Duty            │
│                            │   0 mi · Maria                      │
│                            │ TRUCK-03  Offline 2h                │
│                            │                                     │
│                            │ HOS flags: 1 critical               │
│                            │ Open defects: 2                     │
└────────────────────────────┴─────────────────────────────────────┘
```

Click vehicle → **Vehicle detail**.

---

### 3.2 Vehicle detail

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Fleet / TRUCK-01                          [Trip report]        │
│ Driver: John · Duty: Driving · Odo: 14,523.1 mi                  │
├──────────────────────────────────────────────────────────────────┤
│ Tabs: [Overview] [Timeline] [Expenses] [Inspections]             │
│                                                                  │
│ Work 18.5 h · Drive 22.0 h (week) · GPS 412 mi                   │
│ Integrity: 1 open flag                                           │
│                                                                  │
│ Pending sessions                 [Approve selected]              │
│ ☐ John  Mon  8.00 h                                              │
│ ☐ John  Tue  7.50 h                                              │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3.3 Approvals queue

```
┌──────────────────────────────────────────────────────────────────┐
│ Timesheet Approvals          Week of 2026-08-17                   │
│ Filter: [All vehicles ▾]  [Pending ▾]                            │
│                                                                  │
│ ☐ Driver    Vehicle   Date       Hours   Status                  │
│ ☐ John      TRUCK-01  Mon 8/17   8.00    Pending                 │
│ ☐ Maria     TRUCK-02  Mon 8/17   7.25    Pending                 │
│                                                                  │
│ [ Approve selected ]                                             │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3.4 Payroll

```
┌──────────────────────────────────────────────────────────────────┐
│ Payroll Export                                                   │
│ Week start [2026-08-17]                                          │
│                                                                  │
│ Employee   Work Hours   Drive Hours   Total                      │
│ John            40.00         22.50   62.50                      │
│ Maria           38.00         18.00   56.00                      │
│                                                                  │
│ Note: Work = approved sessions. Drive = completed drive segments.│
│ Pay categories export separately for rate application.           │
│                                                                  │
│ [ Download CSV & Mark Submitted ]                                │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3.5 Fuel integrity

```
┌──────────────────────────────────────────────────────────────────┐
│ Fuel & Mileage Integrity                                         │
│ [ Open ] [ Dismissed ]     [ Scan now ]                          │
│                                                                  │
│ 🔴 CRITICAL  TRUCK-01 · RAPID_FILLS                              │
│ Two fuel purchases 1.2 h apart · $128 then $96                   │
│ 2026-08-18 14:02 · [ Dismiss ] [ View expense ]                  │
│                                                                  │
│ 🟡 WARNING   TRUCK-03 · MPG_BELOW_BASELINE                       │
│ 5.2 MPG vs median 7.8 MPG                                        │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3.6 IFTA summary

```
┌──────────────────────────────────────────────────────────────────┐
│ IFTA-Style Summary     From [08/01] To [08/18]  [Build] [CSV]    │
│                                                                  │
│ Jurisdiction   Miles    Gallons    Fuel $    MPG                 │
│ TX             1204.5    168.2     612.40    7.2                 │
│ OK              340.0     48.1     175.20    7.1                 │
│ Total          1544.5    216.3     787.60    7.1                 │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3.7 Audit log

```
┌──────────────────────────────────────────────────────────────────┐
│ Audit Trail                                                      │
│ 2026-08-18 13:55  Sara (manager)  timesheet_approve              │
│   Approved John · 8.00 h · TRUCK-01                              │
│ 2026-08-18 13:40  John (driver)   drive_end                      │
│   1.40 h · 54.3 mi · TX · TRUCK-01                               │
│ [ Export CSV ]                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3.8 Admin — Vehicles

```
┌──────────────────────────────────────────────────────────────────┐
│ Vehicles                                            [ + Add ]    │
│ Code      Plate    Tracker IMEI         Odo        Active        │
│ TRUCK-01  ABC-123  3596321…             14523.1    Yes           │
│ TRUCK-02  XYZ-789  (unassigned)         8200.0     Yes           │
│                                                                  │
│ Detail drawer: baseline odometer, default jurisdiction,          │
│ link/unlink tracker                                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Critical user journeys

### Journey A — Driver starts day
1. Login → Home  
2. Clock In (duty → On Duty)  
3. Pre-Trip (all OK, safe)  
4. **Start Drive** (travel to job — drive rate; does **not** require clock-in)
5. **End Drive** at jobsite
6. **Clock In** for work at site (regular rate)
7. Work on site (miles while clocked in tracked; not drive pay)
8. **Clock Out** when work complete
9. **Start Drive** leaving jobsite (drive rate)
10. **End Drive** at home / lodging  
5. End Drive → Post-Trip  
6. Optional fuel log with receipt  
7. Clock Out (duty → Off)

### Journey B — Manager weekly pay
1. Review Integrity flags (resolve/dismiss)  
2. Approvals queue → approve clean sessions  
3. Payroll preview → export CSV  
4. Spot-check Audit for manual edits  

### Journey C — Suspicious fuel
1. Driver logs fuel  
2. Worker job compares miles ±36 h and baseline MPG  
3. Flag appears on Integrity  
4. Manager opens vehicle timeline + receipt  

---

## 5. Empty / error / permission states

| State | UI |
|-------|-----|
| No tracker data | “Waiting for tracker” on map; miles 0 with explanation |
| PRETRIP_REQUIRED | Modal → go to inspection |
| HOS_LIMIT | Modal; block or warn per settings |
| Offline (driver) | Banner “Offline — actions will sync”; queue locally |
| 403 | “You don’t have access” |
| No pending approvals | “All caught up” illustration |

---

## 6. Implementation notes for UI team

- Driver: minimum 44px tap targets; avoid multi-column forms.  
- Show **mi** and **mph** only (no km).  
- Always show vehicle code in header when a vehicle is selected.  
- Destructive actions (dismiss anomaly, export payroll) use confirm dialog.  
- Banner copy on HOS screens: *HOS Assist — not a certified ELD*.  

---

## 7. Prototype → product mapping

| Prototype panel | Product screen |
|-----------------|----------------|
| Employee clock + drive | Driver Home + Active drive |
| DVIR card | Pre/Post-Trip |
| HOS buttons | Duty status sheet + meters |
| Manager fleet map | Live fleet dashboard |
| Approvals + payroll | Approvals + Payroll |
| Fuel integrity card | Integrity |
| IFTA card | IFTA Summary |
| Audit card | Audit Log |
| Hardware baseline odo | Admin vehicle detail |
