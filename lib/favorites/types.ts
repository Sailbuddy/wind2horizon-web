export type CollectionType = "favorites" | "trip_plan" | "trip_report" | "mixed";

export type CollectionVisibility = "private" | "shared_users" | "shared_link";

export type CollectionItemStatus = "saved" | "planned" | "visited" | "skipped";

export type CollectionItemPurpose =
  | "overnight"
  | "anchorage"
  | "marina"
  | "meal"
  | "swim"
  | "fuel"
  | "provisioning"
  | "repair"
  | "sightseeing"
  | "crew_change"
  | "weather_shelter"
  | "other";

export type CollectionItemStayType =
  | "short_stop"
  | "half_day"
  | "overnight"
  | "multi_day";

export type CollectionItemPriority = "must" | "nice" | "backup";

export type CreateCollectionInput = {
  title: string;
  description?: string | null;
  visibility?: CollectionVisibility;
  collectionType?: CollectionType;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null;   // YYYY-MM-DD
  summary?: string | null;
  isDefault?: boolean;
};

export type AddLocationToCollectionInput = {
  collectionId: number;
  locationId: number;
  note?: string | null;
  sortOrder?: number | null;
  status?: CollectionItemStatus;
  plannedDate?: string | null; // YYYY-MM-DD
  plannedTime?: string | null; // HH:mm[:ss]
  purpose?: CollectionItemPurpose | null;
  stayType?: CollectionItemStayType | null;
  priority?: CollectionItemPriority | null;
};

export type UpdateCollectionItemInput = {
  collectionId: number;
  locationId: number;
  note?: string | null;
  sortOrder?: number | null;
  status?: CollectionItemStatus;
  plannedDate?: string | null;
  plannedTime?: string | null;
  visitedAt?: string | null; // ISO
  purpose?: CollectionItemPurpose | null;
  stayType?: CollectionItemStayType | null;
  priority?: CollectionItemPriority | null;
  ratingPersonal?: number | null;
  wouldReturn?: boolean | null;
  reportNote?: string | null;
  highlight?: string | null;
  cautionNote?: string | null;
};