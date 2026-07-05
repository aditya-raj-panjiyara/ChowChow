import type { EntityType } from '../types';

export const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  // Suppliers / Service Providers
  supplier: 'supplier',
  vendor: 'supplier',
  organization: 'supplier',
  company: 'supplier',
  business: 'supplier',
  distributor: 'supplier',
  carrier: 'supplier',
  broker: 'supplier',
  agent: 'supplier',
  employee: 'supplier',
  staff: 'supplier',
  driver: 'supplier',
  
  // Ports / Hubs / Transit Points
  port: 'port',
  location: 'port',
  place: 'port',
  city: 'port',
  depot: 'port',
  route: 'port',
  customs: 'port',
  checkpoint: 'port',
  
  // Factories / Facilities
  factory: 'factory',
  warehouse: 'factory',
  facility: 'factory',
  plant: 'factory',
  building: 'factory',
  site: 'factory',
  hub: 'factory',
  
  // Materials / Objects / Logistics Assets
  material: 'material',
  product: 'material',
  item: 'material',
  goods: 'material',
  substance: 'material',
  shipment: 'material',
  truck: 'material',
  cargo: 'material',
  container: 'material',
  documentation: 'material',
  paperwork: 'material',
  object: 'material',
  
  // Customers / Consignees
  customer: 'customer',
  person: 'customer',
  people: 'customer',
  group: 'customer',
  buyer: 'customer',
  client: 'customer',
};

export function mapEntityType(rawType: string, name?: string): EntityType {
  // 1. Name-based match is most specific (e.g. name "Warehouse" overrides raw type "Location")
  if (name) {
    const nameKey = name.trim().toLowerCase();
    
    // Exact match first
    if (ENTITY_TYPE_MAP[nameKey]) return ENTITY_TYPE_MAP[nameKey];
    
    // Fragment match
    for (const [fragment, mapped] of Object.entries(ENTITY_TYPE_MAP)) {
      if (nameKey.includes(fragment)) return mapped;
    }
  }

  // 2. Fall back to raw type matching
  const typeKey = rawType.trim().toLowerCase();
  if (ENTITY_TYPE_MAP[typeKey]) return ENTITY_TYPE_MAP[typeKey];
  for (const [fragment, mapped] of Object.entries(ENTITY_TYPE_MAP)) {
    if (typeKey.includes(fragment)) return mapped;
  }

  return 'supplier';
}
