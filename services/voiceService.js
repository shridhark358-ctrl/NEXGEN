import twilio from "twilio";
import dotenv from "dotenv";
import { validateAddress } from "./addressValidation.js";
import { getNextAvailableDate } from "./schedulerService.js";
import { createCalendarEvent } from "./calendarService.js";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const VoiceResponse = twilio.twiml.VoiceResponse;

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const VOICE_CONFIG = {
  voice: "Polly.Lucia-Neural",
  language: "es-ES",
};

const STATE = {
  INITIAL: "INITIAL",
  COLLECTING_ADDRESS: "COLLECTING_ADDRESS",
  CONFIRMING_ADDRESS: "CONFIRMING_ADDRESS",
  COLLECTING_BAGS: "COLLECTING_BAGS",
  COLLECTING_STREET: "COLLECTING_STREET",
  COLLECTING_LOCATION: "COLLECTING_LOCATION",
  ASKING_NOTES: "ASKING_NOTES",
  COLLECTING_NOTE: "COLLECTING_NOTE",
};

const conversationState = new Map();

/**
 * Utility to convert spoken Spanish numbers or strings to Integers
 */
function parseBags(input) {
  const text = input.toLowerCase();
  const numberMap = {
    "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
    "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15
  };

  const match = text.match(/\d+/);
  if (match) return parseInt(match[0], 10);

  for (let key in numberMap) {
    if (text.includes(key)) return numberMap[key];
  }

  return 1; 
}

function getConversationState(callSid) {
  if (!conversationState.has(callSid)) {
    conversationState.set(callSid, {
      addressAttempts: [],
      validatedAddress: null,
      callerPhone: null,
      notes: null,
      bags: null,
      street: null,
      location: null,
    });
  }
  return conversationState.get(callSid);
}

function clearConversationState(callSid) {
  conversationState.delete(callSid);
}

export function handleIncomingCall(req, res) {

  const callSid = req.body.CallSid;
  const callerPhone = req.body.From;

  const state = getConversationState(callSid);
  state.callerPhone = callerPhone;

  const twiml = new VoiceResponse();

  twiml.say(
    VOICE_CONFIG,
    "SACOSA recogida de sacos de escombros. ¿Puede decirme la dirección exacta donde está el saco?"
  );

  twiml.gather({
    input: "speech",
    speechTimeout: "auto",
    speechModel: "phone_call",
    action: `${BASE_URL}/voice/address-input`,
    method: "POST",
    language: "es-ES",
  });

  res.type("text/xml");
  res.send(twiml.toString());
}

export async function handleAddressInput(req, res) {

  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || "";
  const state = getConversationState(callSid);

  const twiml = new VoiceResponse();

  state.addressAttempts.push(speechResult);

  try {

    const validated = await validateAddress(speechResult);
    state.validatedAddress = validated;

    // SERVICE AREA CHECK
    if (!validated.serviceable) {

      twiml.say(
        VOICE_CONFIG,
        "Lo siento, esta dirección parece estar fuera de nuestra zona de servicio. Voy a transferirle a un agente."
      );

      const dial = twiml.dial({
        timeout: 20,
        callerId: process.env.TWILIO_PHONE_NUMBER,
      });

      dial.number(process.env.ESCALATION_PHONE_NUMBER);

      clearConversationState(callSid);

      res.type("text/xml");
      res.send(twiml.toString());
      return;
    }

    twiml.say(
      VOICE_CONFIG,
      `¿Es esta la dirección: ${validated.formatted_address}? Por favor diga sí o no.`
    );

    twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      speechModel: "phone_call",
      action: `${BASE_URL}/voice/confirmation`,
      method: "POST",
      language: "es-ES",
    });

  } catch (err) {

    twiml.say(
      VOICE_CONFIG,
      "No pude validar esa dirección. Por favor repita la dirección completa."
    );

    twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      speechModel: "phone_call",
      action: `${BASE_URL}/voice/address-input`,
      method: "POST",
      language: "es-ES",
    });
  }

  res.type("text/xml");
  res.send(twiml.toString());
}

export async function handleConfirmation(req, res) {

  const callSid = req.body.CallSid;
  const speechResult = (req.body.SpeechResult || "").toLowerCase();

  const state = getConversationState(callSid);
  const twiml = new VoiceResponse();

  if (speechResult.includes("sí") || speechResult.includes("si")) {

    twiml.say(VOICE_CONFIG, "¿Cuántas sacas hay?");

    twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      speechModel: "phone_call",
      action: `${BASE_URL}/voice/bags`,
      method: "POST",
      language: "es-ES",
    });

  } else {

    twiml.say(VOICE_CONFIG, "Dígame la dirección otra vez.");

    twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      speechModel: "phone_call",
      action: `${BASE_URL}/voice/address-input`,
      method: "POST",
      language: "es-ES",
    });
  }

  res.type("text/xml");
  res.send(twiml.toString());
}

