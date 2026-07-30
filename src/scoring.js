"use strict";

/**
 * Pure, side-effect-free scoring logic for Closest Wins.
 *
 * Rank-based scoring:
 *   1st closest: 100 points
 *   2nd closest:  60 points
 *   3rd closest:  30 points
 *   Everyone else with a valid answer: 10 points
 *   No answer: 0 points (excluded from ranking)
 *
 * Ties: players with identical absolute distance receive the same rank and the
 * same points.
 */

const SCORE_BY_RANK = [100, 60, 30];
const DEFAULT_POINTS = 10;

/**
 * Calculate round scores for a set of players.
 *
 * @param {Array<{id: string, name?: string, guess: number|null}>} players
 * @param {number} correctAnswer
 * @returns {Array<{playerId: string, name?: string, guess: number, distance: number, pointsAwarded: number}>}
 *   Ranked ascending by distance. Players without a finite guess are excluded.
 */
function calculateRoundScores(players, correctAnswer) {
  const ranked = players
    .filter((player) => Number.isFinite(player.guess))
    .map((player) => ({
      ...player,
      distance: Math.abs(player.guess - correctAnswer)
    }))
    .sort((a, b) => a.distance - b.distance);

  let previousDistance = null;
  let currentRank = -1;

  return ranked.map((player, index) => {
    if (player.distance !== previousDistance) {
      currentRank = index;
      previousDistance = player.distance;
    }

    return {
      playerId: player.id,
      name: player.name,
      guess: player.guess,
      distance: player.distance,
      pointsAwarded: SCORE_BY_RANK[currentRank] ?? DEFAULT_POINTS
    };
  });
}

/**
 * Great-circle distance between two {lat, lng} points, in kilometres.
 */
function haversineKm(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

module.exports = { calculateRoundScores, haversineKm, SCORE_BY_RANK, DEFAULT_POINTS };
