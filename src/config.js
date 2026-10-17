export const CFG = {
  seed: 1337,
  blocks: 12,          // city is blocks x blocks
  blockSize: 44,       // meters per block (building area incl. sidewalk)
  roadWidth: 14,       // meters, two lanes
  sidewalk: 3,         // sidewalk width inside each block edge
  laneOffset: 3.5,     // lane center from road center
  dayLengthSec: 600,   // real seconds per 24h
  trafficCars: 40,
  pedestrians: 110,
  gravity: 24,
};
