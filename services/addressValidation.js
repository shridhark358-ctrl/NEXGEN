import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY;
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const SERVICE_AREAS = [
  "Alcalá de Henares",
  "Villalbilla"
];

export async function validateAddress(rawAddress) {

  if (!GOOGLE_MAPS_KEY) {
    throw new Error("Google Maps API key not configured");
  }

  const response = await axios.get(GEOCODE_URL, {
    params: {
      address: rawAddress,
      key: GOOGLE_MAPS_KEY,
      language: "es",
      region: "es",
    },
  });

  const data = response.data;

  if (data.status !== "OK" || !data.results || data.results.length === 0) {
    throw new Error("no-result");
  }

  const result = data.results[0];
  const components = result.address_components || [];

  const hasNumber = components.some(c => c.types.includes("street_number"));
  const hasStreet = components.some(c => c.types.includes("route"));

  const cityComponent = components.find(
    c => c.types.includes("locality") || c.types.includes("postal_town")
  );

  if (!hasNumber || !hasStreet || !cityComponent) {
    throw new Error("incomplete-address");
  }

  const city = cityComponent.long_name;

  const postalComponent = components.find(c =>
    c.types.includes("postal_code")
  );

  const postalCode = postalComponent
    ? postalComponent.long_name
    : null;

  const isServiceArea = SERVICE_AREAS.some(area =>
    city.toLowerCase().includes(area.toLowerCase())
  );

  return {
    formatted_address: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    place_id: result.place_id,
    postal_code: postalCode,
    city: city,
    serviceable: isServiceArea
  };
}