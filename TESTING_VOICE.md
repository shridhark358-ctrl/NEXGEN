# Testing Voice Service Integration

## Step 1: Install Dependencies

```bash
cd D:\sacossa\sacosa
npm install
```

This will install:
- `twilio` - For telephony
- `@deepgram/sdk` - For speech recognition (optional)
- All other existing dependencies

## Step 2: Configure Environment Variables

Add these to your `.env` file:

```env
# Existing variables
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sacosa?schema=public
GOOGLE_MAPS_KEY=your_google_maps_key
CALENDAR_ID=your_calendar_id
GOOGLE_CALENDAR_CREDENTIALS_PATH=D:\sacossa\sacosa\calender_service_account.json

# New Twilio variables
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
ESCALATION_PHONE_NUMBER=+1234567890

# Base URL for webhooks
# For local testing with ngrok:
BASE_URL=https://your-ngrok-url.ngrok.io
# For production:
# BASE_URL=https://your-domain.com

# Optional
DEEPGRAM_API_KEY=your_deepgram_key
```

## Step 3: Start Your Database

```bash
docker start sacosa-postgres
```

Or if the container doesn't exist:
```bash
docker run --name sacosa-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sacosa -p 5432:5432 -d postgres:16
```

## Step 4: Start the Server

```bash
node app.js
```

You should see:
```
Server running on port 3000
```

## Step 5: Set Up ngrok (for Local Testing)

Since Twilio needs to send webhooks to your server, you need a public URL. Use ngrok:

### Install ngrok:
1. Download from https://ngrok.com/download
2. Extract and add to PATH, or use full path

### Start ngrok:
```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding  https://abc123xyz.ngrok.io -> http://localhost:3000
```

### Update .env:
Copy the HTTPS URL and update:
```env
BASE_URL=https://abc123xyz.ngrok.io
```

**Important:** Restart your server after updating BASE_URL:
```bash
# Stop server (Ctrl+C), then:
node app.js
```

## Step 6: Configure Twilio Webhook

1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to: **Phone Numbers** → **Manage** → **Active Numbers**
3. Click on your Twilio phone number
4. Under **Voice & Fax** section:
   - **A CALL COMES IN**: Set to `https://abc123xyz.ngrok.io/voice/incoming`
   - Method: `HTTP POST`
5. Click **Save**

## Step 7: Test the Integration

### Option A: Unit Tests (No Real Call)

```bash
node testVoice.js
```

This will test:
- TwiML generation
- Conversation flow logic
- State management

### Option B: Test with Real Phone Call

1. **Call your Twilio phone number** from any phone
2. **Expected flow:**
   - System answers: "SACOSA rubble bag pickup, can you tell me the exact address where the bag is located?"
   - You say: "Calle Mayor 10 Madrid" (or any valid address)
   - System validates and says: "I found this address: [formatted address]. Can you confirm that the bag is exactly at this location?"
   - You say: "Yes"
   - System says: "Perfect. The pickup has been registered. Thank you."
   - Call ends

3. **Check the database:**
   ```bash
   # In another terminal, query the database or use your API:
   Invoke-RestMethod "http://localhost:3000/pickups?date=2026-03-07"
   ```

### Option C: Test Webhooks Directly (Advanced)

You can simulate Twilio webhooks using curl or Postman:

#### Test Incoming Call:
```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/voice/incoming" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "CallSid=TEST123&From=%2B34611111111"
```

#### Test Address Input:
```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/voice/address-input" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "CallSid=TEST123&From=%2B34611111111&SpeechResult=Calle%20Mayor%2010%20Madrid"
```

## Step 8: Verify Everything Works

### Check Server Logs

When you make a call, you should see in your server console:
- Webhook requests being received
- Address validation attempts
- Pickup creation (if confirmed)
- Any errors

### Check Database

Query recent pickups:
```powershell
# Get today's pickups
$today = Get-Date -Format "yyyy-MM-dd"
Invoke-RestMethod "http://localhost:3000/pickups?date=$today"
```

### Check Google Calendar

1. Open your Google Calendar
2. Navigate to the date when pickup was scheduled
3. You should see "SACOSA rubble bag pickup" event

### Check Schedule Overview

```powershell
Invoke-RestMethod "http://localhost:3000/schedule-overview"
```

## Troubleshooting

### Issue: "Cannot POST /voice/incoming"
- **Solution:** Make sure server is running on port 3000
- Check that `BASE_URL` in `.env` matches your ngrok URL
- Restart server after changing `.env`

### Issue: "No TwiML response"
- **Solution:** Check server logs for errors
- Verify Twilio webhook URL is correct
- Ensure ngrok is running

### Issue: "Address not found"
- **Solution:** Check `GOOGLE_MAPS_KEY` is set correctly
- Verify Geocoding API is enabled in Google Cloud Console
- Test address validation directly:
  ```bash
  node testAddress.js "Calle Mayor 10 Madrid"
  ```

### Issue: "Database connection error"
- **Solution:** Make sure PostgreSQL is running:
  ```bash
  docker ps | findstr sacosa-postgres
  ```
- Check `DATABASE_URL` in `.env`
- Run Prisma migrations:
  ```bash
  npx prisma migrate deploy
  ```

### Issue: "Call doesn't connect"
- **Solution:** 
  - Verify ngrok is running and URL is correct
  - Check Twilio webhook URL in console
  - Ensure server is accessible (test with browser: `http://localhost:3000/`)

### Issue: "Speech not recognized"
- **Solution:**
  - Speak clearly and slowly
  - Check call quality
  - Verify Twilio account has speech recognition enabled

## Testing Different Scenarios

### Scenario 1: Invalid Address
1. Call and say: "Some random place"
2. System should ask you to repeat the address

### Scenario 2: Incomplete Address
1. Call and say: "Madrid" (missing street number)
2. System should ask for complete address

### Scenario 3: Confirmation NO (First Time)
1. Provide valid address
2. When asked to confirm, say: "No"
3. System should restart address collection

### Scenario 4: Escalation (2 NOs)
1. Provide valid address
2. Say "No" to confirmation (first time)
3. Provide address again
4. Say "No" to confirmation (second time)
5. System should transfer to `ESCALATION_PHONE_NUMBER`

### Scenario 5: Successful Pickup
1. Provide valid address: "Calle Mayor 10 Madrid"
2. Confirm with "Yes"
3. Check database and calendar for new pickup

## Quick Test Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file configured with all variables
- [ ] Database running (`docker start sacosa-postgres`)
- [ ] Server running (`node app.js`)
- [ ] ngrok running (`ngrok http 3000`)
- [ ] `BASE_URL` in `.env` matches ngrok URL
- [ ] Twilio webhook configured
- [ ] Unit tests pass (`node testVoice.js`)
- [ ] Can make test call
- [ ] Pickup appears in database
- [ ] Calendar event created

## Next Steps

Once everything works:
1. Test all conversation flows
2. Monitor server logs for errors
3. Check database for correct data
4. Verify calendar events are created
5. Test escalation flow with real operator number
