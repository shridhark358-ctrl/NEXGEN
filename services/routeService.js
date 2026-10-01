import axios from "axios";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { moveCalendarEvent, setCalendarEventColor } from "./calendarService.js";

dotenv.config();

const prisma = new PrismaClient();

const DISTANCE_URL =
  "https://maps.googleapis.com/maps/api/distancematrix/json";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY;

const DEPOT_LAT = parseFloat(process.env.DEPOT_LAT);
const DEPOT_LNG = parseFloat(process.env.DEPOT_LNG);

const DROP_LAT = parseFloat(process.env.DROP_LAT);
const DROP_LNG = parseFloat(process.env.DROP_LNG);

const TRUCK_CAPACITY = 15;
const MAX_DAILY_BAGS = 30;

export async function getRouteForDate(dateString) {

  if (!dateString) {
    throw new Error("date-required");
  }

  const startOfDay = new Date(dateString);
  startOfDay.setUTCHours(0,0,0,0);

  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  /*
  STEP 1 — FETCH PICKUPS
  */

  const pickupsRaw = await prisma.pickup.findMany({
    where: {
      scheduled_date: {
        gte: startOfDay,
        lt: endOfDay
      }
    }
  });

  if (pickupsRaw.length === 0) {
    return {
      total_trips: 0,
      trips: []
    };
  }

  /*
  STEP 3 — LIMIT DAILY BAGS TO 30
  */

  let dailyBags = 0;
  const todaysPickupsRaw = [];
  const overflowPickups = [];

  for (const p of pickupsRaw) {

    const bags = p.bags || 1;

    if (dailyBags + bags <= MAX_DAILY_BAGS) {

      todaysPickupsRaw.push(p);
      dailyBags += bags;

    } else {

      overflowPickups.push(p);

    }

  }

  /*
  MOVE OVERFLOW TO NEXT AVAILABLE FRIDAY/SATURDAY

  If today fills up (e.g., Saturday), we must skip Sunday–Thursday and
  push the overflow to the next Friday (or Saturday) instead.
  */

  function getNextFridayOrSaturday(fromDate) {
    const d = new Date(fromDate);
    d.setUTCDate(d.getUTCDate() + 1);

    while (true) {
      const dow = d.getUTCDay();
      if (dow === 5 || dow === 6) {
        return d;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }

  const nextDay = getNextFridayOrSaturday(startOfDay);

  for (const p of overflowPickups) {

    await prisma.pickup.update({
      where: { pickup_id: p.pickup_id },
      data: {
        scheduled_date: nextDay
      }
    });

    try {
      await moveCalendarEvent(p.pickup_id, nextDay);
    } catch (err) {
      console.error("Failed to move calendar event", err);
    }

  }

  /*
  STEP 2 — MERGE SAME LOCATION PICKUPS
  */

  const mergedMap = {};

  for (const p of todaysPickupsRaw) {

    const key = `${p.lat}-${p.lng}`;

    if (!mergedMap[key]) {

      mergedMap[key] = {
        ...p,
        bags: p.bags || 1
      };

    } else {

      mergedMap[key].bags += p.bags || 1;

    }

  }

  const todaysPickups = Object.values(mergedMap);

  /*
  STEP 4 — DISTANCE CALCULATION
  */

  const origins = `${DEPOT_LAT},${DEPOT_LNG}`;

  const destinations = todaysPickups
    .map(p => `${p.lat},${p.lng}`)
    .join("|");

  const resp = await axios.get(DISTANCE_URL, {
    params: {
      origins,
      destinations,
      key: GOOGLE_MAPS_KEY,
      units: "metric"
    }
  });

  const elements =
    resp.data.rows &&
    resp.data.rows[0] &&
    resp.data.rows[0].elements
      ? resp.data.rows[0].elements
      : [];

  const withDistance = todaysPickups.map((p, idx) => {

    const el = elements[idx] || {};

    const dist =
      el.status === "OK" && el.distance
        ? el.distance.value
        : Number.POSITIVE_INFINITY;

    return {
      ...p,
      distance: dist
    };

  });

  /*
  STEP 5 — NEAREST NEIGHBOR ROUTING (NO SPLIT)
  */

  const remainingPickups = [...withDistance];
  const trips = [];

  let tripNumber = 1;

  let currentLocation = {
    lat: DEPOT_LAT,
    lng: DEPOT_LNG
  };

  while (remainingPickups.length > 0 && tripNumber <= 2) {

    let tripBags = 0;
    const tripStops = [];

    while (true) {

      let closestIndex = -1;
      let closestDistance = Infinity;

      for (let i = 0; i < remainingPickups.length; i++) {

        const p = remainingPickups[i];

        if (tripBags + p.bags > TRUCK_CAPACITY) continue;

        const dist =
          Math.pow(currentLocation.lat - p.lat, 2) +
          Math.pow(currentLocation.lng - p.lng, 2);

        if (dist < closestDistance) {
          closestDistance = dist;
          closestIndex = i;
        }

      }

      if (closestIndex === -1) break;

      const pickup = remainingPickups.splice(closestIndex, 1)[0];

      tripStops.push(pickup);
      tripBags += pickup.bags;

      currentLocation = {
        lat: pickup.lat,
        lng: pickup.lng
      };

      if (tripBags === TRUCK_CAPACITY) break;

    }

    trips.push({
      trip: tripNumber,
      bags: tripBags,
      pickups: tripStops
    });

    tripNumber++;

    currentLocation = {
      lat: DROP_LAT,
      lng: DROP_LNG
    };

  }

  /*
  STEP 7 — BUILD DRIVER ROUTES
  */

  const routes = trips
    .filter(t => t.pickups.length > 0)
    .map(trip => {

      const stops = [];

      if (trip.trip === 1) {

        stops.push({
          name: "Office",
          lat: DEPOT_LAT,
          lng: DEPOT_LNG
        });

      } else {

        stops.push({
          name: "Landfill",
          lat: DROP_LAT,
          lng: DROP_LNG
        });

      }

      trip.pickups.forEach(p => {

        stops.push({
          pickup_id: p.pickup_id,
          address: p.formatted_address,
          lat: p.lat,
          lng: p.lng,
          bags: p.bags
        });

      });

      stops.push({
        name: "Landfill",
        lat: DROP_LAT,
        lng: DROP_LNG
      });

      return {
        trip: trip.trip,
        total_bags: trip.bags,
        stops
      };

    });

  /*
   * Color-code the calendar events by trip so the calendar view is easier to read.
   * Trip 1 = blue, Trip 2 = green.
   */
  for (const trip of trips) {
    for (const pickup of trip.pickups) {
      try {
        await setCalendarEventColor(pickup.pickup_id, trip.trip);
      } catch (err) {
        console.error("Failed to set calendar event color", err);
      }
    }
  }

  return {
    total_trips: routes.length,
    scheduled_bags: dailyBags,
    overflow_bags: overflowPickups.reduce((s,p)=>s+p.bags,0),
    trips: routes
  };

}