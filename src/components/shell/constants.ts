/**
 * Plain constants shared by server and client code. Kept out of the
 * "use client" modules on purpose: a server component importing a value from
 * one of those receives a client reference, not the value.
 */

/** Cookie, not localStorage, so the server renders the rail at the right width and nothing jumps. */
export const RAIL_COOKIE = "sim-rail";
