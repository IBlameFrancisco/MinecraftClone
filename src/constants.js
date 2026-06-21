// Global tuning constants shared across systems.

export const CHUNK_SIZE = 16;       // x / z extent of a chunk
export const CHUNK_HEIGHT = 128;    // y extent (world height)
export const SEA_LEVEL = 46;        // water fills up to this y
export const WORLD_SEED = 1337;

// How many chunks (radius) around the player to keep loaded/meshed.
export const RENDER_DISTANCE = 7;

// Player reach for break/place, in blocks.
export const REACH = 6;

// Length of a full day/night cycle in seconds.
export const DAY_LENGTH = 600;
