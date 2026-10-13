// Data-access layer (SQLite). Every statement uses bound parameters. Dynamic parts (column lists)
// come from fixed whitelists in this file, never from request data.
const { decodeIdCursor, decodeDateIdCursor } = require('./pagination');

const round = (n, d = 1) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;
const todayIso = () => new Date().toISOString().slice(0, 10);

const MEAL_SELECT = `
  SELECT m.id, m.food_id AS foodId, f.name AS foodName, m.servings, m.meal_type AS mealType, m.eaten_on AS eatenOn,
         ROUND(f.calories * m.servings, 1) AS calories, ROUND(f.protein_g * m.servings, 1) AS proteinG
  FROM meals m JOIN foods f ON f.id = m.food_id`;
const FOOD_COLS = 'id, name, serving_desc AS servingDesc, calories, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG';
const USER_COLS = 'id, email, name, role, age, height_cm AS heightCm, created_at AS createdAt';

function createServices(db) {
  const svc = {
    todayIso,

    // ---------- users ----------
    getUserById: (id) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id),
    getUserAuthByEmail: (email) => db.prepare('SELECT id, email, name, role, password_hash AS passwordHash FROM users WHERE email = ?').get(email),
    createUser({ email, passwordHash, name, role = 'user' }) {
      try {
        const r = db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (@email, @passwordHash, @name, @role)')
          .run({ email, passwordHash, name, role });
        return svc.getUserById(r.lastInsertRowid);
      } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
        throw e;
      }
    },
    updateUser(id, patch) {
      const cols = { name: 'name', age: 'age', heightCm: 'height_cm' }; // whitelist
      const keys = Object.keys(patch).filter((k) => cols[k]);
      if (keys.length) {
        db.prepare(`UPDATE users SET ${keys.map((k) => `${cols[k]} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
      }
      return svc.getUserById(id);
    },
    listUsers: ({ limit, cursor }) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE id > ? ORDER BY id LIMIT ?`)
      .all(decodeIdCursor(cursor) ?? 0, limit),
    deleteUser: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0,

    // ---------- foods ----------
    listFoods({ q, limit, cursor }) {
      const after = decodeIdCursor(cursor) ?? 0;
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
        return db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE id > ? AND name LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?`).all(after, like, limit);
      }
      return db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE id > ? ORDER BY id LIMIT ?`).all(after, limit);
    },
    getFood: (id) => db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE id = ?`).get(id),
    findFoodByName: (name) => db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE name = ?`).get(name),
    createFood(f) {
      const r = db.prepare('INSERT INTO foods (name, serving_desc, calories, protein_g, carbs_g, fat_g) VALUES (@name, @servingDesc, @calories, @proteinG, @carbsG, @fatG)').run(f);
      return svc.getFood(r.lastInsertRowid);
    },
    replaceFood(id, f) {
      const r = db.prepare('UPDATE foods SET name=@name, serving_desc=@servingDesc, calories=@calories, protein_g=@proteinG, carbs_g=@carbsG, fat_g=@fatG WHERE id=@id').run({ ...f, id });
      return r.changes ? svc.getFood(id) : null;
    },
    patchFood(id, patch) {
      const cur = svc.getFood(id);
      if (!cur) return null;
      const { id: _ignored, ...rest } = cur;
      return svc.replaceFood(id, { ...rest, ...patch });
    },
    deleteFood: (id) => db.prepare('DELETE FROM foods WHERE id = ?').run(id).changes > 0,

    // ---------- meals ----------
    listMeals(userId, { date, limit, cursor }) {
      const c = decodeDateIdCursor(cursor);
      let where = 'm.user_id = ?';
      const params = [userId];
      if (date) { where += ' AND m.eaten_on = ?'; params.push(date); }
      if (c) { where += ' AND (m.eaten_on < ? OR (m.eaten_on = ? AND m.id < ?))'; params.push(c[0], c[0], c[1]); }
      return db.prepare(`${MEAL_SELECT} WHERE ${where} ORDER BY m.eaten_on DESC, m.id DESC LIMIT ?`).all(...params, limit);
    },
    getMeal: (userId, id) => db.prepare(`${MEAL_SELECT} WHERE m.user_id = ? AND m.id = ?`).get(userId, id),
    createMeal(userId, { foodId, servings, mealType, eatenOn }) {
      const r = db.prepare('INSERT INTO meals (user_id, food_id, servings, meal_type, eaten_on) VALUES (?,?,?,?,?)')
        .run(userId, foodId, servings, mealType, eatenOn || todayIso());
      return svc.getMeal(userId, r.lastInsertRowid);
    },
    updateMeal(userId, id, patch) {
      const cur = svc.getMeal(userId, id);
      if (!cur) return null;
      const next = { foodId: cur.foodId, servings: cur.servings, mealType: cur.mealType, eatenOn: cur.eatenOn, ...patch };
      db.prepare('UPDATE meals SET food_id=?, servings=?, meal_type=?, eaten_on=? WHERE id=? AND user_id=?')
        .run(next.foodId, next.servings, next.mealType, next.eatenOn, id, userId);
      return svc.getMeal(userId, id);
    },
    deleteMeal: (userId, id) => db.prepare('DELETE FROM meals WHERE id = ? AND user_id = ?').run(id, userId).changes > 0,

    // ---------- weights ----------
    listWeights(userId, { limit, cursor }) {
      const c = decodeDateIdCursor(cursor);
      const base = 'SELECT id, weight_kg AS weightKg, logged_on AS loggedOn FROM weights WHERE user_id = ?';
      if (c) {
        return db.prepare(`${base} AND (logged_on < ? OR (logged_on = ? AND id < ?)) ORDER BY logged_on DESC, id DESC LIMIT ?`)
          .all(userId, c[0], c[0], c[1], limit);
      }
      return db.prepare(`${base} ORDER BY logged_on DESC, id DESC LIMIT ?`).all(userId, limit);
    },
    createWeight(userId, { weightKg, loggedOn }) {
      const r = db.prepare('INSERT INTO weights (user_id, weight_kg, logged_on) VALUES (?,?,?)').run(userId, weightKg, loggedOn || todayIso());
      return db.prepare('SELECT id, weight_kg AS weightKg, logged_on AS loggedOn FROM weights WHERE id = ?').get(r.lastInsertRowid);
    },
    deleteWeight: (userId, id) => db.prepare('DELETE FROM weights WHERE id = ? AND user_id = ?').run(id, userId).changes > 0,

    // ---------- goals ----------
    getGoal(userId) {
      const g = db.prepare('SELECT daily_calories AS dailyCalories, daily_protein_g AS dailyProteinG, target_weight_kg AS targetWeightKg FROM goals WHERE user_id = ?').get(userId);
      return g ? { ...g, isDefault: false } : { dailyCalories: 2000, dailyProteinG: 60, targetWeightKg: null, isDefault: true };
    },
    putGoal(userId, g) {
      const existed = db.prepare('SELECT 1 FROM goals WHERE user_id = ?').get(userId) !== undefined;
      db.prepare(`INSERT INTO goals (user_id, daily_calories, daily_protein_g, target_weight_kg) VALUES (@userId, @dailyCalories, @dailyProteinG, @targetWeightKg)
                  ON CONFLICT(user_id) DO UPDATE SET daily_calories=excluded.daily_calories, daily_protein_g=excluded.daily_protein_g, target_weight_kg=excluded.target_weight_kg`)
        .run({ userId, dailyCalories: g.dailyCalories, dailyProteinG: g.dailyProteinG, targetWeightKg: g.targetWeightKg ?? null });
      return { goal: svc.getGoal(userId), created: !existed };
    },

    // ---------- daily summary ----------
    dailySummary(userId, date = todayIso()) {
      const t = db.prepare(`SELECT COALESCE(SUM(f.calories * m.servings), 0) AS calories, COALESCE(SUM(f.protein_g * m.servings), 0) AS proteinG,
                                   COALESCE(SUM(f.carbs_g * m.servings), 0) AS carbsG, COALESCE(SUM(f.fat_g * m.servings), 0) AS fatG, COUNT(m.id) AS mealCount
                            FROM meals m JOIN foods f ON f.id = m.food_id WHERE m.user_id = ? AND m.eaten_on = ?`).get(userId, date);
      const byMealType = db.prepare(`SELECT m.meal_type AS mealType, ROUND(SUM(f.calories * m.servings), 1) AS calories
                                     FROM meals m JOIN foods f ON f.id = m.food_id WHERE m.user_id = ? AND m.eaten_on = ?
                                     GROUP BY m.meal_type ORDER BY calories DESC`).all(userId, date);
      const goal = svc.getGoal(userId);
      const w = db.prepare('SELECT weight_kg AS weightKg FROM weights WHERE user_id = ? ORDER BY logged_on DESC, id DESC LIMIT 1').get(userId);
      return {
        date,
        calories: round(t.calories), proteinG: round(t.proteinG), carbsG: round(t.carbsG), fatG: round(t.fatG), mealCount: t.mealCount,
        goalCalories: goal.dailyCalories, goalProteinG: goal.dailyProteinG,
        remainingCalories: round(goal.dailyCalories - t.calories),
        caloriesPercent: round((t.calories / goal.dailyCalories) * 100, 0),
        proteinPercent: round(goal.dailyProteinG ? (t.proteinG / goal.dailyProteinG) * 100 : 0, 0),
        byMealType,
        latestWeightKg: w ? w.weightKg : null,
      };
    },
  };
  return svc;
}

module.exports = { createServices };
