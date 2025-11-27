export type GeoPoint = { lat: number; lng: number };

export type GeoBounds = {
  northeast: GeoPoint;
  southwest: GeoPoint;
};

export interface CoverageLocation {
  label: string;
  zipCodes: string[];
  center?: GeoPoint;
  viewport?: GeoBounds | null;
  bounds?: GeoBounds | null;
  placeId?: string | null;
}
