import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Ensure all connections use UTC session timezone for consistent TIMESTAMP handling
pool.on('connect', (client) => {
  client.query("SET timezone = 'UTC'");
});

// Handle pool errors (keep this - critical for crash prevention)
pool.on('error', (err) => {
  console.error('❌ Database pool error', err);
  process.exit(-1);
});

// Query helper function
export const query = async (text, params) => {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Get a client from the pool for transactions
export const getClient = async () => {
  const client = await pool.connect();
  return client;
};

export default pool;
