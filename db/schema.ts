import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  floor: text("floor").notNull(),
  building: text("building").notNull().default("본관"),
  annotation: text("annotation").notNull().default(""),
  mapX: real("map_x"),
  mapY: real("map_y"),
  elevatorGroup: text("elevator_group"),
  nodeType: text("node_type").notNull(),
  image8k: text("image_8k").notNull(),
  image4k: text("image_4k").notNull(),
  thumb: text("thumb"),
  originalKey: text("original_key"),
  initialYaw: real("initial_yaw").notNull().default(0),
  initialPitch: real("initial_pitch").notNull().default(0),
  imageYaw: real("image_yaw").notNull().default(0),
  imagePitch: real("image_pitch").notNull().default(0),
  locationConfirmed: integer("location_confirmed").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const links = sqliteTable("links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromScene: text("from_scene").notNull(),
  toScene: text("to_scene").notNull(),
  yaw: real("yaw").notNull(),
  pitch: real("pitch").notNull().default(-18),
  // 0: not placed, 1: estimated legacy direction, 2: exact creator placement.
  positioned: integer("positioned").notNull().default(1),
  label: text("label").notNull(),
  kind: text("kind").notNull().default("walk"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_links_from_scene").on(table.fromScene),
  uniqueIndex("idx_links_unique_position").on(table.fromScene, table.toScene, table.yaw, table.pitch),
]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const hiddenDemoLinks = sqliteTable("hidden_demo_links", {
  id: integer("id").primaryKey(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  ipHash: text("ip_hash").primaryKey(),
  windowStartedAt: integer("window_started_at").notNull(),
  count: integer("count").notNull().default(0),
});
