export type StyleSource = 'pinterest_board' | 'hardcoded' | 'custom';

export type RenderStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type RoomCategory =
  | 'living'
  | 'bedroom'
  | 'dining'
  | 'kitchen'
  | 'bathroom'
  | 'office'
  | 'outdoor'
  | 'other';

export interface Room {
  id: string;
  userId: string;
  photoUrl: string;
  depthMapUrl: string | null;
  masksJson: unknown | null;
  roomType: RoomCategory | null;
  createdAt: string;
}

export interface StyleProfile {
  id: string;
  userId: string;
  source: StyleSource;
  sourceRef: string | null;
  styleDescriptor: string;
  palette: string[];
  materials: string[];
  mood: string[];
  createdAt: string;
  expiresAt: string | null;
}

export interface PickingListItem {
  itemLabel: string;
  positionOnImage: { x: number; y: number; w: number; h: number };
  matches: Product[];
}

export interface Render {
  id: string;
  userId: string;
  roomId: string;
  styleProfileId: string;
  outputUrl: string | null;
  pickingList: PickingListItem[];
  costEstimateAud: number | null;
  status: RenderStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface Product {
  id: string;
  retailer: string;
  sku: string;
  name: string;
  category: string;
  priceAud: number;
  imageUrl: string;
  productUrl: string;
  affiliateUrl: string | null;
  dimensions: Record<string, unknown> | null;
  materials: string[];
  colors: string[];
  inStock: boolean;
  shipsTo: string[];
  lastSeenAt: string;
}
