"use strict";

/**
 * Events for Timeline mode. Each event has a short `label` (shown on the
 * timeline) and a `year` (the correct answer). Players guess the year; closest
 * wins, and correctly-placed events accumulate on a shared growing timeline.
 *
 * Years are stored server-side as the answer and stripped from the public
 * payload during the guessing stage, exactly like trivia answers.
 */
const timelineEvents = [
  { id: "tl-moon", label: "First humans land on the Moon", year: 1969, category: "Space" },
  { id: "tl-berlin", label: "Fall of the Berlin Wall", year: 1989, category: "History" },
  { id: "tl-www", label: "World Wide Web made public", year: 1991, category: "Technology" },
  { id: "tl-iphone", label: "First iPhone released", year: 2007, category: "Technology" },
  { id: "tl-titanic", label: "The Titanic sinks", year: 1912, category: "History" },
  { id: "tl-ww2end", label: "World War II ends", year: 1945, category: "History" },
  { id: "tl-ww1start", label: "World War I begins", year: 1914, category: "History" },
  { id: "tl-flight", label: "Wright brothers' first powered flight", year: 1903, category: "Technology" },
  { id: "tl-printing", label: "Gutenberg's printing press", year: 1440, category: "History" },
  { id: "tl-america", label: "Columbus reaches the Americas", year: 1492, category: "History" },
  { id: "tl-french", label: "French Revolution begins", year: 1789, category: "History" },
  { id: "tl-independence", label: "US Declaration of Independence", year: 1776, category: "History" },
  { id: "tl-telephone", label: "Bell patents the telephone", year: 1876, category: "Technology" },
  { id: "tl-lightbulb", label: "Edison's practical light bulb", year: 1879, category: "Technology" },
  { id: "tl-penicillin", label: "Penicillin discovered", year: 1928, category: "Science" },
  { id: "tl-dna", label: "Structure of DNA described", year: 1953, category: "Science" },
  { id: "tl-sputnik", label: "Sputnik, first satellite, launched", year: 1957, category: "Space" },
  { id: "tl-internet", label: "ARPANET, the early internet, goes live", year: 1969, category: "Technology" },
  { id: "tl-facebook", label: "Facebook founded", year: 2004, category: "Technology" },
  { id: "tl-google", label: "Google founded", year: 1998, category: "Technology" },
  { id: "tl-everest", label: "First ascent of Mount Everest", year: 1953, category: "History" },
  { id: "tl-euro", label: "Euro currency introduced", year: 1999, category: "History" },
  { id: "tl-chernobyl", label: "Chernobyl disaster", year: 1986, category: "History" },
  { id: "tl-tesla", label: "Tesla founded", year: 2003, category: "Technology" },
  { id: "tl-gagarin", label: "First human in space (Gagarin)", year: 1961, category: "Space" },
  { id: "tl-mars", label: "First rover lands on Mars (Sojourner)", year: 1997, category: "Space" },
  { id: "tl-pompeii", label: "Vesuvius destroys Pompeii", year: 79, category: "History" },
  { id: "tl-magna", label: "Magna Carta sealed", year: 1215, category: "History" },
  { id: "tl-photo", label: "First permanent photograph", year: 1826, category: "Technology" },
  { id: "tl-vaccine", label: "First smallpox vaccine", year: 1796, category: "Science" },

  { id: "tl-radio", label: "First radio transmission across the Atlantic", year: 1901, category: "Technology" },
  { id: "tl-tv", label: "First working television demonstrated", year: 1926, category: "Technology" },
  { id: "tl-computer", label: "ENIAC, an early electronic computer", year: 1945, category: "Technology" },
  { id: "tl-transistor", label: "The transistor is invented", year: 1947, category: "Technology" },
  { id: "tl-email", label: "First email sent", year: 1971, category: "Technology" },
  { id: "tl-mobile", label: "First handheld mobile phone call", year: 1973, category: "Technology" },
  { id: "tl-windows", label: "Microsoft Windows 1.0 released", year: 1985, category: "Technology" },
  { id: "tl-youtube", label: "YouTube founded", year: 2005, category: "Technology" },
  { id: "tl-wikipedia", label: "Wikipedia launched", year: 2001, category: "Technology" },
  { id: "tl-chatgpt", label: "ChatGPT released to the public", year: 2022, category: "Technology" },
  { id: "tl-relativity", label: "Einstein publishes general relativity", year: 1915, category: "Science" },
  { id: "tl-evolution", label: "Darwin publishes 'On the Origin of Species'", year: 1859, category: "Science" },
  { id: "tl-periodic", label: "Mendeleev's periodic table", year: 1869, category: "Science" },
  { id: "tl-xray", label: "X-rays discovered", year: 1895, category: "Science" },
  { id: "tl-humangenome", label: "Human Genome Project completed", year: 2003, category: "Science" },
  { id: "tl-titanic2", label: "Wreck of the Titanic found", year: 1985, category: "History" },
  { id: "tl-apartheid", label: "End of apartheid in South Africa", year: 1994, category: "History" },
  { id: "tl-cuban", label: "Cuban Missile Crisis", year: 1962, category: "History" },
  { id: "tl-rome", label: "Fall of the Western Roman Empire", year: 476, category: "History" },
  { id: "tl-blackdeath", label: "The Black Death reaches Europe", year: 1347, category: "History" },
  { id: "tl-normandy", label: "D-Day, the Normandy landings", year: 1944, category: "History" },
  { id: "tl-frenchrev", label: "Storming of the Bastille", year: 1789, category: "History" },
  { id: "tl-mona", label: "Leonardo begins the Mona Lisa", year: 1503, category: "History" },
  { id: "tl-olympics", label: "First modern Olympic Games", year: 1896, category: "History" },
  { id: "tl-suez", label: "Suez Canal opens", year: 1869, category: "History" },
  { id: "tl-panama", label: "Panama Canal opens", year: 1914, category: "History" },
  { id: "tl-concorde", label: "Concorde's first commercial flight", year: 1976, category: "Technology" },
  { id: "tl-hubble", label: "Hubble Space Telescope launched", year: 1990, category: "Space" },
  { id: "tl-iss", label: "First module of the ISS launched", year: 1998, category: "Space" },
  { id: "tl-pluto", label: "New Horizons flies past Pluto", year: 2015, category: "Space" }
];

module.exports = { timelineEvents };
