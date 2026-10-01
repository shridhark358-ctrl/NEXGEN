import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const CALENDAR_ID = process.env.CALENDAR_ID;

export const DAILY_CAPACITY = 15;

let authClient;
let calendar;

async function getAuthClient() {

  if (!authClient) {

    if (!process.env.GOOGLE_CREDS_JSON) {
      throw new Error("GOOGLE_CREDS_JSON environment variable not set");
    }

    const credentials = JSON.parse(process.env.GOOGLE_CREDS_JSON);

    authClient = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    calendar = google.calendar({
      version: "v3",
      auth: authClient,
    });

  }

  return authClient;

}

export async function getCalendarCount(date) {

  await getAuthClient();

  const timeMin = new Date(date);
  const timeMax = new Date(date);
  timeMax.setUTCDate(timeMax.getUTCDate() + 1);

  const resp = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    showDeleted: false,
  });

  const items = resp.data.items || [];
  return items.length;

}

export async function createCalendarEvent(
  pickup,
  notes = "",
  bags = "",
  street = "",
  location = "",
  allDay = true
) {

  await getAuthClient();

  const date = new Date(pickup.scheduled_date);
  const dateString = date.toISOString().split("T")[0];

  const eventBody = {
    summary: "Recogida de sacas SACOSA",

    location: pickup.formatted_address,

    description: `Pickup ID: ${pickup.pickup_id}

Dirección:
${pickup.formatted_address}

Teléfono del cliente:
${pickup.caller_phone}

Número de sacas:
${bags}

¿A pie de calle?:
${street}

Ubicación de las sacas:
${location || "A pie de calle"}

Notas del cliente:
${notes || "Sin notas"}
Mapa:
https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      pickup.formatted_address
    )}`,

    timeZone: "Europe/Madrid",
  };

  if (allDay) {
    eventBody.start = { date: dateString };
    eventBody.end = { date: dateString };
  } else {
    eventBody.start = { dateTime: date.toISOString() };
    eventBody.end = { dateTime: date.toISOString() };
  }

  const resp = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: eventBody,
  });

  return resp.data;

}

const TRIP_COLOR_IDS = {
  1: "9", // Blue
  2: "2", // Green
};

function getColorIdForTrip(tripNumber) {
  return TRIP_COLOR_IDS[tripNumber] || "1"; // Default to Lavender if unknown
}

export async function setCalendarEventColor(pickupId, tripNumber) {
  await getAuthClient();

  const colorId = getColorIdForTrip(tripNumber);

  const resp = await calendar.events.list({
    calendarId: CALENDAR_ID,
    q: `Pickup ID: ${pickupId}`,
    singleEvents: true,
    showDeleted: false,
  });

  const events = resp.data.items || [];

  if (events.length === 0) {
    return;
  }

  const event = events[0];

  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: event.id,
    requestBody: {
      colorId,
    },
  });

}

export async function moveCalendarEvent(pickupId, newDate) {

  await getAuthClient();

  const dateString = new Date(newDate).toISOString().split("T")[0];

  const resp = await calendar.events.list({
    calendarId: CALENDAR_ID,
    q: `Pickup ID: ${pickupId}`,
    singleEvents: true,
    showDeleted: false
  });

  const events = resp.data.items || [];

  if (events.length === 0) {
    return;
  }

  const event = events[0];

  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: event.id,
    requestBody: {
      start: { date: dateString },
      end: { date: dateString }
    }
  });

}