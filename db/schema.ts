import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const labSaves = sqliteTable('lab_saves', {
  id: text('id').primaryKey(),
  progress: text('progress'),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});
