/**
 * Context store for persisting user brand settings and memory to PostgreSQL.
 */

export async function loadBrandMemory(pool, uid) {
  const result = await pool.query('SELECT * FROM brand_memories WHERE uid = $1', [uid]);
  if (result.rowCount === 0) {
    return {
      uid,
      brand_name: '',
      style: '',
      color_palette: [],
      typography: '',
      logo_url: '',
      product_name: '',
      product_category: '',
      selling_points: []
    };
  }
  const row = result.rows[0];
  return {
    uid: row.uid,
    brand_name: row.brand_name || '',
    style: row.style || '',
    color_palette: Array.isArray(row.color_palette) ? row.color_palette : [],
    typography: row.typography || '',
    logo_url: row.logo_url || '',
    product_name: row.product_name || '',
    product_category: row.product_category || '',
    selling_points: Array.isArray(row.selling_points) ? row.selling_points : []
  };
}

export async function saveBrandMemory(pool, uid, memory) {
  try {
    const colorPaletteJson = JSON.stringify(memory.color_palette || []);
    const sellingPointsJson = JSON.stringify(memory.selling_points || []);
    await pool.query(
      `INSERT INTO brand_memories (
        uid, brand_name, style, color_palette, typography, logo_url, 
        product_name, product_category, selling_points, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (uid) DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        style = EXCLUDED.style,
        color_palette = EXCLUDED.color_palette,
        typography = EXCLUDED.typography,
        logo_url = EXCLUDED.logo_url,
        product_name = EXCLUDED.product_name,
        product_category = EXCLUDED.product_category,
        selling_points = EXCLUDED.selling_points,
        updated_at = NOW()`,
      [
        uid,
        memory.brand_name || '',
        memory.style || '',
        colorPaletteJson,
        memory.typography || '',
        memory.logo_url || '',
        memory.product_name || '',
        memory.product_category || '',
        sellingPointsJson
      ]
    );
    return true;
  } catch (err) {
    console.error('[Brand Memory] Failed to save brand memory to DB:', err.message);
    throw err;
  }
}
