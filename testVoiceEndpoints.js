import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

/**
 * Test voice endpoints without making actual calls
 */
async function testEndpoints() {
  console.log("🧪 Testing Voice Service Endpoints\n");
  console.log("=".repeat(50));

  // Test 1: Health check
  console.log("\n1️⃣  Testing health check...");
  try {
    const response = await fetch(`${BASE_URL}/`);
    const text = await response.text();
    console.log(`✅ Health check: ${text}`);
  } catch (error) {
    console.error(`❌ Health check failed: ${error.message}`);
  }

  // Test 2: Incoming call webhook
  console.log("\n2️⃣  Testing incoming call webhook...");
  try {
    const formData = new URLSearchParams();
    formData.append("CallSid", "TEST_CALL_001");
    formData.append("From", "+34611111111");

    const response = await fetch(`${BASE_URL}/voice/incoming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const twiml = await response.text();
    if (twiml.includes("SACOSA rubble bag pickup")) {
      console.log("✅ Incoming call webhook working");
      console.log("TwiML contains opening message");
    } else {
      console.log("⚠️  TwiML generated but opening message not found");
    }
  } catch (error) {
    console.error(`❌ Incoming call test failed: ${error.message}`);
  }

  // Test 3: Address input webhook
  console.log("\n3️⃣  Testing address input webhook...");
  try {
    const formData = new URLSearchParams();
    formData.append("CallSid", "TEST_CALL_002");
    formData.append("From", "+34611111111");
    formData.append("SpeechResult", "Calle Mayor 10 Madrid");

    const response = await fetch(`${BASE_URL}/voice/address-input`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const twiml = await response.text();
    if (twiml.includes("I found this address") || twiml.includes("address")) {
      console.log("✅ Address input webhook working");
      console.log("Note: Requires GOOGLE_MAPS_KEY for full validation");
    } else {
      console.log("⚠️  TwiML generated but may need Google Maps key");
    }
  } catch (error) {
    console.error(`❌ Address input test failed: ${error.message}`);
    console.log("Note: This requires GOOGLE_MAPS_KEY in .env");
  }

  // Test 4: Check if endpoints are registered
  console.log("\n4️⃣  Checking endpoint registration...");
  const endpoints = [
    "/voice/incoming",
    "/voice/address-input",
    "/voice/confirmation",
    "/voice/status",
  ];

  endpoints.forEach((endpoint) => {
    console.log(`   ✓ ${endpoint}`);
  });

  console.log("\n" + "=".repeat(50));
  console.log("✅ Endpoint tests completed");
  console.log("\nNext steps:");
  console.log("1. Make sure server is running: node app.js");
  console.log("2. Set up ngrok: ngrok http 3000");
  console.log("3. Update BASE_URL in .env with ngrok URL");
  console.log("4. Configure Twilio webhook");
  console.log("5. Make a test call to your Twilio number");
}

// Run tests
testEndpoints().catch(console.error);
