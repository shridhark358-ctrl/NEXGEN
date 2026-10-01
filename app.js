import express from "express";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

import { getNextAvailableDate } from "./services/schedulerService.js";
import { validateAddress } from "./services/addressValidation.js";
import { getRouteForDate } from "./services/routeService.js";
import { createCalendarEvent } from "./services/calendarService.js";

import {
  handleIncomingCall,
  handleAddressInput,
  handleConfirmation,
  handleBags,
  handleStreet,
  handleLocation,
  handleNotesCheck,
  handleNote,
  handleCallStatus
} from "./services/voiceService.js";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("SACOSA Backend Running");
});

/*
TEST PICKUP CREATION
*/

app.post("/test-pickup", async (req, res) => {

  try {

    const { caller_phone, address_input, bags } = req.body;

    if (!caller_phone || !address_input) {
      return res.status(400).json({
        error: "caller_phone and address_input are required",
      });
    }

    const validated = await validateAddress(address_input);
    const scheduledDate = await getNextAvailableDate();

    const pickup = await prisma.pickup.create({
      data: {
        caller_phone,
        raw_address_input: address_input,
        formatted_address: validated.formatted_address,
        lat: validated.lat,
        lng: validated.lng,
        place_id: validated.place_id,
        scheduled_date: scheduledDate,
        status: "SCHEDULED",
        attempts_count: 1,
        source: "AI_CALL",
        bags: bags || 1
      },
    });

    try {
      await createCalendarEvent(pickup);
    } catch (evtErr) {
      console.error("failed to create calendar event", evtErr);
    }

    res.status(200).json(pickup);

  } catch (error) {

    console.error("Error creating pickup:", error);
    res.status(500).json({ error: "Internal server error" });

  }

});

/*
CALENDAR / PICKUPS VIEW
IMPORTANT: run route optimizer first
*/

app.get("/pickups", async (req, res) => {

  try {

    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        error: "Please provide a date in format YYYY-MM-DD",
      });
    }

    await getRouteForDate(date);

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const pickups = await prisma.pickup.findMany({
      where: {
        scheduled_date: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      orderBy: {
        created_at: "asc",
      },
    });

    const totalBags = pickups.reduce((sum, p) => sum + (p.bags || 1), 0);

    res.json({
      date,
      total_pickups: pickups.length,
      total_bags: totalBags,
      remaining_capacity: Math.max(0, 30 - totalBags),
      pickups,
    });

  } catch (error) {

    console.error("Error fetching pickups:", error);
    res.status(500).json({ error: "Internal server error" });

  }

});

/*
ROUTE ENDPOINT
*/

app.get("/route", async (req, res) => {

  try {

    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        error: "date query parameter required (YYYY-MM-DD)",
      });
    }

    const route = await getRouteForDate(date);

    return res.status(200).json(route);

  } catch (err) {

    console.error("Error computing route:", err);
    res.status(500).json({ error: "Internal server error" });

  }

});

/*
VOICE WEBHOOKS
*/

app.post("/voice/incoming", handleIncomingCall);
app.post("/voice/address-input", handleAddressInput);
app.post("/voice/confirmation", handleConfirmation);

app.post("/voice/bags", handleBags);
app.post("/voice/street", handleStreet);
app.post("/voice/location", handleLocation);

app.post("/voice/notes-check", handleNotesCheck);
app.post("/voice/note", handleNote);

app.post("/voice/status", handleCallStatus);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});