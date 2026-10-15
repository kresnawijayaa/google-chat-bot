// Penyimpanan latihan: Neon untuk Vercel, Map untuk lokal tanpa DATABASE_URL.
function createStore(databaseUrl, sqlClient) {
  const memory = new Map();
  const sql = sqlClient || (databaseUrl ? require("@neondatabase/serverless").neon(databaseUrl) : null);
  let ready;
  async function init() {
    if (!sql) return;
    // Satu tabel terpisah dari data hub; dibuat otomatis saat pertama dipakai.
    if (!ready) ready = sql.query(
      "CREATE TABLE IF NOT EXISTS gchat_training_data (kind TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (kind, id))", []
    ).catch(error => { ready = null; throw error; });
    await ready;
  }
  async function get(kind, id) {
    await init();
    if (!sql) return structuredClone(memory.get(kind + ":" + id));
    return (await sql.query("SELECT data FROM gchat_training_data WHERE kind=$1 AND id=$2", [kind, id]))[0]?.data;
  }
  return {
    get,
    async list(kind) {
      await init();
      if (!sql) return [...memory.entries()].filter(([key]) => key.startsWith(kind + ":")).map(([,data]) => structuredClone(data));
      return (await sql.query("SELECT data FROM gchat_training_data WHERE kind=$1 ORDER BY id", [kind])).map(row => row.data);
    },
    async set(kind, id, data) {
      await init();
      if (!sql) { memory.set(kind + ":" + id, structuredClone(data)); return; }
      await sql.query("INSERT INTO gchat_training_data (kind,id,data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (kind,id) DO UPDATE SET data=EXCLUDED.data", [kind,id,JSON.stringify(data)]);
    },
    async patch(kind, id, data) {
      await init();
      if (!sql) {
        const previous = memory.get(kind + ":" + id);
        if (previous) memory.set(kind + ":" + id, {...previous,...data});
        return;
      }
      // Hanya metadata pengiriman yang digabungkan; keputusan paralel tetap utuh.
      await sql.query("UPDATE gchat_training_data SET data=data || $3::jsonb WHERE kind=$1 AND id=$2", [kind,id,JSON.stringify(data)]);
    },
    async decide(id, email, status) {
      await init();
      if (!sql) {
        const approval = memory.get("approval:" + id);
        if (!approval || approval.approverEmail !== email || approval.status !== "PENDING") return;
        const decided = {...approval,status};
        memory.set("approval:" + id, decided);
        return structuredClone(decided);
      }
      const rows = await sql.query(
        "UPDATE gchat_training_data SET data=data || $3::jsonb WHERE kind='approval' AND id=$1 AND data->>'approverEmail'=$2 AND data->>'status'='PENDING' RETURNING data",
        [id,email,JSON.stringify({status})]
      );
      return rows[0]?.data;
    },
  };
}
module.exports = { createStore };
