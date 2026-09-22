// UNSPSC segment titles (the first two digits of a classification code).
// AusTender tags every contract with a UNSPSC code; the segment is the
// broadest level and is what the categories page groups by.
const SEGMENTS: Record<string, string> = {
  "10": "Live plants, animals and supplies",
  "11": "Minerals, textiles and raw materials",
  "12": "Chemicals and gases",
  "13": "Resins, rubber and elastomers",
  "14": "Paper materials and products",
  "15": "Fuels, lubricants and additives",
  "20": "Mining and drilling machinery",
  "21": "Farming, fishing and forestry machinery",
  "22": "Building and construction machinery",
  "23": "Industrial manufacturing machinery",
  "24": "Material handling and storage",
  "25": "Vehicles, aircraft, ships and their parts",
  "26": "Power generation and distribution machinery",
  "27": "Tools and general machinery",
  "30": "Structures and building components",
  "31": "Manufacturing components and supplies",
  "32": "Electronic components",
  "39": "Electrical systems and lighting",
  "40": "Heating, cooling and plumbing systems",
  "41": "Laboratory, measuring and testing equipment",
  "42": "Medical equipment and supplies",
  "43": "IT, broadcasting and telecommunications",
  "44": "Office equipment and supplies",
  "45": "Printing, photographic and audio visual equipment",
  "46": "Defence, law enforcement and security equipment",
  "47": "Cleaning equipment and supplies",
  "48": "Service industry machinery",
  "49": "Sports and recreational equipment",
  "50": "Food and beverage products",
  "51": "Drugs and pharmaceutical products",
  "52": "Domestic appliances and consumer electronics",
  "53": "Apparel, luggage and personal care",
  "54": "Timepieces, jewellery and gemstones",
  "55": "Published products",
  "56": "Furniture and furnishings",
  "60": "Musical instruments, games and educational supplies",
  "70": "Farming, fishing, forestry and wildlife services",
  "71": "Mining, oil and gas services",
  "72": "Building, construction and maintenance services",
  "73": "Industrial production and manufacturing services",
  "76": "Industrial cleaning services",
  "77": "Environmental services",
  "78": "Transport, storage and mail services",
  "80": "Management, business and administrative services",
  "81": "Engineering, research and technology services",
  "82": "Editorial, design, graphic and fine art services",
  "83": "Public utilities and public sector services",
  "84": "Financial and insurance services",
  "85": "Healthcare services",
  "86": "Education and training services",
  "90": "Travel, food, lodging and entertainment services",
  "91": "Personal and domestic services",
  "92": "National defence, public order and security services",
  "93": "Politics and civic affairs services",
  "94": "Organisations and clubs",
  "95": "Land, buildings and structures",
};

export function segmentOf(code: string | null | undefined): { code: string; name: string } {
  const seg = String(code ?? "").slice(0, 2);
  if (!/^\d{2}$/.test(seg)) return { code: "--", name: "Not classified" };
  return { code: seg, name: SEGMENTS[seg] ?? `UNSPSC segment ${seg}` };
}

// Segments 70 and up are services; below that are goods.
export const isService = (segCode: string) => /^\d{2}$/.test(segCode) && Number(segCode) >= 70;
