import { PrismaClient } from "@prisma/client";
import { getCalendarCount, DAILY_CAPACITY } from "./calendarService.js";

const prisma = new PrismaClient();

export async function getNextAvailableDate() {
  // Always use UTC to avoid timezone issues
  let date = new Date();

  // Start checking from tomorrow
  date = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0, 0, 0, 0
  ));

  while (true) {
    // 1. Check if the day is Friday (5) or Saturday (6)
    const dayOfWeek = date.getUTCDay();
    const isFridayOrSaturday = (dayOfWeek === 5 || dayOfWeek === 6);

    if (isFridayOrSaturday) {
      // 2. Count how many pickups are already scheduled for this date in our DB
      const count = await prisma.pickup.count({
        where: {
          scheduled_date: {
            gte: new Date(date),
            lt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      });

      // 3. Check Google Calendar capacity
      let calCount = 0;
      try {
        calCount = await getCalendarCount(date);
      } catch (e) {
        console.warn("failed to fetch calendar count", e.message);
      }

      // 4. If both counts are below capacity, return this date
      if (count < DAILY_CAPACITY && calCount < DAILY_CAPACITY) {
        return date;
      }
    }

    // Move to next day and check again
    date.setUTCDate(date.getUTCDate() + 1);
  }
}