export type Flight = {
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  on_ground: boolean | null;
  last_contact: string | null;
  updated_at: string;
};

export type UserPreferences = {
  user_id: string;
  map_center_lat: number;
  map_center_lon: number;
  map_zoom: number;
  filter_country: string | null;
};

export type UserFavorite = {
  id: string;
  user_id: string;
  icao24: string;
  label: string | null;
  notes: string | null;
  created_at: string;
};
