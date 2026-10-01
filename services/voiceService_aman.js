import twilio from "twilio";
import { createClient } from "@deepgram/sdk";
import dotenv from "dotenv";
import { validateAddress } from "./addressValidation.js";
import { getNextAvailableDate } from "./schedulerService.js";
import { createCalendarEvent } from "./calendarService.js";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const VoiceResponse = twilio.twiml.VoiceResponse;

// Environment variables
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ESCALATION_PHONE_NUMBER = process.env.ESCALATION_PHONE_NUMBER || "+1234567890";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Conversation states
const STATE = {
  INITIAL: "INITIAL",
  COLLECTING_ADDRESS: "COLLECTING_ADDRESS",
  VALIDATING_ADDRESS: "VALIDATING_ADDRESS",
  CONFIRMING_ADDRESS: "CONFIRMING_ADDRESS",
  CONFIRMED: "CONFIRMED",
  ESCALATED: "ESCALATED",
};

// In-memory conversation state (in production, use Redis or database)
const conversationState = new Map();

/**
 * Initialize Deepgram client
 */
function getDeepgramClient() {
  if (!DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY not configured");
  }
  return createClient(DEEPGRAM_API_KEY);
}

/**
 * Get or create conversation state
 */
function getConversationState(callSid) {
  if (!conversationState.has(callSid)) {
    conversationState.set(callSid, {
      state: STATE.INITIAL,
      addressAttempts: [],
      confirmationAttempts: 0,
      validatedAddress: null,
      callerPhone: null,
    });
  }
  return conversationState.get(callSid);
}

/**
 * Clear conversation state
 */
function clearConversationState(callSid) {
  conversationState.delete(callSid);
}

/**
 * Handle incoming Twilio call - initial webhook
 */
export function handleIncomingCall(req, res) {
  const callSid = req.body.CallSid;
  const callerPhone = req.body.From;

  const state = getConversationState(callSid);
  state.callerPhone = callerPhone;
  state.state = STATE.INITIAL;

  const twiml = new VoiceResponse();

  // Mandatory opening message
  twiml.say(
    {
      voice: "alice",
      language: "en-US",
    },
    "SACOSA rubble bag pickup, can you tell me the exact address where the bag is located?"
  );

  // Start gathering user input with Deepgram
  const gather = twiml.gather({
    input: "speech",
    speechTimeout: "auto",
    action: `${BASE_URL}/voice/address-input`,
    method: "POST",
    speechModel: "phone_call",
    language: "en-US",
  });

  // Fallback if no input
  gather.say(
    {
      voice: "alice",
      language: "en-US",
    },
    "I didn't hear that. Please tell me the exact address where the bag is located."
  );

  // Redirect to same endpoint if gather times out
  twiml.redirect(`${BASE_URL}/voice/address-input`);

  res.type("text/xml");
  res.send(twiml.toString());
}

/**
 * Handle address input from user
 */
export async function handleAddressInput(req, res) {
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || "";
  const state = getConversationState(callSid);

  const twiml = new VoiceResponse();

  if (!speechResult || speechResult.trim().length === 0) {
    // No address provided, ask again
    twiml.say(
      {
        voice: "alice",
        language: "en-US",
      },
      "I need a complete address with street number, street name, and city. Please tell me the exact address where the bag is located."
    );

    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: `${BASE_URL}/voice/address-input`,
      method: "POST",
      speechModel: "phone_call",
      language: "en-US",
    });

    twiml.redirect(`${BASE_URL}/voice/address-input`);
    res.type("text/xml");
    res.send(twiml.toString());
    return;
  }

  // Store the address attempt
  state.addressAttempts.push(speechResult);
  state.state = STATE.VALIDATING_ADDRESS;

  // Validate address with Google Maps
  try {
    const validated = await validateAddress(speechResult);

    // Address is valid, proceed to confirmation
    state.validatedAddress = validated;
    state.state = STATE.CONFIRMING_ADDRESS;

    // Read back the address and ask for confirmation
    twiml.say(
      {
        voice: "alice",
        language: "en-US",
      },
      `I found this address: ${validated.formatted_address}. Can you confirm that the bag is exactly at this location?`
    );

    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: `${BASE_URL}/voice/confirmation`,
      method: "POST",
      speechModel: "phone_call",
      language: "en-US",
    });

    twiml.redirect(`${BASE_URL}/voice/confirmation`);
  } catch (validationError) {
    // Address validation failed
    const errorMsg = validationError.message;

    if (errorMsg === "no-result") {
      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "I couldn't find that address. Please provide a complete address with street number, street name, and city."
      );
    } else if (errorMsg === "incomplete-address") {
      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "The address must include a street number, street name, and city. Please provide the complete address."
      );
    } else {
      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "There was an error validating the address. Please try again with a complete address."
      );
    }

    // Ask for address again
    state.state = STATE.COLLECTING_ADDRESS;
    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: `${BASE_URL}/voice/address-input`,
      method: "POST",
      speechModel: "phone_call",
      language: "en-US",
    });

    twiml.redirect(`${BASE_URL}/voice/address-input`);
  }

  res.type("text/xml");
  res.send(twiml.toString());
}

