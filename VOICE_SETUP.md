# Twilio + Deepgram Voice Integration Setup

## Overview

The voice service (`services/voiceService.js`) integrates Twilio for telephony and Deepgram for advanced speech recognition (available for future use). The system implements a complete conversation flow for automated pickup scheduling via phone calls.

## Conversation Flow

1. **Initial Call** → Mandatory opening message
2. **Address Collection** → User provides address
3. **Google Maps Validation** → Address is validated
4. **Double Confirmation** → Address read back, user confirms
5. **Pickup Creation** → If confirmed, pickup is scheduled
6. **Escalation** → After 2 "NO" responses, call is transferred to human operator

## Environment Variables

Add these to your `.env` file:

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Deepgram (optional, for advanced transcription)
DEEPGRAM_API_KEY=your_deepgram_api_key

# Escalation
ESCALATION_PHONE_NUMBER=+1234567890

# Base URL (for webhook callbacks)
BASE_URL=https://your-domain.com
# or for local testing with ngrok:
# BASE_URL=https://your-ngrok-url.ngrok.io
```

## API Endpoints

### POST `/voice/incoming`
Handles incoming Twilio calls. This is the webhook URL you configure in Twilio.

**Twilio Configuration:**
- In Twilio Console → Phone Numbers → Configure your number
- Set "Voice & Fax" webhook URL to: `https://your-domain.com/voice/incoming`
- Method: POST

### POST `/voice/address-input`
Handles address input from the user during the call.

### POST `/voice/confirmation`
Handles confirmation responses (YES/NO) from the user.

### POST `/voice/status`
Optional webhook for call status updates (for logging).

## Testing Locally

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up ngrok (for local webhook testing)

```bash
# Install ngrok: https://ngrok.com/
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`) and set in `.env`:
```env
BASE_URL=https://abc123.ngrok.io
```

### 3. Configure Twilio Webhook

In Twilio Console:
- Phone Numbers → Manage → Active Numbers → Your Number
- Under "Voice & Fax", set webhook URL to: `https://abc123.ngrok.io/voice/incoming`
- Save

### 4. Run Tests

```bash
node testVoice.js
```

### 5. Test with Real Call

Call your Twilio phone number. The system will:
1. Answer with the opening message
2. Collect your address
3. Validate it with Google Maps
4. Read it back and ask for confirmation
5. Create a pickup if confirmed

## Conversation States

- `INITIAL`: Call just started
- `COLLECTING_ADDRESS`: Waiting for user to provide address
- `VALIDATING_ADDRESS`: Validating address with Google Maps
- `CONFIRMING_ADDRESS`: Reading back address and waiting for confirmation
- `CONFIRMED`: User confirmed, pickup created
- `ESCALATED`: Transferred to human operator

## State Management

Currently uses in-memory `Map` for conversation state. For production:
- Use Redis for distributed systems
- Use database for persistence
- Implement TTL for cleanup

## Error Handling

- **Invalid Address**: System asks user to provide complete address again
- **Google Maps Error**: System prompts user to try again
- **Database Error**: System apologizes and asks user to call back
- **2 NO Confirmations**: Automatic escalation to human operator

## Speech Recognition

Currently uses **Twilio's built-in speech recognition** via the `<Gather>` verb with `input="speech"`. This is sufficient for the use case.

**Deepgram SDK** is included and available for:
- More advanced transcription
- Real-time streaming transcription
- Custom language models
- Higher accuracy requirements

To use Deepgram instead, you would need to:
1. Set up Deepgram streaming
2. Modify the webhook to use Deepgram's transcription
3. Process the transcription results

## Requirements Checklist

- [x] Mandatory opening message
- [x] Address capture (street, number, city)
- [x] Google Maps validation
- [x] Double verbal confirmation
- [x] Escalation after 2 NO responses
- [x] Pickup creation on confirmation
- [x] Calendar event creation
- [x] Attempt counter tracking

## Troubleshooting

### Calls not connecting
- Check `BASE_URL` is correct and accessible
- Verify Twilio webhook URL is set correctly
- Check ngrok is running (if testing locally)

### Speech not recognized
- Ensure good call quality
- Check Twilio account has speech recognition enabled
- Verify language settings in TwiML

### Address validation failing
- Check `GOOGLE_MAPS_KEY` is set and valid
- Verify Geocoding API is enabled in Google Cloud
- Check address format requirements

### Escalation not working
- Verify `ESCALATION_PHONE_NUMBER` is set correctly
- Check Twilio account has dial permissions
- Ensure the number is in E.164 format (+1234567890)