export async function handleBags(req, res) {

  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || "";

  const state = getConversationState(callSid);
  
  const bagCount = parseBags(speechResult);
  state.bags = bagCount;

  const twiml = new VoiceResponse();

  if (bagCount > 15) {
    twiml.say(VOICE_CONFIG, "Esa es una cantidad muy grande. Voy a transferirle a un agente para gestionar esta recogida especial.");
    
    const dial = twiml.dial({
      timeout: 20,
      callerId: process.env.TWILIO_PHONE_NUMBER,
    });
    dial.number(process.env.ESCALATION_PHONE_NUMBER);
    
    clearConversationState(callSid);
  } else {
    twiml.say(
      VOICE_CONFIG,
      "¿Las sacas están a pie de calle? Si no, por favor díganos dónde están."
    );

    twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      speechModel: "phone_call",
      action: `${BASE_URL}/voice/street`,
      method: "POST",
      language: "es-ES",
    });
  }

  res.type("text/xml");
  res.send(twiml.toString());
}

export async function handleStreet(req, res) {

  const callSid = req.body.CallSid;
  const speechResult = (req.body.SpeechResult || "").toLowerCase();

  const state = getConversationState(callSid);
  const twiml = new VoiceResponse();

  if (speechResult.includes("sí") || speechResult.includes("si")) {

    state.street = "Si";
    askNotes(twiml);

  } else {

    state.street = "No";

    twiml.say(
      VOICE_CONFIG,
      "Por favor díganos dónde están."
    );

    twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      speechModel: "phone_call",
      action: `${BASE_URL}/voice/location`,
      method: "POST",
      language: "es-ES",
    });
  }

  res.type("text/xml");
  res.send(twiml.toString());
}

export async function handleLocation(req, res) {

  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || "";

  const state = getConversationState(callSid);
  state.location = speechResult;

  const twiml = new VoiceResponse();

  askNotes(twiml);

  res.type("text/xml");
  res.send(twiml.toString());
}

function askNotes(twiml) {

  twiml.say(
    VOICE_CONFIG,
    "¿Hay algo que debamos saber antes de la recogida? Por favor responda sí o no."
  );

  twiml.gather({
    input: "speech",
    speechTimeout: "auto",
    speechModel: "phone_call",
    action: `${BASE_URL}/voice/notes-check`,
    method: "POST",
    language: "es-ES",
  });
}

export async function handleNotesCheck(req, res) {

  const callSid = req.body.CallSid;
  const speechResult = (req.body.SpeechResult || "").toLowerCase();

  const state = getConversationState(callSid);
  const twiml = new VoiceResponse();

  if (speechResult.includes("sí") || speechResult.includes("si")) {

    twiml.say(VOICE_CONFIG, "Por favor díganos qué debemos saber.");

    twiml.gather({
      input: "speech",
      speechTimeout: "auto",
      speechModel: "phone_call",
      action: `${BASE_URL}/voice/note`,
      method: "POST",
      language: "es-ES",
    });

  } else {

    state.notes = "Sin notas";
    await finalizePickup(state, twiml, callSid);
  }

  res.type("text/xml");
  res.send(twiml.toString());
}

export async function handleNote(req, res) {

  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || "";

  const state = getConversationState(callSid);
  state.notes = speechResult;

  const twiml = new VoiceResponse();

  await finalizePickup(state, twiml, callSid);

  res.type("text/xml");
  res.send(twiml.toString());
}

async function finalizePickup(state, twiml, callSid) {

  try {

    const scheduledDate = await getNextAvailableDate();

    const pickup = await prisma.pickup.create({
      data: {
        caller_phone: state.callerPhone,
        raw_address_input: state.addressAttempts.slice(-1)[0],
        formatted_address: state.validatedAddress.formatted_address,
        lat: state.validatedAddress.lat,
        lng: state.validatedAddress.lng,
        place_id: state.validatedAddress.place_id,
        scheduled_date: scheduledDate,
        status: "SCHEDULED",
        attempts_count: state.addressAttempts.length,
        source: "AI_CALL",
        bags: state.bags,
        notes: state.notes
      },
    });

    await createCalendarEvent(
      pickup,
      state.notes,
      state.bags,
      state.street,
      state.location
    );

    twiml.say(
      VOICE_CONFIG,
      "Perfecto. Su recogida ha sido creada. Gracias."
    );

  } catch (err) {

    console.error(err);

    twiml.say(
      VOICE_CONFIG,
      "Hubo un error procesando la solicitud."
    );
  }

  twiml.hangup();
  clearConversationState(callSid);
}

export function handleCallStatus(req, res) {

  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;

  console.log(`Call ${callSid} status: ${callStatus}`);

  res.status(200).send("OK");
}