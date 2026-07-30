"use strict";

/**
 * Question bank for Closest Wins.
 *
 * Each question is stored with its answer server-side. The correct answer must
 * NEVER be sent to clients during the question stage — use toPublicQuestion()
 * in questionManager.js to strip it.
 *
 * Values are chosen to be understandable and reasonably unambiguous. Where a
 * value naturally varies, the question is phrased precisely.
 */
const questions = [
  // Geography
  { id: "geo-001", text: "How deep is the Mariana Trench at its deepest known point?", answer: 10984, unit: "metres", category: "Geography", sourceNote: "Approximate maximum known depth" },
  { id: "geo-002", text: "How long is the coastline distance from the south to the north tip of mainland Norway, roughly?", answer: 1752, unit: "kilometres", category: "Norway" },
  { id: "geo-003", text: "How tall is Mount Everest above sea level?", answer: 8849, unit: "metres", category: "Geography" },
  { id: "geo-004", text: "How long is the Nile River?", answer: 6650, unit: "kilometres", category: "Geography" },
  { id: "geo-005", text: "How many countries are there in the world (UN members)?", answer: 193, unit: "countries", category: "Geography" },
  { id: "geo-006", text: "How large is the Sahara Desert?", answer: 9200000, unit: "square kilometres", category: "Geography" },
  { id: "geo-007", text: "How high is Angel Falls, the world's tallest waterfall?", answer: 979, unit: "metres", category: "Geography" },

  // Space
  { id: "space-001", text: "How far is the Moon from Earth on average?", answer: 384400, unit: "kilometres", category: "Space" },
  { id: "space-002", text: "How many days does it take Mars to orbit the Sun?", answer: 687, unit: "days", category: "Space" },
  { id: "space-003", text: "What is the diameter of the Sun?", answer: 1391000, unit: "kilometres", category: "Space" },
  { id: "space-004", text: "How many known moons does Jupiter have (as of recent counts)?", answer: 95, unit: "moons", category: "Space" },
  { id: "space-005", text: "How fast does light travel in a vacuum?", answer: 299792, unit: "kilometres per second", category: "Space" },
  { id: "space-006", text: "How long does sunlight take to reach Earth?", answer: 499, unit: "seconds", category: "Space" },

  // Animals
  { id: "animals-001", text: "Approximately how heavy can a large adult male polar bear become?", answer: 800, unit: "kilograms", category: "Animals" },
  { id: "animals-002", text: "How fast can a cheetah run at top speed?", answer: 112, unit: "kilometres per hour", category: "Animals" },
  { id: "animals-003", text: "How long can a giant tortoise live?", answer: 150, unit: "years", category: "Animals" },
  { id: "animals-004", text: "How heavy is an adult blue whale's tongue?", answer: 2700, unit: "kilograms", category: "Animals" },
  { id: "animals-005", text: "How many times per second does a hummingbird beat its wings?", answer: 50, unit: "beats per second", category: "Animals" },
  { id: "animals-006", text: "How tall can an adult male giraffe stand?", answer: 550, unit: "centimetres", category: "Animals" },

  // History
  { id: "hist-001", text: "In what year did the Berlin Wall fall?", answer: 1989, unit: "year", category: "History" },
  { id: "hist-002", text: "In what year was the Great Pyramid of Giza completed, approximately (BCE, enter as negative)?", answer: -2560, unit: "year", category: "History" },
  { id: "hist-003", text: "In what year did the first successful powered flight by the Wright brothers take place?", answer: 1903, unit: "year", category: "History" },
  { id: "hist-004", text: "How many years did the Hundred Years' War actually last?", answer: 116, unit: "years", category: "History" },
  { id: "hist-005", text: "In what year did the Titanic sink?", answer: 1912, unit: "year", category: "History" },

  // Technology
  { id: "tech-001", text: "In what year was the first iPhone released?", answer: 2007, unit: "year", category: "Technology" },
  { id: "tech-002", text: "How many transistors are in Apple's M1 chip, in millions?", answer: 16000, unit: "million transistors", category: "Technology" },
  { id: "tech-003", text: "In what year was the World Wide Web made publicly available?", answer: 1991, unit: "year", category: "Technology" },
  { id: "tech-004", text: "How many characters was the original Twitter post limit?", answer: 140, unit: "characters", category: "Technology" },

  // Human body
  { id: "body-001", text: "How many bones are in the adult human body?", answer: 206, unit: "bones", category: "Human body" },
  { id: "body-002", text: "How many times does an average human heart beat per day?", answer: 100000, unit: "beats", category: "Human body" },
  { id: "body-003", text: "How long is the human small intestine when stretched out?", answer: 670, unit: "centimetres", category: "Human body" },
  { id: "body-004", text: "How many litres of blood does the average adult human body contain?", answer: 5, unit: "litres", category: "Human body" },
  { id: "body-005", text: "How many muscles are there in the human body, approximately?", answer: 600, unit: "muscles", category: "Human body" },

  // Prices
  { id: "price-001", text: "How much did the most expensive painting ever sold (Salvator Mundi) go for, in millions of US dollars?", answer: 450, unit: "million USD", category: "Prices" },
  { id: "price-002", text: "How much does it cost to send a person to space on a Virgin Galactic ticket, in thousands of US dollars?", answer: 450, unit: "thousand USD", category: "Prices" },

  // Norway
  { id: "norway-001", text: "What is the population of Norway, approximately?", answer: 5500000, unit: "people", category: "Norway" },
  { id: "norway-002", text: "How tall is the Preikestolen (Pulpit Rock) cliff above the fjord?", answer: 604, unit: "metres", category: "Norway" },
  { id: "norway-003", text: "How many fjords does Norway have, approximately?", answer: 1190, unit: "fjords", category: "Norway" },

  // Ocean
  { id: "ocean-001", text: "What is the average depth of the world's oceans?", answer: 3688, unit: "metres", category: "Ocean" },
  { id: "ocean-002", text: "What percentage of Earth's surface is covered by ocean?", answer: 71, unit: "percent", category: "Ocean" },
  { id: "ocean-003", text: "How deep can the giant squid live below the ocean surface, approximately?", answer: 1000, unit: "metres", category: "Ocean" },

  // Strange facts
  { id: "strange-001", text: "How many hairs are on an average human head?", answer: 100000, unit: "hairs", category: "Strange facts" },
  { id: "strange-002", text: "How many times can a piece of paper theoretically be folded to reach the Moon (number of folds)?", answer: 42, unit: "folds", category: "Strange facts" },
  { id: "strange-003", text: "How many taste buds does the average person have?", answer: 10000, unit: "taste buds", category: "Strange facts" },
  { id: "strange-004", text: "How fast does a sneeze travel out of the human body?", answer: 160, unit: "kilometres per hour", category: "Strange facts" },
  { id: "strange-005", text: "How many dimples does a regulation golf ball have, approximately?", answer: 336, unit: "dimples", category: "Strange facts" },
  { id: "strange-006", text: "How many keys are on a standard full-size piano?", answer: 88, unit: "keys", category: "Strange facts" },
  { id: "strange-007", text: "How many bricks were used to build the Empire State Building, in millions?", answer: 10, unit: "million bricks", category: "Strange facts" },
  { id: "strange-008", text: "How long is the longest recorded flight of a chicken, in seconds?", answer: 13, unit: "seconds", category: "Strange facts" },

  // --- Additional questions ---

  // Geography
  { id: "geo-008", text: "How many time zones does Russia span?", answer: 11, unit: "time zones", category: "Geography" },
  { id: "geo-009", text: "How tall is the Eiffel Tower including antennas?", answer: 330, unit: "metres", category: "Geography" },
  { id: "geo-010", text: "How many active volcanoes are there in the world, approximately?", answer: 1500, unit: "volcanoes", category: "Geography" },

  // Space
  { id: "space-007", text: "How many minutes does it take the International Space Station to orbit Earth once?", answer: 90, unit: "minutes", category: "Space" },
  { id: "space-008", text: "How many planets in our Solar System?", answer: 8, unit: "planets", category: "Space" },

  // Animals
  { id: "animals-007", text: "How many hearts does an octopus have?", answer: 3, unit: "hearts", category: "Animals" },
  { id: "animals-008", text: "How long can a snail sleep in one stretch, in hours?", answer: 30, unit: "hours", category: "Animals" },

  // History
  { id: "hist-006", text: "In what year did World War II end?", answer: 1945, unit: "year", category: "History" },
  { id: "hist-007", text: "In what year did humans first land on the Moon?", answer: 1969, unit: "year", category: "History" },

  // Technology
  { id: "tech-005", text: "In what year was Wikipedia launched?", answer: 2001, unit: "year", category: "Technology" },
  { id: "tech-006", text: "How many megabytes are in one gigabyte?", answer: 1024, unit: "megabytes", category: "Technology" },

  // Human body
  { id: "body-006", text: "How many teeth does a typical adult human have, including wisdom teeth?", answer: 32, unit: "teeth", category: "Human body" },
  { id: "body-007", text: "How many chromosomes are in a typical human cell?", answer: 46, unit: "chromosomes", category: "Human body" },

  // Prices
  { id: "price-003", text: "How much did the first Bitcoin real-world purchase (two pizzas) cost, in bitcoins?", answer: 10000, unit: "bitcoins", category: "Prices" },

  // Norway
  { id: "norway-004", text: "How many Winter Olympic gold medals has Norway won in total, approximately?", answer: 148, unit: "gold medals", category: "Norway" },

  // Ocean
  { id: "ocean-004", text: "How long is the Great Barrier Reef?", answer: 2300, unit: "kilometres", category: "Ocean" },

  // Strange facts
  { id: "strange-009", text: "How many grooves are on the edge of a US quarter coin?", answer: 119, unit: "grooves", category: "Strange facts" },
  { id: "strange-010", text: "How many spots does a Dalmatian typically have, approximately?", answer: 150, unit: "spots", category: "Strange facts" }
];

module.exports = { questions };
