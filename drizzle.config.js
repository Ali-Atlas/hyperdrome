import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

/** @type {import('drizzle-kit').Config} */
const config = {
  dialect: 'postgresql',
  schema: './lib/db/schema.js',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};

export default config;
