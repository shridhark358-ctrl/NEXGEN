import dotenv from "dotenv";
import { createCalendarEvent, getCalendarCount } from "./services/calendarService.js";

dotenv.config();

async function run() {
    try {
    const dateArg = process.argv[2];
    let dummyDate = new Date();
    if (dateArg) {
    dummyDate = new Date(dateArg);
    }

    const count = await getCalendarCount(dummyDate);
    console.log(`Events on ${dummyDate.toISOString().split("T")[0]}:`, count);

    const fakePickup = {
    pickup_id: "TEST123",
    formatted_address: "Calle Falsa 123 Madrid",
    scheduled_date: dummyDate.toISOString(),
    };

    const event = await createCalendarEvent(fakePickup);
    console.log("Created event:", event.htmlLink);
    } catch (err) {
    console.error("Calendar test error:", err);
    } finally {
    process.exit();
    }
}

run();