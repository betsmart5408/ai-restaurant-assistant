import { db } from '../db/client';

export interface IngredientForecast {
  ingredient_id: string;
  name: string;
  unit: string;
  current_qty: number;
  min_threshold: number;
  avg_daily_consumption: number;
  days_until_empty: number | null;
  days_until_threshold: number | null;
  suggested_reorder_qty: number;
  risk_level: 'ok' | 'watch' | 'order_soon' | 'critical';
  expiry_date: string | null;
}

export interface DishForecast {
  dish_id: string;
  dish_name: string;
  category: string;
  limiting_ingredient: string;     // ingrediente che si esaurisce prima
  max_portions_possible: number;   // quante porzioni si possono ancora fare
}

// Calcola consumo medio giornaliero degli ultimi N giorni
async function getDailyConsumption(restaurantId: string, ingredientId: string, days = 14): Promise<number> {
  const result = await db.query(
    `SELECT ABS(SUM(qty_delta)) / $3 as daily_avg
     FROM inventory_movements
     WHERE restaurant_id = $1
       AND ingredient_id = $2
       AND qty_delta < 0
       AND created_at >= NOW() - ($3 || ' days')::INTERVAL`,
    [restaurantId, ingredientId, days]
  );
  return parseFloat(result.rows[0]?.daily_avg ?? 0);
}

export async function getForecast(restaurantId: string): Promise<IngredientForecast[]> {
  const ingredients = await db.query(
    `SELECT id, name, unit, current_qty, min_threshold, expiry_date
     FROM ingredients
     WHERE restaurant_id = $1
     ORDER BY name`,
    [restaurantId]
  );

  const forecasts: IngredientForecast[] = [];

  for (const ing of ingredients.rows) {
    const currentQty = parseFloat(ing.current_qty);
    const threshold = parseFloat(ing.min_threshold);
    const avgDaily = await getDailyConsumption(restaurantId, ing.id);

    let daysUntilEmpty: number | null = null;
    let daysUntilThreshold: number | null = null;
    let suggestedReorder = 0;
    let riskLevel: IngredientForecast['risk_level'] = 'ok';

    if (avgDaily > 0) {
      daysUntilEmpty = Math.floor(currentQty / avgDaily);
      daysUntilThreshold = threshold > 0 ? Math.floor((currentQty - threshold) / avgDaily) : null;

      // Scorta consigliata = 7 giorni di consumo + threshold
      suggestedReorder = Math.ceil(avgDaily * 7 + threshold - currentQty);
      if (suggestedReorder < 0) suggestedReorder = 0;

      // Calcolo livello di rischio
      if (daysUntilEmpty <= 1) riskLevel = 'critical';
      else if (daysUntilThreshold !== null && daysUntilThreshold <= 2) riskLevel = 'order_soon';
      else if (daysUntilEmpty <= 7) riskLevel = 'watch';
      else riskLevel = 'ok';
    } else {
      // Nessun consumo storico: usa solo soglia attuale
      if (currentQty <= 0) riskLevel = 'critical';
      else if (threshold > 0 && currentQty <= threshold) riskLevel = 'order_soon';
    }

    forecasts.push({
      ingredient_id: ing.id,
      name: ing.name,
      unit: ing.unit,
      current_qty: currentQty,
      min_threshold: threshold,
      avg_daily_consumption: Math.round(avgDaily * 10) / 10,
      days_until_empty: daysUntilEmpty,
      days_until_threshold: daysUntilThreshold,
      suggested_reorder_qty: suggestedReorder,
      risk_level: riskLevel,
      expiry_date: ing.expiry_date,
    });
  }

  // Ordina per rischio decrescente
  const order = { critical: 0, order_soon: 1, watch: 2, ok: 3 };
  return forecasts.sort((a, b) => order[a.risk_level] - order[b.risk_level]);
}

// Quante porzioni di ogni piatto si possono ancora fare con le scorte attuali
export async function getDishPortionsForecast(restaurantId: string): Promise<DishForecast[]> {
  const dishes = await db.query(
    `SELECT d.id, d.name, d.category,
            ri.ingredient_id, i.name as ing_name, i.current_qty, ri.qty as required_qty
     FROM dishes d
     JOIN recipe_ingredients ri ON ri.dish_id = d.id
     JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE d.restaurant_id = $1 AND d.available = true`,
    [restaurantId]
  );

  // Raggruppa per piatto
  const byDish: Record<string, {
    dish_id: string; dish_name: string; category: string;
    ingredients: { name: string; current_qty: number; required_qty: number }[]
  }> = {};

  for (const row of dishes.rows) {
    if (!byDish[row.id]) {
      byDish[row.id] = { dish_id: row.id, dish_name: row.name, category: row.category, ingredients: [] };
    }
    byDish[row.id].ingredients.push({
      name: row.ing_name,
      current_qty: parseFloat(row.current_qty),
      required_qty: parseFloat(row.required_qty),
    });
  }

  return Object.values(byDish).map(dish => {
    // Il numero massimo di porzioni è limitato dall'ingrediente più scarso
    let minPortions = Infinity;
    let limitingIngredient = '';

    for (const ing of dish.ingredients) {
      if (ing.required_qty > 0) {
        const possible = Math.floor(ing.current_qty / ing.required_qty);
        if (possible < minPortions) {
          minPortions = possible;
          limitingIngredient = ing.name;
        }
      }
    }

    return {
      dish_id: dish.dish_id,
      dish_name: dish.dish_name,
      category: dish.category,
      limiting_ingredient: limitingIngredient,
      max_portions_possible: minPortions === Infinity ? 999 : minPortions,
    };
  }).sort((a, b) => a.max_portions_possible - b.max_portions_possible);
}
