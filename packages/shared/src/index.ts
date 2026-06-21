// Shared types across all packages

export type Language = 'it' | 'en' | 'de' | 'es' | 'fr';

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_KITCHEN'
  | 'READY'
  | 'SERVED'
  | 'PAID';

export interface Ingredient {
  ingredient_id: string;
  name: string;
  qty: number;
  unit: 'g' | 'kg' | 'ml' | 'l' | 'pz';
}

export interface Dish {
  dish_id: string;
  name: string;
  description: string;
  price: number;
  cost: number;
  category: 'antipasto' | 'primo' | 'secondo' | 'dessert' | 'bevanda' | 'altro';
  allergens: string[];
  ingredients: DishIngredient[];
  image_url?: string;
  available: boolean;
  prep_time_min: number;
}

export interface DishIngredient {
  ingredient_id: string;
  qty: number;
  unit: string;
}

export interface OrderItem {
  dish_id: string;
  dish_name: string;
  qty: number;
  unit_price: number;
  note?: string;
}

export interface Order {
  order_id: string;
  restaurant_id: string;
  table_number: number;
  session_id: string;
  items: OrderItem[];
  status: OrderStatus;
  total: number;
  language: Language;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface InventoryItem {
  ingredient_id: string;
  name: string;
  current_qty: number;
  unit: string;
  min_threshold: number;
  expiry_date?: string;
}

export interface StockAlert {
  ingredient_id: string;
  name: string;
  current_qty: number;
  unit: string;
  level: 'critical' | 'warning' | 'ok';
  estimated_hours_remaining?: number;
}
