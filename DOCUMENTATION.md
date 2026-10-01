# SACOSA AI Pickup Management System — Complete Technical Documentation

## Table of Contents
1. [Executive Summary & Business Context](#1-executive-summary--business-context)
2. [High-Level Architecture](#2-high-level-architecture)
3. [End-to-End Lifecycle: From Phone Call to Dispatch](#3-end-to-end-lifecycle-from-phone-call-to-dispatch)
   - [Phase 1: Inbound Call & Interactive Spanish Voice AI](#phase-1-inbound-call--interactive-spanish-voice-ai)
   - [Phase 2: Intelligent Scheduling & Capacity Verification](#phase-2-intelligent-scheduling--capacity-verification)
   - [Phase 3: Database Persistence & Google Calendar Sync](#phase-3-database-persistence--google-calendar-sync)
4. [Backend Operations & Route Optimization Engine](#4-backend-operations--route-optimization-engine)
   - [Capacity Constraints & Trip Model](#capacity-constraints--trip-model)
   - [Step-by-Step Route Optimization Algorithm](#step-by-step-route-optimization-algorithm)
   - [Automatic Overflow Handling](#automatic-overflow-handling)
   - [Calendar Trip Color-Coding](#calendar-trip-color-coding)
5. [Database Schema & State Model](#5-database-schema--state-model)
6. [Complete API & Webhook Reference](#6-complete-api--webhook-reference)
7. [Environment Variables & Configuration](#7-environment-variables--configuration)
8. [Local Development, Testing & Verification Guide](#8-local-development-testing--verification-guide)

---

## 1. Executive Summary & Business Context

**SACOSA** sells heavy-duty rubble bags (*sacas de escombros*) for construction and renovation waste in the Community of Madrid, Spain (primarily servicing **Alcalá de Henares** and **Villalbilla**). 

### The Problem
Previously, customers called the SACOSA phone number printed on the bag to request pickup manually. Dispatchers had to answer calls, write down addresses, check driver availability, manually plot schedules, and phone drivers. This caused:
- High operational overhead and missed calls during peak hours.
- Human error in address transcription.
- Inefficient pickup routes resulting in excess fuel and driver hours.
- Difficulty managing daily truck capacity limits.

### The Automated Solution
This project provides an automated, end-to-end dispatch backend:
1. **Autonomous Spanish Voice AI**: An interactive IVR powered by Twilio and Amazon Polly Neural (`Polly.Lucia-Neural`) collects the caller's address, validates it against Google Maps, confirms it, and captures bag count and location instructions.
2. **Scheduling Rules**: Pickups are scheduled strictly on **Fridays and Saturdays**, enforcing daily limits across both the local database and Google Calendar.
3. **Route Optimization**: Groups daily pickups into driver trips using the **Nearest Neighbor** heuristic and Google Maps Distance Matrix API.
4. **Automated Overflow Rescheduling**: When a day exceeds the 30-bag limit, excess pickups are automatically rolled over to the next available Friday/Saturday in both PostgreSQL and Google Calendar.
5. **Real-time Operations Sync**: Detailed calendar events are created and color-coded by trip (Blue for Trip 1, Green for Trip 2).

---

## 2. High-Level Architecture

```mermaid
flowchart TB
    subgraph Ingestion ["1. Customer Call & Intake"]
        A[Customer Calls SACOSA Phone Number] --> B[Twilio Voice Gateway]
        B --> C["services/voiceService.js<br/>(Neural Spanish Polly.Lucia)"]
        C --> D["services/addressValidation.js<br/>(Google Maps Geocoding API)"]
    end

    subgraph CoreEngine ["2. Scheduling & Storage Engine"]
        C --> E["services/schedulerService.js<br/>(Fri/Sat Rule & Capacity Check)"]
        E --> F[("PostgreSQL Database<br/>(Prisma ORM)")]
        E --> G["services/calendarService.js<br/>(Google Calendar API)"]
    end

    subgraph Operations ["3. Route Optimization & Dispatch"]
        H[Dispatcher / Driver API Request] --> I["services/routeService.js"]
        I -->|1. Fetch Pickups| F
        I -->|2. Check 30-Bag Limit| J{Bags > 30?}
        J -->|Yes| K[Reschedule Overflow to Next Fri/Sat]
        K --> F
        K --> G
        J -->|No| L["Google Maps Distance Matrix"]
        L --> M["Nearest Neighbor Route Packing<br/>(Truck 1: max 15 bags, Truck 2: max 15 bags)"]
        M --> N["Set Event Colors in Calendar<br/>(Trip 1: Blue, Trip 2: Green)"]
        N --> G
        M --> O[Return Driver Manifest Manifest JSON]
    end
```

---

## 3. End-to-End Lifecycle: From Phone Call to Dispatch

### Phase 1: Inbound Call & Interactive Spanish Voice AI

The telephony flow is implemented as a multi-step state machine across Twilio webhooks in `services/voiceService.js`. Conversation state is tracked per call via `CallSid`.

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant Twilio as Twilio Voice Gateway
    participant Voice as voiceService.js
    participant Maps as Google Maps API
    participant Escalation as Human Operator

    Customer->>Twilio: Dials SACOSA phone number
    Twilio->>Voice: POST /voice/incoming (CallSid, From)
    Voice-->>Twilio: TwiML: <Say> "SACOSA recogida de sacos... ¿dirección exacta?" + <Gather speech>
    Twilio-->>Customer: Spoken greeting in Spanish
    
    Customer->>Twilio: Speaks address (e.g. "Calle Mayor 10 Alcalá de Henares")
    Twilio->>Voice: POST /voice/address-input (SpeechResult)
    Voice->>Maps: Geocode & validate components (street, number, city)
    
    alt Address outside service area (not Alcalá de Henares / Villalbilla)
        Voice-->>Twilio: TwiML: "Fuera de zona de servicio..." + <Dial> Escalation
        Twilio-->>Escalation: Forwards call to human agent
    else Valid & Serviceable
        Voice-->>Twilio: TwiML: "¿Es esta la dirección: [Formatted]? Sí o No" + <Gather>
        Twilio-->>Customer: Reads verified address
    end

    Customer->>Twilio: "Sí"
    Twilio->>Voice: POST /voice/confirmation (SpeechResult="Sí")
    Voice-->>Twilio: TwiML: "¿Cuántas sacas hay?" + <Gather>

    Customer->>Twilio: "Dos" / "3 sacas"
    Twilio->>Voice: POST /voice/bags (SpeechResult)
    Note over Voice: parseBags() converts Spanish words or digits to integer
    
    alt Bags > 15 (Large Order)
        Voice-->>Twilio: TwiML: "Cantidad muy grande..." + <Dial> Escalation
    else Bags <= 15
        Voice-->>Twilio: TwiML: "¿Están a pie de calle?" + <Gather>
    end

    Customer->>Twilio: "Sí" (or "No, en el patio")
    Twilio->>Voice: POST /voice/street (or /voice/location)
    Voice-->>Twilio: TwiML: "¿Hay algo que debamos saber antes de la recogida?" + <Gather>

    Customer->>Twilio: "El portal tiene código 1234" (or "No")
    Twilio->>Voice: POST /voice/notes-check / /voice/note
    Note over Voice: Trigger finalizePickup()
```

#### Detailed Breakdown of Voice Steps:

1. **`POST /voice/incoming`**:
   - Initialized with `CallSid` and caller phone number (`From`).
   - Speaks greeting using Amazon Polly: `Polly.Lucia-Neural` (voice: `es-ES`).
   - Opens a speech `<Gather>` with `speechTimeout="auto"` and `speechModel="phone_call"`.

2. **`POST /voice/address-input` & Address Validation (`services/addressValidation.js`)**:
   - Calls Google Maps Geocoding API with `language: es`, `region: es`.
   - **Validation checks**:
     - Result must contain a `street_number`.
     - Result must contain a `route` (street name).
     - Result must contain a `locality` or `postal_town`.
   - **Service Area Check**:
     - Must match allowed service areas: `["Alcalá de Henares", "Villalbilla"]`.
     - If outside the service area, the call is immediately forwarded to `ESCALATION_PHONE_NUMBER` via Twilio `<Dial>`.
   - Reads back the formatted address and asks the caller to confirm with "sí" or "no".

3. **`POST /voice/confirmation`**:
   - Checks if customer confirmed ("sí" / "si").
   - If "no": prompts the user to restate the address and re-enters the address input step.
   - If "yes": asks for the quantity of rubble bags (*"¿Cuántas sacas hay?"*).

4. **`POST /voice/bags`**:
   - Natural language Spanish parser (`parseBags`): converts words (`"uno"`, `"dos"`, `"cinco"`, etc.) and regex digits (`/\d+/`) into an integer.
   - **Safety Threshold**: If quantity $> 15$ bags, the system informs the caller that this requires special freight handling and transfers the call to a human agent.

5. **`POST /voice/street` & `POST /voice/location`**:
   - Asks if the bags are curbside (*a pie de calle*).
   - If not, asks the caller to state their exact location (e.g., driveway, garden, inner courtyard).

6. **`POST /voice/notes-check` & `POST /voice/note`**:
   - Inquires about access constraints, gates, or specific driver instructions.
   - Records the notes and initiates finalization.

---

### Phase 2: Intelligent Scheduling & Capacity Verification

Once the call data is collected, `finalizePickup()` invokes `getNextAvailableDate()` from `services/schedulerService.js`:

```mermaid
flowchart TD
    Start[Call getNextAvailableDate] --> Tomorrow[Set Date = Tomorrow in UTC]
    Tomorrow --> CheckDay{Is Day Friday or Saturday?<br/>dayOfWeek == 5 or 6}
    CheckDay -->|No| NextDay[Date = Date + 1 Day]
    NextDay --> CheckDay
    CheckDay -->|Yes| QueryDB[Query DB Pickups Count for Date]
    QueryDB --> QueryCal[Query Google Calendar Event Count for Date]
    QueryCal --> CapacityCheck{DB Count < 15<br/>AND<br/>Calendar Count < 15?}
    CapacityCheck -->|Yes| ReturnDate[Return Scheduled Date]
    CapacityCheck -->|No| NextDay
```

#### Core Business Rules for Scheduling:
1. **Operating Days Only**: Pickups are exclusively scheduled on **Fridays** (`dayOfWeek === 5`) and **Saturdays** (`dayOfWeek === 6`).
2. **Dual-Layer Capacity Check**:
   - Local database count for that UTC day must be $< 15$ (`DAILY_CAPACITY`).
   - Active Google Calendar event count for that day must also be $< 15$.
3. **Timezone Independence**: All date computations are performed in **UTC** to prevent daylight saving shifts and cross-day drift.

---

### Phase 3: Database Persistence & Google Calendar Sync

1. **Database Entry**:
   A new record is written to the `Pickup` table with:
   - `status`: `"SCHEDULED"`
   - `source`: `"AI_CALL"`
   - `attempts_count`: Number of speech attempts made by the caller
   - Full geocoded coordinates (`lat`, `lng`, `place_id`, `formatted_address`)
   - `bags` count and driver `notes`

2. **Google Calendar Event Creation (`services/calendarService.js`)**:
   - Authenticates using Google Service Account credentials.
   - Creates an all-day event in the `Europe/Madrid` timezone:
     - **Summary**: `Recogida de sacas SACOSA`
     - **Location**: `formatted_address`
     - **Description**: Contains Pickup UUID, address, customer phone number, bag count, street accessibility, driver notes, and a direct Google Maps navigation URL.
3. **Call Wrap-up**:
   - Voice agent says: *"Perfecto. Su recogida ha sido creada. Gracias."*
   - Hangs up the call and purges the in-memory session.

---

## 4. Backend Operations & Route Optimization Engine

The operations team accesses scheduled pickups and driver manifests via `GET /pickups?date=YYYY-MM-DD` and `GET /route?date=YYYY-MM-DD`. Both trigger `getRouteForDate()` in `services/routeService.js`.

### Capacity Constraints & Trip Model
- **Daily Limit**: 30 bags total per operating day (`MAX_DAILY_BAGS = 30`).
- **Truck Capacity**: 15 bags maximum per trip (`TRUCK_CAPACITY = 15`).
- **Daily Structure**: Maximum of 2 trips per day:
  - **Trip 1**: Departs from **Office / Depot** (`DEPOT_LAT`, `DEPOT_LNG`) $\rightarrow$ Pickup stops $\rightarrow$ Unloads at **Landfill** (`DROP_LAT`, `DROP_LNG`).
  - **Trip 2**: Departs from **Landfill** $\rightarrow$ Remaining pickup stops $\rightarrow$ Unloads at **Landfill**.

---

### Step-by-Step Route Optimization Algorithm

```mermaid
flowchart TD
    A[Fetch Pickups for Target Date] --> B[Check Daily Bag Capacity: Max 30 Bags]
    B --> C{Total Bags > 30?}
    C -->|Yes| D[Identify Overflow Pickups]
    D --> E[Move Overflow Pickups in PostgreSQL to Next Fri/Sat]
    E --> F[Update Corresponding Google Calendar Events to New Date]
    C -->|No| G[Group & Merge Pickups with Same Lat/Lng]
    F --> G
    G --> H[Compute Distance Matrix from Depot using Google Maps API]
    H --> I[Nearest Neighbor Trip Packing - Trip 1: max 15 bags]
    I --> J[Nearest Neighbor Trip Packing - Trip 2: max 15 bags]
    J --> K[Set Calendar Event Colors: Trip 1 = Blue, Trip 2 = Green]
    K --> L[Return Driver Manifest Manifest]
```

1. **Step 1 — Pickup Fetching**:
   Retrieves all pickups from PostgreSQL where `scheduled_date` falls within the target UTC date range.

2. **Step 2 & 3 — Daily Bag Limiting & Automatic Overflow**:
   - The algorithm iterates through pickups, accumulating `dailyBags`.
   - Any pickup that causes total bags to exceed 30 is flagged as **overflow**.
   - The helper `getNextFridayOrSaturday()` skips Sun–Thu and selects the next Friday or Saturday.
   - **Synchronous Two-Way Move**:
     - The pickup's `scheduled_date` in the database is updated to the new date.
     - `moveCalendarEvent()` searches Google Calendar for the event with matching `Pickup ID` and updates its start and end dates.

3. **Step 4 — Location Merging**:
   If multiple pickups have identical coordinates (`${lat}-${lng}`), they are consolidated into a single stop with the bag counts summed.

4. **Step 5 — Distance Matrix Calculation**:
   Calls Google Maps Distance Matrix API:
   - **Origin**: Depot coordinates (`DEPOT_LAT`, `DEPOT_LNG`).
   - **Destinations**: All pickup coordinates.

5. **Step 6 — Nearest Neighbor Routing (No Bag Splitting)**:
   - Pickups are not split across trucks; an entire pickup order stays within one trip.
   - **Trip 1**: Starting at the Depot, the algorithm iteratively searches for the closest pickup that will not exceed 15 bags, moves the truck to that pickup, and repeats until full or no more pickups fit. The truck then drives to the Landfill.
   - **Trip 2**: Starting at the Landfill, the truck repeats the process for any remaining pickups (up to 15 more bags) and returns to the Landfill.

6. **Step 7 — Google Calendar Color-Coding**:
   Once trips are resolved, the calendar events are updated with Google Calendar event colors so dispatchers have immediate visual confirmation:
   - **Trip 1 Events**: Color ID `"9"` (**Bold Blue**)
   - **Trip 2 Events**: Color ID `"2"` (**Sage / Green**)

---

## 5. Database Schema & State Model

Defined in `prisma/schema.prisma`:

```prisma
model Pickup {
  pickup_id         String   @id @default(uuid())
  created_at        DateTime @default(now())
  caller_phone      String
  raw_address_input String
  formatted_address String
  lat               Float
  lng               Float
  place_id          String
  scheduled_date    DateTime
  status            String
  attempts_count    Int
  source            String
  bags              Int?
  notes             String?
}
```

### Lifecycle Statuses:
- `SCHEDULED`: Successfully scheduled and booked into calendar (default state).
- `PENDING_CONFIRMATION`: Address captured but awaiting verbal confirmation.
- `COMPLETED`: Rubble bag has been collected by the driver.
- `ESCALATED`: Transferred to a human operator (e.g. outside zone or $> 15$ bags).
- `CANCELLED`: Order cancelled by customer or operator.

---

## 6. Complete API & Webhook Reference

### Voice Webhooks (Twilio Integration)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/voice/incoming` | Initial Twilio call entry point. Speaks Spanish greeting and opens speech recognition. |
| `POST` | `/voice/address-input` | Validates speech input via Google Maps. Checks service area and prompts confirmation. |
| `POST` | `/voice/confirmation` | Handles "sí"/"no" address confirmation. Advances to bag count or retries address. |
| `POST` | `/voice/bags` | Parses number of bags. Escalates if $> 15$, otherwise asks if curbside. |
| `POST` | `/voice/street` | Records curbside status ("sí"/"no"). If no, redirects to `/voice/location`. |
| `POST` | `/voice/location` | Captures specific location description if not on street. |
| `POST` | `/voice/notes-check` | Checks if caller has special instructions. |
| `POST` | `/voice/note` | Captures note text and finalizes scheduling and calendar event. |
| `POST` | `/voice/status` | Receives call completion/status events from Twilio. |

### Operational & Admin Endpoints
| Method | Endpoint | Description & Parameters |
| :--- | :--- | :--- |
| `POST` | `/test-pickup` | **Manual creation**: Body `{ "caller_phone": "+34...", "address_input": "...", "bags": 2 }`. Validates, schedules, and creates calendar event. |
| `GET` | `/pickups` | **Daily Manifest**: Query `?date=YYYY-MM-DD`. Runs route optimization, handles overflows, and returns pickup list and remaining capacity. |
| `GET` | `/route` | **Driver Routing**: Query `?date=YYYY-MM-DD`. Returns turn-by-turn trip stops (Office $\rightarrow$ Pickups $\rightarrow$ Landfill). |
| `GET` | `/` | Health check endpoint returning `"SACOSA Backend Running"`. |

---

## 7. Environment Variables & Configuration

Create a `.env` file in the project root with the following variables:

```env
# Server
PORT=3000
BASE_URL=https://your-ngrok-or-domain.com

# Database (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/sacosa?schema=public"

# Google Maps API
GOOGLE_MAPS_KEY=AIzaSy...

# Depot (Office) & Drop-off (Landfill) Geocoordinates
DEPOT_LAT=40.4819
DEPOT_LNG=-3.3635
DROP_LAT=40.4900
DROP_LNG=-3.3500

# Google Calendar Integration
CALENDAR_ID=your_calendar_id@group.calendar.google.com
GOOGLE_CREDS_JSON='{"type": "service_account", "project_id": "...", ...}'

# Twilio Voice
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+34910000000

# Escalation
ESCALATION_PHONE_NUMBER=+34600000000
```

---

## 8. Local Development, Testing & Verification Guide

### 1. Prerequisites & Database Setup
```bash
# 1. Install dependencies
npm install

# 2. Run PostgreSQL container (Docker)
docker run --name sacosa-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=sacosa -p 5432:5432 -d postgres:15

# 3. Apply Prisma migrations & generate client
npx prisma migrate dev
npx prisma generate
```

### 2. Running the Server
```bash
node app.js
```

### 3. Exposing Webhooks for Twilio Testing
```bash
ngrok http 3000
```
Update `BASE_URL` in `.env` with the HTTPS ngrok URL and configure your Twilio phone number's Voice Webhook to `https://<ngrok-url>/voice/incoming` (HTTP POST).

### 4. Running Included Test Scripts
- **Test Address Geocoding**:
  ```bash
  node testAddress.js "Calle Mayor 10 Alcalá de Henares"
  ```
- **Test Google Calendar Sync**:
  ```bash
  node testCalendar.js 2026-10-09
  ```
- **Test Route Optimization & Manifest**:
  ```bash
  node testRoute.js 2026-10-09
  ```
- **Simulate Twilio Voice Webhooks**:
  ```bash
  node testVoiceEndpoints.js
  ```
- **Manual Web Form**:
  Open `http://localhost:3000/manualPickup.html` in your browser to submit manual pickups.