/**
 * Handle confirmation response
 */
export async function handleConfirmation(req, res) {
  const callSid = req.body.CallSid;
  const speechResult = (req.body.SpeechResult || "").toLowerCase().trim();
  const state = getConversationState(callSid);

  const twiml = new VoiceResponse();

  // Check if user confirmed (YES) or denied (NO)
  const isYes = speechResult.includes("yes") || speechResult.includes("correct") || speechResult === "y";
  const isNo = speechResult.includes("no") || speechResult === "n" || speechResult.includes("wrong") || speechResult.includes("incorrect");

  if (isYes && state.validatedAddress) {
    // Confirmation successful - create pickup
    state.state = STATE.CONFIRMED;

    try {
      const scheduledDate = await getNextAvailableDate();

      const pickup = await prisma.pickup.create({
        data: {
          caller_phone: state.callerPhone,
          raw_address_input: state.addressAttempts[state.addressAttempts.length - 1],
          formatted_address: state.validatedAddress.formatted_address,
          lat: state.validatedAddress.lat,
          lng: state.validatedAddress.lng,
          place_id: state.validatedAddress.place_id,
          scheduled_date: scheduledDate,
          status: "SCHEDULED",
          attempts_count: state.addressAttempts.length,
          source: "AI_CALL",
        },
      });

      // Create calendar event (best effort)
      try {
        await createCalendarEvent(pickup);
      } catch (evtErr) {
        console.error("Failed to create calendar event", evtErr);
      }

      // Success message and end call
      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "Perfect. The pickup has been registered. Thank you."
      );

      twiml.hangup();
      clearConversationState(callSid);
    } catch (error) {
      console.error("Error creating pickup:", error);
      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "I'm sorry, there was an error processing your request. Please call back later."
      );
      twiml.hangup();
      clearConversationState(callSid);
    }
  } else if (isNo) {
    // User denied - increment confirmation attempts
    state.confirmationAttempts++;

    if (state.confirmationAttempts >= 2) {
      // Escalate to human operator
      state.state = STATE.ESCALATED;

      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "I'll transfer you to a human operator now."
      );

      twiml.dial(ESCALATION_PHONE_NUMBER);
      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "The call could not be completed. Please call back later."
      );

      twiml.hangup();
      clearConversationState(callSid);
    } else {
      // Restart address capture
      state.state = STATE.COLLECTING_ADDRESS;
      state.validatedAddress = null;

      twiml.say(
        {
          voice: "alice",
          language: "en-US",
        },
        "Let me get the address again. Please tell me the exact address where the bag is located."
      );

      const gather = twiml.gather({
        input: "speech",
        speechTimeout: "auto",
        action: `${BASE_URL}/voice/address-input`,
        method: "POST",
        speechModel: "phone_call",
        language: "en-US",
      });

      twiml.redirect(`${BASE_URL}/voice/address-input`);
    }
  } else {
    // Unclear response - ask again
    twiml.say(
      {
        voice: "alice",
        language: "en-US",
      },
      `I found this address: ${state.validatedAddress.formatted_address}. Can you confirm that the bag is exactly at this location? Please say yes or no.`
    );

    const gather = twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      action: `${BASE_URL}/voice/confirmation`,
      method: "POST",
      speechModel: "phone_call",
      language: "en-US",
    });

    twiml.redirect(`${BASE_URL}/voice/confirmation`);
  }

  res.type("text/xml");
  res.send(twiml.toString());
}

/**
 * Handle call status updates (optional, for logging)
 */
export function handleCallStatus(req, res) {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;

  console.log(`Call ${callSid} status: ${callStatus}`);

  // Clean up state if call ended
  if (callStatus === "completed" || callStatus === "failed" || callStatus === "busy" || callStatus === "no-answer") {
    clearConversationState(callSid);
  }

  res.status(200).send("OK");
}
