# SACOSA AI Pickup Management System

SACOSA sells rubble bags (*sacas de escombros*) used for construction and renovation waste in Spain (primary service areas: **Alcalá de Henares** and **Villalbilla**). 
Customers purchase a bag, place it at the street once full, and call the phone number on the bag to request pickup.

This project automates the entire pickup pipeline using **Twilio Voice AI with Amazon Polly Neural Spanish**, **Google Maps Address Validation & Geocoding**, **Dual-Capacity Friday/Saturday Scheduling**, **Nearest-Neighbor Route Optimization**, and **Google Calendar Integration with Trip Color-Coding**.

> 📖 **Full Technical Architecture & Deep Dive**: See the comprehensive [DOCUMENTATION.md](DOCUMENTATION.md) for end-to-end details from the phone call to the driver's route.

---

## Architecture Overview

```mermaid
flowchart TD
    A[Customer Phone Call] --> B[Twilio Voice Webhook<br/>Polly.Lucia-Neural Spanish]
    B --> C[Google Maps API<br/>Address Validation & Geocoding]
    C --> D[Scheduler Engine<br/>Friday & Saturday Rules]
    D --> E[(PostgreSQL / Prisma)]
    D --> F[Google Calendar API<br/>Pickup Event Creation]
    
    G[Operations / Driver] --> H[Route Optimization Engine<br/>Distance Matrix + Nearest Neighbor]
    H --> E
    H --> F
    H --> I[Driver Manifest Manifest<br/>Office → Pickups → Landfill]
```

---

## Key Features

1. **Autonomous Spanish Voice Assistant (`services/voiceService.js`)**:
   - Inbound call handling with natural speech recognition and Amazon Polly Neural Spanish voice.
   - Address collection and Google Maps geocoding.
   - Out-of-service area detection and automated transfer to human escalation.
   - Spoken double-confirmation flow ("sí" / "no").
   - Spoken bag count parsing (supports both digits and Spanish words like "dos", "cinco").
   - Large order escalation threshold ($> 15$ bags).
   - Inquires about curbside placement (*a pie de calle*) or custom location details, plus access notes.

2. **Smart Scheduling Engine (`services/schedulerService.js`)**:
   - Pickups are strictly scheduled for **Fridays and Saturdays**.
   - Dual capacity check: validates that both the local database count and Google Calendar count are under 15 pickups/day.
   - Calculates dates in UTC starting from tomorrow.

3. **Route Optimization & Overflow Management (`services/routeService.js`)**:
   - Daily cap of **30 bags max** across up to **2 truck trips** (truck capacity = 15 bags).
   - **Automatic Overflow Rescheduling**: When a day's pickups exceed 30 bags, excess orders are automatically rescheduled to the next available Friday/Saturday in both PostgreSQL and Google Calendar.
   - Merges multiple pickups at identical coordinates into single stops.
   - Uses Google Maps Distance Matrix to compute driving distances from the depot.
   - Packs trips using a **Nearest Neighbor** TSP heuristic:
     - **Trip 1**: Office (Depot) $\rightarrow$ Pickups $\rightarrow$ Landfill.
     - **Trip 2**: Landfill $\rightarrow$ Pickups $\rightarrow$ Landfill.
   - Visual Calendar color-coding: Trip 1 is color-coded **Blue** (`9`) and Trip 2 is color-coded **Green** (`2`).

4. **Google Calendar Synchronization (`services/calendarService.js`)**:
   - Authenticates using Google Service Account credentials.
   - Automatically creates detailed events including pickup ID, customer phone number, bag count, curbside location, driver notes, and a direct Google Maps navigation URL.
   - Dynamically moves events when overflow occurs and applies trip color tags.

---

## API Endpoints

### Voice Webhooks
- `POST /voice/incoming`: Initial call entry point.
- `POST /voice/address-input`: Speech capture and geocoding.
- `POST /voice/confirmation`: Address confirmation ("sí"/"no").
- `POST /voice/bags`: Bag quantity extraction and large order check.
- `POST /voice/street`: Curbside inquiry.
- `POST /voice/location`: Specific location capture.
- `POST /voice/notes-check`: Driver instructions inquiry.
- `POST /voice/note`: Note capture and pickup booking.
- `POST /voice/status`: Call status callbacks.

### Operations Endpoints
- `POST /test-pickup`: Manually create and schedule a pickup.
- `GET /pickups?date=YYYY-MM-DD`: View pickups and remaining capacity for a given date.
- `GET /route?date=YYYY-MM-DD`: Generate optimized driver route manifests.
- `GET /`: Health check.

---

## Local Development & Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Create a `.env` file with the required variables:
```env
PORT=3000
BASE_URL=https://your-domain-or-ngrok.com
DATABASE_URL="postgresql://user:password@localhost:5432/sacosa?schema=public"

GOOGLE_MAPS_KEY=AIzaSy...
DEPOT_LAT=40.4819
DEPOT_LNG=-3.3635
DROP_LAT=40.4900
DROP_LNG=-3.3500

CALENDAR_ID=your-calendar-id@group.calendar.google.com
GOOGLE_CREDS_JSON='{"type":"service_account",...}'

TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+34910000000
ESCALATION_PHONE_NUMBER=+34600000000
```

### 3. Database Migration
```bash
npx prisma migrate dev
```

### 4. Start Server
```bash
node app.js
```

### 5. Run Verification Scripts
- **Test Address Geocoding**: `node testAddress.js "Calle Mayor 10 Alcalá de Henares"`
- **Test Calendar**: `node testCalendar.js 2026-10-09`
- **Test Route Optimizer**: `node testRoute.js 2026-10-09`
- **Test Voice Endpoints**: `node testVoiceEndpoints.js`
- **Manual Web Form**: Open `http://localhost:3000/manualPickup.html`
