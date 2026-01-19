import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { MessageV2 } from "./message-v2"
import type { Snapshot } from "@/snapshot"
import type { Todo } from "./todo"
import type { PermissionNext } from "@/permission/next"

export const SessionTable = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    projectID: text("project_id")
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    parentID: text("parent_id"),
    slug: text("slug").notNull(),
    directory: text("directory").notNull(),
    title: text("title").notNull(),
    version: text("version").notNull(),
    share_url: text("share_url"),
    summary_additions: integer("summary_additions"),
    summary_deletions: integer("summary_deletions"),
    summary_files: integer("summary_files"),
    summary_diffs: text("summary_diffs", { mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert_messageID: text("revert_message_id"),
    revert_partID: text("revert_part_id"),
    revert_snapshot: text("revert_snapshot"),
    revert_diff: text("revert_diff"),
    permission: text("permission", { mode: "json" }).$type<PermissionNext.Ruleset>(),
    time_created: integer("time_created").notNull(),
    time_updated: integer("time_updated").notNull(),
    time_compacting: integer("time_compacting"),
    time_archived: integer("time_archived"),
  },
  (table) => [index("session_project_idx").on(table.projectID), index("session_parent_idx").on(table.parentID)],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    sessionID: text("session_id")
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageV2.Info["role"]>().notNull(),
    data: text("data", { mode: "json" }).notNull().$type<Omit<MessageV2.Info, "id" | "sessionID" | "role">>(),
  },
  (table) => [index("message_session_idx").on(table.sessionID)],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text("id").primaryKey(),
    message_id: text("message_id")
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    type: text("type").$type<MessageV2.Part["type"]>().notNull(),
    data: text("data", { mode: "json" })
      .notNull()
      .$type<Omit<MessageV2.Part, "id" | "messageID" | "sessionID" | "type">>(),
  },
  (table) => [index("part_message_idx").on(table.message_id)],
)

export const SessionDiffTable = sqliteTable(
  "session_diff",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    file: text().notNull(),
    before: text().notNull(),
    after: text().notNull(),
    additions: integer().notNull(),
    deletions: integer().notNull(),
  },
  (table) => [index("session_diff_session_idx").on(table.session_id)],
)

export const TodoTable = sqliteTable("todo", {
  sessionID: text("session_id")
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull().$type<Todo.Info[]>(),
})

export const PermissionTable = sqliteTable("permission", {
  projectID: text("project_id")
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull().$type<PermissionNext.Ruleset>(),
})
