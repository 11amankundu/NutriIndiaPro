// NoSQL document store: NeDB (@seald-io/nedb) - an embedded store with the MongoDB query language
// ($in, $lte, $regex, array-contains ...). Collections: "recipes" (flexible nested documents) and "activity" (event log).
const fs = require('fs');
const path = require('path');
const Datastore = require('@seald-io/nedb');

function createNosql(dir) {
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const open = (name) => (dir
    ? new Datastore({ filename: path.join(dir, `${name}.db`), autoload: true })
    : new Datastore({ inMemoryOnly: true }));
  const recipes = open('recipes');
  const activity = open('activity');
  return {
    recipes,
    activity,
    logActivity(userId, type, meta = {}) {
      return activity.insertAsync({ userId, type, meta, at: new Date().toISOString() }).catch(() => {});
    },
  };
}

module.exports = { createNosql };
