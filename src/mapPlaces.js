"use strict";

/**
 * Places for Map "Place it" mode. Each item has a real-world { lat, lng }
 * (the answer, stripped from the public payload) and a prompt shown to players.
 * Players click the world map; the closest guess by great-circle distance wins.
 */
const mapPlaces = [
  // Capitals
  { id: "cap-oslo", prompt: "Where is Oslo?", lat: 59.91, lng: 10.75, category: "Capitals" },
  { id: "cap-paris", prompt: "Where is Paris?", lat: 48.85, lng: 2.35, category: "Capitals" },
  { id: "cap-tokyo", prompt: "Where is Tokyo?", lat: 35.68, lng: 139.69, category: "Capitals" },
  { id: "cap-cairo", prompt: "Where is Cairo?", lat: 30.04, lng: 31.24, category: "Capitals" },
  { id: "cap-canberra", prompt: "Where is Canberra?", lat: -35.28, lng: 149.13, category: "Capitals" },
  { id: "cap-brasilia", prompt: "Where is Brasília?", lat: -15.79, lng: -47.88, category: "Capitals" },
  { id: "cap-ottawa", prompt: "Where is Ottawa?", lat: 45.42, lng: -75.70, category: "Capitals" },
  { id: "cap-moscow", prompt: "Where is Moscow?", lat: 55.75, lng: 37.62, category: "Capitals" },
  { id: "cap-nairobi", prompt: "Where is Nairobi?", lat: -1.29, lng: 36.82, category: "Capitals" },
  { id: "cap-reykjavik", prompt: "Where is Reykjavík?", lat: 64.15, lng: -21.94, category: "Capitals" },
  { id: "cap-delhi", prompt: "Where is New Delhi?", lat: 28.61, lng: 77.21, category: "Capitals" },
  { id: "cap-buenosaires", prompt: "Where is Buenos Aires?", lat: -34.60, lng: -58.38, category: "Capitals" },

  // Countries
  { id: "cty-japan", prompt: "Place Japan on the map.", lat: 36, lng: 138, category: "Countries", acceptableRadiusKm: 550 },
  { id: "cty-brazil", prompt: "Place Brazil on the map.", lat: -10, lng: -55, category: "Countries" },
  { id: "cty-australia", prompt: "Place Australia on the map.", lat: -25, lng: 133, category: "Countries" },
  { id: "cty-egypt", prompt: "Place Egypt on the map.", lat: 27, lng: 30, category: "Countries" },
  { id: "cty-norway", prompt: "Place Norway on the map.", lat: 62, lng: 10, category: "Countries", acceptableRadiusKm: 650 },
  { id: "cty-iceland", prompt: "Place Iceland on the map.", lat: 65, lng: -18, category: "Countries" },
  { id: "cty-madagascar", prompt: "Place Madagascar on the map.", lat: -20, lng: 47, category: "Countries" },
  { id: "cty-nz", prompt: "Place New Zealand on the map.", lat: -42, lng: 172, category: "Countries", acceptableRadiusKm: 650 },
  { id: "cty-mongolia", prompt: "Place Mongolia on the map.", lat: 46, lng: 105, category: "Countries" },
  { id: "cty-chile", prompt: "Place Chile on the map.", lat: -35, lng: -71, category: "Countries", acceptableRadiusKm: 950 },

  // Flags
  { id: "flag-jp", prompt: "Place the country of this flag: 🇯🇵", lat: 36, lng: 138, category: "Flags" },
  { id: "flag-br", prompt: "Place the country of this flag: 🇧🇷", lat: -10, lng: -55, category: "Flags" },
  { id: "flag-no", prompt: "Place the country of this flag: 🇳🇴", lat: 62, lng: 10, category: "Flags" },
  { id: "flag-eg", prompt: "Place the country of this flag: 🇪🇬", lat: 27, lng: 30, category: "Flags" },
  { id: "flag-au", prompt: "Place the country of this flag: 🇦🇺", lat: -25, lng: 133, category: "Flags" },
  { id: "flag-ca", prompt: "Place the country of this flag: 🇨🇦", lat: 56, lng: -106, category: "Flags" },
  { id: "flag-in", prompt: "Place the country of this flag: 🇮🇳", lat: 22, lng: 79, category: "Flags" },
  { id: "flag-za", prompt: "Place the country of this flag: 🇿🇦", lat: -29, lng: 24, category: "Flags" },

  // Rivers
  { id: "riv-nile", prompt: "Where does the Nile flow?", lat: 26, lng: 32, category: "Rivers" },
  { id: "riv-amazon", prompt: "Where is the Amazon River?", lat: -3, lng: -60, category: "Rivers" },
  { id: "riv-mississippi", prompt: "Where is the Mississippi River?", lat: 38, lng: -90, category: "Rivers" },
  { id: "riv-ganges", prompt: "Where is the Ganges River?", lat: 25, lng: 83, category: "Rivers" },
  { id: "riv-danube", prompt: "Where does the Danube flow?", lat: 45, lng: 20, category: "Rivers" },
  { id: "riv-yangtze", prompt: "Where is the Yangtze River?", lat: 30, lng: 112, category: "Rivers" },

  // Mountains
  { id: "mtn-everest", prompt: "Locate Mount Everest.", lat: 27.99, lng: 86.93, category: "Mountains" },
  { id: "mtn-kilimanjaro", prompt: "Locate Mount Kilimanjaro.", lat: -3.07, lng: 37.35, category: "Mountains" },
  { id: "mtn-denali", prompt: "Locate Denali.", lat: 63.07, lng: -151.01, category: "Mountains" },
  { id: "mtn-aconcagua", prompt: "Locate Aconcagua.", lat: -32.65, lng: -70.01, category: "Mountains" },
  { id: "mtn-montblanc", prompt: "Locate Mont Blanc.", lat: 45.83, lng: 6.86, category: "Mountains" },
  { id: "mtn-fuji", prompt: "Locate Mount Fuji.", lat: 35.36, lng: 138.73, category: "Mountains" },

  // Landmarks
  { id: "lm-pyramids", prompt: "Where are the Pyramids of Giza?", lat: 29.98, lng: 31.13, category: "Landmarks" },
  { id: "lm-liberty", prompt: "Where is the Statue of Liberty?", lat: 40.69, lng: -74.04, category: "Landmarks" },
  { id: "lm-opera", prompt: "Where is the Sydney Opera House?", lat: -33.86, lng: 151.21, category: "Landmarks" },
  { id: "lm-eiffel", prompt: "Where is the Eiffel Tower?", lat: 48.86, lng: 2.29, category: "Landmarks" },
  { id: "lm-redeemer", prompt: "Where is Christ the Redeemer?", lat: -22.95, lng: -43.21, category: "Landmarks" },
  { id: "lm-taj", prompt: "Where is the Taj Mahal?", lat: 27.17, lng: 78.04, category: "Landmarks" },
  { id: "lm-colosseum", prompt: "Where is the Colosseum?", lat: 41.89, lng: 12.49, category: "Landmarks" },
  { id: "lm-bigben", prompt: "Where is Big Ben?", lat: 51.50, lng: -0.12, category: "Landmarks" }
];

module.exports = { mapPlaces };
