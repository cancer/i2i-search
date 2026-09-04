CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  image TEXT NOT NULL,
  price INTEGER NOT NULL,
  sizes TEXT NOT NULL,
  color TEXT NOT NULL,
  spec TEXT NOT NULL,
  description TEXT NOT NULL
);
