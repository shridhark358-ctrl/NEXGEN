import dotenv from "dotenv";
import { getRouteForDate } from "./services/routeService.js";

dotenv.config();

async function run() {
    try {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];
    const route = await getRouteForDate(date);
    console.log(`Route for ${date}:`, JSON.stringify(route, null, 2));
    } catch (err) {
    console.error("Error:", err.message);
    } finally {
    process.exit();
    
}
}
run();
