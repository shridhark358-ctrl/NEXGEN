import dotenv from "dotenv";
import { validateAddress } from "./services/addressValidation.js";

dotenv.config();

async function run() {
try {
    const raw = process.argv[2] || "Calle Mayor 10 Madrid";
    const result = await validateAddress(raw);
    console.log("Validation success:", result);
} catch (err) {
    console.error("Validation error:", err.message);
} finally {
    process.exit();
}
}

run();
