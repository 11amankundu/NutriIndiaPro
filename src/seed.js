// Seed data: sample Indian foods (approximate per-serving values) + two demo accounts.
const bcrypt = require('bcryptjs');

const FOODS = [
  ['Roti (Chapati)', '1 medium (40 g)', 104, 3.0, 18.0, 2.5],
  ['Steamed Rice', '1 katori (150 g)', 195, 4.0, 43.0, 0.4],
  ['Toor Dal', '1 katori (150 g)', 150, 9.0, 22.0, 3.0],
  ['Rajma', '1 katori (150 g)', 190, 9.5, 28.0, 4.0],
  ['Chole', '1 katori (150 g)', 210, 9.0, 30.0, 6.0],
  ['Paneer Bhurji', '100 g', 260, 16.0, 4.0, 20.0],
  ['Palak Paneer', '1 katori (150 g)', 240, 12.0, 8.0, 18.0],
  ['Idli', '1 piece (40 g)', 58, 2.0, 12.0, 0.4],
  ['Plain Dosa', '1 piece (80 g)', 133, 3.0, 22.0, 3.5],
  ['Sambar', '1 katori (150 g)', 95, 4.5, 14.0, 2.5],
  ['Poha', '1 plate (150 g)', 250, 5.0, 45.0, 5.0],
  ['Upma', '1 plate (150 g)', 230, 5.5, 36.0, 7.0],
  ['Curd (Dahi)', '1 katori (100 g)', 60, 3.5, 4.7, 3.3],
  ['Chicken Curry', '1 katori (150 g)', 240, 22.0, 6.0, 14.0],
  ['Boiled Egg', '1 piece (50 g)', 78, 6.3, 0.6, 5.3],
  ['Banana', '1 medium (120 g)', 105, 1.3, 27.0, 0.4],
  ['Masala Chai', '1 cup (150 ml)', 90, 2.5, 13.0, 3.0],
  ['Aloo Paratha', '1 piece (90 g)', 260, 5.5, 36.0, 10.5],
];

const isoDate = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

function seedFoods(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM foods').get();
  if (n > 0) return;
  const ins = db.prepare('INSERT INTO foods (name, serving_desc, calories, protein_g, carbs_g, fat_g) VALUES (?,?,?,?,?,?)');
  db.transaction(() => FOODS.forEach((f) => ins.run(...f)))();
}

function seedDemo(db, cfg) {
  const addUser = db.prepare('INSERT OR IGNORE INTO users (email, password_hash, name, role) VALUES (?,?,?,?)');
  const accounts = [
    ['admin@nutriindia.test', 'Admin@123', 'Admin', 'admin'],
    ['demo@nutriindia.test', 'Demo@1234', 'Demo User', 'user'],
  ];
  for (const [email, pw, name, role] of accounts) {
    addUser.run(email, bcrypt.hashSync(pw, cfg.bcryptRounds), name, role);
  }
  const demo = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@nutriindia.test');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM meals WHERE user_id = ?').get(demo.id);
  if (n > 0) return;
  const food = (name) => db.prepare('SELECT id FROM foods WHERE name = ?').get(name).id;
  const meal = db.prepare('INSERT INTO meals (user_id, food_id, servings, meal_type, eaten_on) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    for (let off = 0; off >= -2; off--) {
      const d = isoDate(off);
      meal.run(demo.id, food('Poha'), 1, 'breakfast', d);
      meal.run(demo.id, food('Masala Chai'), 1, 'breakfast', d);
      meal.run(demo.id, food('Roti (Chapati)'), 3, 'lunch', d);
      meal.run(demo.id, food('Toor Dal'), 1, 'lunch', d);
      meal.run(demo.id, food('Paneer Bhurji'), 1, 'dinner', d);
    }
    const w = db.prepare('INSERT INTO weights (user_id, weight_kg, logged_on) VALUES (?,?,?)');
    w.run(demo.id, 72.4, isoDate(-14));
    w.run(demo.id, 71.8, isoDate(-7));
    w.run(demo.id, 71.2, isoDate(0));
    db.prepare('INSERT OR REPLACE INTO goals (user_id, daily_calories, daily_protein_g, target_weight_kg) VALUES (?,?,?,?)')
      .run(demo.id, 2000, 60, 70);
  })();
}

module.exports = { seedFoods, seedDemo, isoDate };
