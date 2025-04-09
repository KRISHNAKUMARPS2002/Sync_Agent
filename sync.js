#!/usr/bin/env node

const odbc = require("odbc");
const { Client } = require("pg");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

function log(message) {
  const time = new Date().toISOString();
  const logMsg = `[${time}] ${message}\n`;
  fs.appendFileSync(path.join(__dirname, "sync.log"), logMsg);
  console.log(logMsg.trim());
}

function safeStr(value, maxLength) {
  return typeof value === "string" ? value.substring(0, maxLength) : value;
}

async function syncProcess() {
  log("Starting sync...");

  let odbcConn, pgClient;

  try {
    // Connect to SQL Anywhere
    odbcConn = await odbc.connect(
      `DSN=${process.env.REMOTE_DSN};Uid=${process.env.REMOTE_DB_USER};Pwd=${process.env.REMOTE_DB_PASS};`
    );

    // Fetch data from SQL Anywhere
    const rrc_clients_data = await odbcConn.query(`
      SELECT code, name, address, branch
      FROM rrc_clients
      WHERE branch IN ('RITS Wayanad', 'IMC', 'IMC Mukkam');
    `);
    const acc_users_data = await odbcConn.query(`SELECT * FROM acc_users;`);

    // Connect to PostgreSQL
    pgClient = new Client({
      host: process.env.WEB_DB_HOST,
      port: process.env.WEB_DB_PORT,
      user: process.env.WEB_DB_USER,
      password: process.env.WEB_DB_PASS,
      database: process.env.WEB_DB_NAME,
    });
    await pgClient.connect();

    // TRUNCATE rrc_clients only
    await pgClient.query(
      "TRUNCATE TABLE rrc_clients RESTART IDENTITY CASCADE;"
    );

    // Insert into rrc_clients
    for (const row of rrc_clients_data) {
      await pgClient.query(
        `INSERT INTO rrc_clients(code, name, address, branch) VALUES ($1, $2, $3, $4)`,
        [
          safeStr(row.code, 5),
          safeStr(row.name, 100),
          safeStr(row.address, 200),
          safeStr(row.branch, 100),
        ]
      );
    }

    // UPSERT acc_users: Insert or Update by id
    for (const row of acc_users_data) {
      await pgClient.query(
        `INSERT INTO acc_users(id, username, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, role = EXCLUDED.role;`,
        [row.id, row.username, row.role]
      );
    }

    log(
      `Synced ${rrc_clients_data.length} rrc_clients and ${acc_users_data.length} acc_users (upserted).`
    );
  } catch (err) {
    log(`Error during sync: ${err.message}`);
  } finally {
    if (odbcConn) await odbcConn.close().catch(() => {});
    if (pgClient) await pgClient.end().catch(() => {});
  }
}

// Set interval
const interval = (parseInt(process.env.SYNC_INTERVAL, 10) || 20) * 1000;
setInterval(syncProcess, interval);

// Run once immediately
syncProcess();
