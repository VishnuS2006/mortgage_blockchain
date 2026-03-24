import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'mortgage.db');
const sqlite = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA foreign_keys = ON');

function runRaw(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        lastInsertRowid: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function getRaw(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function allRaw(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

function execRaw(sql) {
  return new Promise((resolve, reject) => {
    sqlite.exec(sql, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

async function objectExists(name, type) {
  const row = await getRaw(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    [type, name]
  );
  return Boolean(row);
}

async function tableExists(name) {
  return objectExists(name, 'table');
}

async function columnExists(table, column) {
  const columns = await allRaw(`PRAGMA table_info(${table})`);
  return columns.some((entry) => entry.name === column);
}

async function addColumnIfMissing(table, column, definition) {
  if (await columnExists(table, column)) {
    return;
  }

  await runRaw(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function normalizeRoleValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'lender' ? 'lender' : 'borrower';
}

async function migrateLegacyUsersTable() {
  if (!(await tableExists('users'))) {
    return;
  }

  await addColumnIfMissing('users', 'role', "role TEXT DEFAULT 'borrower'");
  await addColumnIfMissing('users', 'walletAddress', 'walletAddress TEXT');
  await addColumnIfMissing('users', 'createdAt', 'createdAt DATETIME DEFAULT CURRENT_TIMESTAMP');

  const borrowerCountRow = await getRaw('SELECT COUNT(*) AS count FROM borrowers');
  const legacyUsers = await allRaw(`
    SELECT
      id,
      name,
      LOWER(TRIM(email)) AS email,
      password,
      role,
      walletAddress,
      createdAt
    FROM users
    WHERE email IS NOT NULL
      AND TRIM(email) != ''
  `);

  for (const legacyUser of legacyUsers) {
    const nextRole = normalizeRoleValue(legacyUser.role);
    const nextWalletAddress = String(legacyUser.walletAddress || '').trim() || null;
    const nextCreatedAt = legacyUser.createdAt || new Date().toISOString();

    if ((borrowerCountRow?.count || 0) === 0) {
      await runRaw(`
        INSERT OR IGNORE INTO borrowers (
          id,
          name,
          email,
          password_hash,
          role,
          wallet_address,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        legacyUser.id,
        legacyUser.name,
        legacyUser.email,
        legacyUser.password,
        nextRole,
        nextWalletAddress,
        nextCreatedAt,
      ]);
      continue;
    }

    await runRaw(`
      INSERT INTO borrowers (
        name,
        email,
        password_hash,
        role,
        wallet_address,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        role = COALESCE(NULLIF(excluded.role, ''), borrowers.role),
        wallet_address = COALESCE(excluded.wallet_address, borrowers.wallet_address)
    `, [
      legacyUser.name,
      legacyUser.email,
      legacyUser.password,
      nextRole,
      nextWalletAddress,
      nextCreatedAt,
    ]);
  }
}

async function createUsersCompatibilityView() {
  if (await tableExists('users')) {
    return;
  }

  await execRaw(`
    DROP TRIGGER IF EXISTS users_insert;
    DROP TRIGGER IF EXISTS users_update;
    DROP TRIGGER IF EXISTS users_delete;
    DROP VIEW IF EXISTS users;

    CREATE VIEW users AS
    SELECT
      id,
      name,
      email,
      password_hash AS password,
      COALESCE(role, 'borrower') AS role,
      wallet_address AS walletAddress,
      created_at AS createdAt
    FROM borrowers;

    CREATE TRIGGER users_insert
    INSTEAD OF INSERT ON users
    BEGIN
      INSERT INTO borrowers (
        name,
        email,
        password_hash,
        role,
        wallet_address,
        created_at
      )
      VALUES (
        NEW.name,
        LOWER(TRIM(NEW.email)),
        COALESCE(NEW.password, ''),
        COALESCE(NULLIF(TRIM(NEW.role), ''), 'borrower'),
        NULLIF(TRIM(NEW.walletAddress), ''),
        COALESCE(NEW.createdAt, CURRENT_TIMESTAMP)
      );
    END;

    CREATE TRIGGER users_update
    INSTEAD OF UPDATE ON users
    BEGIN
      UPDATE borrowers
      SET
        name = COALESCE(NEW.name, name),
        email = COALESCE(LOWER(TRIM(NEW.email)), email),
        password_hash = CASE
          WHEN NEW.password IS NULL OR TRIM(NEW.password) = '' THEN password_hash
          ELSE NEW.password
        END,
        role = COALESCE(NULLIF(TRIM(NEW.role), ''), role, 'borrower'),
        wallet_address = CASE
          WHEN NEW.walletAddress IS NULL OR TRIM(NEW.walletAddress) = '' THEN wallet_address
          ELSE NEW.walletAddress
        END,
        created_at = COALESCE(NEW.createdAt, created_at)
      WHERE id = OLD.id;
    END;

    CREATE TRIGGER users_delete
    INSTEAD OF DELETE ON users
    BEGIN
      DELETE FROM borrowers WHERE id = OLD.id;
    END;
  `);
}

async function initializeDatabase() {
  await execRaw(`
    CREATE TABLE IF NOT EXISTS borrowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'borrower',
      wallet_address TEXT,
      wallet_signature TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      borrower_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      price REAL NOT NULL,
      description TEXT,
      image_ipfs TEXT,
      metadata_ipfs TEXT,
      nft_token_id INTEGER,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (borrower_id) REFERENCES borrowers(id)
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      borrower_id INTEGER NOT NULL,
      property_id INTEGER,
      nft_id INTEGER,
      loan_amount REAL NOT NULL,
      interest_rate REAL NOT NULL,
      duration_months INTEGER NOT NULL,
      emi_amount REAL,
      total_payable REAL,
      amount_paid REAL DEFAULT 0,
      remaining_balance REAL,
      status TEXT DEFAULT 'Pending',
      blockchain_loan_id INTEGER,
      tx_hash TEXT,
      lender_id INTEGER,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      approved_at DATETIME,
      rejected_at DATETIME,
      funded_at DATETIME,
      completed_at DATETIME,
      defaulted_at DATETIME,
      last_payment_at DATETIME,
      verification_status TEXT DEFAULT 'pending',
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (borrower_id) REFERENCES borrowers(id),
      FOREIGN KEY (property_id) REFERENCES properties(id),
      FOREIGN KEY (lender_id) REFERENCES borrowers(id),
      FOREIGN KEY (reviewed_by) REFERENCES borrowers(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (loan_id) REFERENCES loans(id)
    );

    CREATE TABLE IF NOT EXISTS emis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      emi_index INTEGER NOT NULL,
      amount REAL NOT NULL,
      due_date DATETIME NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      paid_at DATETIME,
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loan_id, emi_index),
      FOREIGN KEY (loan_id) REFERENCES loans(id)
    );

    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lender_id INTEGER NOT NULL,
      loan_id INTEGER NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      wallet_address TEXT,
      interest_rate REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lender_id) REFERENCES borrowers(id),
      FOREIGN KEY (loan_id) REFERENCES loans(id)
    );
  `);

  await migrateLegacyUsersTable();

  await addColumnIfMissing('borrowers', 'role', "role TEXT NOT NULL DEFAULT 'borrower'");
  await addColumnIfMissing('borrowers', 'wallet_address', 'wallet_address TEXT');
  await addColumnIfMissing('borrowers', 'wallet_signature', 'wallet_signature TEXT');
  await addColumnIfMissing('loans', 'lender_id', 'lender_id INTEGER REFERENCES borrowers(id)');
  await addColumnIfMissing('loans', 'reviewed_by', 'reviewed_by INTEGER REFERENCES borrowers(id)');
  await addColumnIfMissing('loans', 'reviewed_at', 'reviewed_at DATETIME');
  await addColumnIfMissing('loans', 'approved_at', 'approved_at DATETIME');
  await addColumnIfMissing('loans', 'rejected_at', 'rejected_at DATETIME');
  await addColumnIfMissing('loans', 'funded_at', 'funded_at DATETIME');
  await addColumnIfMissing('loans', 'completed_at', 'completed_at DATETIME');
  await addColumnIfMissing('loans', 'defaulted_at', 'defaulted_at DATETIME');
  await addColumnIfMissing('loans', 'last_payment_at', 'last_payment_at DATETIME');
  await addColumnIfMissing('loans', 'verification_status', "verification_status TEXT DEFAULT 'pending'");
  await addColumnIfMissing('loans', 'rejection_reason', 'rejection_reason TEXT');

  await runRaw("UPDATE borrowers SET role = 'borrower' WHERE role IS NULL OR TRIM(role) = ''");

  if (await tableExists('users')) {
    await runRaw("UPDATE users SET role = 'borrower' WHERE role IS NULL OR TRIM(role) = ''");
  }

  await createUsersCompatibilityView();

  await execRaw(`
    CREATE INDEX IF NOT EXISTS idx_borrowers_email ON borrowers(email);
    CREATE INDEX IF NOT EXISTS idx_borrowers_role ON borrowers(role);
    CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_id);
    CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
    CREATE INDEX IF NOT EXISTS idx_loans_reviewed_by ON loans(reviewed_by);
    CREATE INDEX IF NOT EXISTS idx_loans_lender_id ON loans(lender_id);
    CREATE INDEX IF NOT EXISTS idx_emis_loan ON emis(loan_id);
    CREATE INDEX IF NOT EXISTS idx_emis_status ON emis(status);
    CREATE INDEX IF NOT EXISTS idx_emis_due_date ON emis(due_date);
    CREATE INDEX IF NOT EXISTS idx_investments_lender ON investments(lender_id);
    CREATE INDEX IF NOT EXISTS idx_investments_loan ON investments(loan_id);
    CREATE INDEX IF NOT EXISTS idx_investments_status ON investments(status);
  `);
}

await initializeDatabase();

class DatabaseWrapper {
  constructor(sqliteDb) {
    this.db = sqliteDb;
  }

  prepare(sql) {
    return new StatementWrapper(this.db, sql);
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          lastInsertRowid: this.lastID,
          changes: this.changes,
        });
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });
  }
}

class StatementWrapper {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  get(...params) {
    return new Promise((resolve, reject) => {
      this.db.get(this.sql, params, (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(row);
      });
    });
  }

  all(...params) {
    return new Promise((resolve, reject) => {
      this.db.all(this.sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(rows);
      });
    });
  }

  run(...params) {
    return new Promise((resolve, reject) => {
      this.db.run(this.sql, params, function onRun(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          lastInsertRowid: this.lastID,
          changes: this.changes,
        });
      });
    });
  }
}

const db = new DatabaseWrapper(sqlite);

export { allRaw, execRaw, getRaw, runRaw };
export default db;
