// South Australia: the Fuel Pricing Information Scheme, live API only, needs a
// subscriber token (FUEL_SA_KEY) issued to a registered data publisher.
// Calls: see fpdapi.ts; about 4 or 5 a day.
import { fpdapiPrices } from "./fpdapi";
import { needsKey, summarise, type FuelSummary } from "./types";

const BASE = "https://fppdirectapi-prod.safuelpricinginformation.com.au";
const SIGNUP = "https://www.safuelpricinginformation.com.au/publishers.html";

export const saKey = (): string | null => (process.env.FUEL_SA_KEY ? null : needsKey("a subscriber token", SIGNUP));

export async function loadSa(): Promise<FuelSummary> {
  const token = process.env.FUEL_SA_KEY;
  if (!token) throw new Error(saKey()!);
  const { prices, date } = await fpdapiPrices(BASE, token, "SA");
  return summarise(prices, {
    code: "SA", name: "South Australia", date, live: true,
    coverage: "Current price at every site reporting to the SA Fuel Pricing Information Scheme, which retailers must update within 30 minutes of a change.",
    sourceName: "SA Fuel Pricing Information Scheme, live API", sourceUrl: SIGNUP, licence: "Scheme data publisher terms, shown with attribution",
  });
}
