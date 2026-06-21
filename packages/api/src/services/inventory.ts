import { PoolClient } from 'pg';
import { db } from '../db/client';

// Scala gli ingredienti dalla ricetta del piatto ordinato
export async function deductInventory(
  client: PoolClient,
  restaurantId: string,
  dishId: string,
  qty: number,
  orderId: string
): Promise<void> {
  const recipe = await client.query(
    `SELECT ri.ingredient_id, ri.qty, ri.unit
     FROM recipe_ingredients ri
     WHERE ri.dish_id = $1`,
    [dishId]
  );

  for (const ingredient of recipe.rows) {
    const delta = -(ingredient.qty * qty);

    await client.query(
      `UPDATE ingredients SET current_qty = current_qty + $1
       WHERE id = $2 AND restaurant_id = $3`,
      [delta, ingredient.ingredient_id, restaurantId]
    );

    await client.query(
      `INSERT INTO inventory_movements (restaurant_id, ingredient_id, qty_delta, reason, order_id)
       VALUES ($1, $2, $3, 'sale', $4)`,
      [restaurantId, ingredient.ingredient_id, delta, orderId]
    );
  }
}

// Ritorna alert sullo stock (critico / attenzione / ok)
export async function getStockAlerts(restaurantId: string) {
  const result = await db.query(
    `SELECT id as ingredient_id, name, current_qty, unit, min_threshold, expiry_date
     FROM ingredients
     WHERE restaurant_id = $1
     ORDER BY (current_qty / NULLIF(min_threshold, 0)) ASC`,
    [restaurantId]
  );

  return result.rows.map((row) => {
    const ratio = row.min_threshold > 0 ? row.current_qty / row.min_threshold : 10;
    const level = ratio <= 0 ? 'critical' : ratio <= 1 ? 'warning' : 'ok';

    // Stima consumo orario basata su movimenti recenti
    return {
      ingredient_id: row.ingredient_id,
      name: row.name,
      current_qty: parseFloat(row.current_qty),
      unit: row.unit,
      min_threshold: parseFloat(row.min_threshold),
      expiry_date: row.expiry_date,
      level,
    };
  });
}

// Rifornimento manuale
export async function restockIngredient(
  restaurantId: string,
  ingredientId: string,
  qty: number
): Promise<void> {
  await db.query(
    `UPDATE ingredients SET current_qty = current_qty + $1
     WHERE id = $2 AND restaurant_id = $3`,
    [qty, ingredientId, restaurantId]
  );

  await db.query(
    `INSERT INTO inventory_movements (restaurant_id, ingredient_id, qty_delta, reason)
     VALUES ($1, $2, $3, 'restock')`,
    [restaurantId, ingredientId, qty]
  );
}
