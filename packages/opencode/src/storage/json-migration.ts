import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Global } from "../global"
import { Log } from "../util/log"
import { ProjectTable } from "../project/project.sql"
import { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
import { SessionShareTable, ShareTable } from "../share/share.sql"
import path from "path"
import fs from "fs"

const log = Log.create({ service: "json-migration" })

export function migrateFromJson(sqlite: Database, customStorageDir?: string) {
  const storageDir = customStorageDir ?? path.join(Global.Path.data, "storage")
  const migrationMarker = path.join(storageDir, "sqlite-migrated")

  if (fs.existsSync(migrationMarker)) {
    log.info("json migration already completed")
    return
  }

  if (!fs.existsSync(path.join(storageDir, "migration"))) {
    log.info("no json storage found, skipping migration")
    fs.writeFileSync(migrationMarker, Date.now().toString())
    return
  }

  log.info("starting json to sqlite migration", { storageDir })

  const db = drizzle(sqlite)
  const stats = {
    projects: 0,
    sessions: 0,
    messages: 0,
    parts: 0,
    diffs: 0,
    todos: 0,
    permissions: 0,
    shares: 0,
    errors: [] as string[],
  }

  // Run entire migration in a single transaction for performance
  sqlite.run("BEGIN TRANSACTION")

  try {
    // Track existing IDs to avoid repeated DB lookups
    const projectIDs = new Set<string>()
    const sessionIDs = new Set<string>()
    const messageIDs = new Set<string>()

    // Migrate projects first (no FK deps)
    const projectGlob = new Bun.Glob("project/*.json")
    const projectFiles = Array.from(projectGlob.scanSync({ cwd: storageDir, absolute: true }))
    const projectValues: (typeof ProjectTable.$inferInsert)[] = []

    for (const file of projectFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        if (!data.id) {
          stats.errors.push(`project missing id: ${file}`)
          continue
        }
        projectIDs.add(data.id)
        projectValues.push({
          id: data.id,
          worktree: data.worktree ?? "/",
          vcs: data.vcs,
          name: data.name ?? undefined,
          icon_url: data.icon?.url,
          icon_color: data.icon?.color,
          time_created: data.time?.created ?? Date.now(),
          time_updated: data.time?.updated ?? Date.now(),
          time_initialized: data.time?.initialized,
          sandboxes: data.sandboxes ?? [],
        })
      } catch (e) {
        stats.errors.push(`failed to migrate project ${file}: ${e}`)
      }
    }

    if (projectValues.length > 0) {
      db.insert(ProjectTable).values(projectValues).onConflictDoNothing().run()
      stats.projects = projectValues.length
    }
    log.info("migrated projects", { count: stats.projects })

    // Migrate sessions (depends on projects)
    const sessionGlob = new Bun.Glob("session/*/*.json")
    const sessionFiles = Array.from(sessionGlob.scanSync({ cwd: storageDir, absolute: true }))
    const sessionValues: (typeof SessionTable.$inferInsert)[] = []

    for (const file of sessionFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        if (!data.id || !data.projectID) {
          stats.errors.push(`session missing id or projectID: ${file}`)
          continue
        }
        if (!projectIDs.has(data.projectID)) {
          log.warn("skipping orphaned session", { sessionID: data.id, projectID: data.projectID })
          continue
        }
        sessionIDs.add(data.id)
        sessionValues.push({
          id: data.id,
          projectID: data.projectID,
          parentID: data.parentID ?? null,
          slug: data.slug ?? "",
          directory: data.directory ?? "",
          title: data.title ?? "",
          version: data.version ?? "",
          share_url: data.share?.url ?? null,
          summary_additions: data.summary?.additions ?? null,
          summary_deletions: data.summary?.deletions ?? null,
          summary_files: data.summary?.files ?? null,
          summary_diffs: data.summary?.diffs ?? null,
          revert_messageID: data.revert?.messageID ?? null,
          revert_partID: data.revert?.partID ?? null,
          revert_snapshot: data.revert?.snapshot ?? null,
          revert_diff: data.revert?.diff ?? null,
          permission: data.permission ?? null,
          time_created: data.time?.created ?? Date.now(),
          time_updated: data.time?.updated ?? Date.now(),
          time_compacting: data.time?.compacting ?? null,
          time_archived: data.time?.archived ?? null,
        })
      } catch (e) {
        stats.errors.push(`failed to migrate session ${file}: ${e}`)
      }
    }

    if (sessionValues.length > 0) {
      db.insert(SessionTable).values(sessionValues).onConflictDoNothing().run()
      stats.sessions = sessionValues.length
    }
    log.info("migrated sessions", { count: stats.sessions })

    // Migrate messages (depends on sessions)
    const messageGlob = new Bun.Glob("message/*/*.json")
    const messageFiles = Array.from(messageGlob.scanSync({ cwd: storageDir, absolute: true }))
    const messageValues: (typeof MessageTable.$inferInsert)[] = []

    for (const file of messageFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        if (!data.id || !data.sessionID) {
          stats.errors.push(`message missing id or sessionID: ${file}`)
          continue
        }
        if (!sessionIDs.has(data.sessionID)) {
          log.warn("skipping orphaned message", { messageID: data.id, sessionID: data.sessionID })
          continue
        }
        messageIDs.add(data.id)
        const { id, sessionID, role, ...rest } = data
        messageValues.push({ id, sessionID, role, data: rest })
      } catch (e) {
        stats.errors.push(`failed to migrate message ${file}: ${e}`)
      }
    }

    if (messageValues.length > 0) {
      db.insert(MessageTable).values(messageValues).onConflictDoNothing().run()
      stats.messages = messageValues.length
    }
    log.info("migrated messages", { count: stats.messages })

    // Migrate parts (depends on messages)
    const partGlob = new Bun.Glob("part/*/*.json")
    const partFiles = Array.from(partGlob.scanSync({ cwd: storageDir, absolute: true }))
    const partValues: (typeof PartTable.$inferInsert)[] = []

    for (const file of partFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        if (!data.id || !data.messageID) {
          stats.errors.push(`part missing id or messageID: ${file}`)
          continue
        }
        if (!messageIDs.has(data.messageID)) {
          log.warn("skipping orphaned part", { partID: data.id, messageID: data.messageID })
          continue
        }
        const { id, messageID, sessionID: _, type, ...rest } = data
        partValues.push({ id, message_id: messageID, type, data: rest })
      } catch (e) {
        stats.errors.push(`failed to migrate part ${file}: ${e}`)
      }
    }

    if (partValues.length > 0) {
      db.insert(PartTable).values(partValues).onConflictDoNothing().run()
      stats.parts = partValues.length
    }
    log.info("migrated parts", { count: stats.parts })

    // Migrate session diffs (use prepared statement for batch insert)
    const diffGlob = new Bun.Glob("session_diff/*.json")
    const diffFiles = Array.from(diffGlob.scanSync({ cwd: storageDir, absolute: true }))
    const diffStmt = sqlite.prepare("INSERT OR IGNORE INTO session_diff (session_id, data) VALUES (?, ?)")

    for (const file of diffFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        const sessionID = path.basename(file, ".json")
        if (!sessionIDs.has(sessionID)) {
          log.warn("skipping orphaned session_diff", { sessionID })
          continue
        }
        diffStmt.run(sessionID, JSON.stringify(data))
        stats.diffs++
      } catch (e) {
        stats.errors.push(`failed to migrate session_diff ${file}: ${e}`)
      }
    }
    log.info("migrated session diffs", { count: stats.diffs })

    // Migrate todos
    const todoGlob = new Bun.Glob("todo/*.json")
    const todoFiles = Array.from(todoGlob.scanSync({ cwd: storageDir, absolute: true }))
    const todoValues: (typeof TodoTable.$inferInsert)[] = []

    for (const file of todoFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        const sessionID = path.basename(file, ".json")
        if (!sessionIDs.has(sessionID)) {
          log.warn("skipping orphaned todo", { sessionID })
          continue
        }
        todoValues.push({ sessionID, data })
      } catch (e) {
        stats.errors.push(`failed to migrate todo ${file}: ${e}`)
      }
    }

    if (todoValues.length > 0) {
      db.insert(TodoTable).values(todoValues).onConflictDoNothing().run()
      stats.todos = todoValues.length
    }
    log.info("migrated todos", { count: stats.todos })

    // Migrate permissions
    const permGlob = new Bun.Glob("permission/*.json")
    const permFiles = Array.from(permGlob.scanSync({ cwd: storageDir, absolute: true }))
    const permValues: (typeof PermissionTable.$inferInsert)[] = []

    for (const file of permFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        const projectID = path.basename(file, ".json")
        if (!projectIDs.has(projectID)) {
          log.warn("skipping orphaned permission", { projectID })
          continue
        }
        permValues.push({ projectID, data })
      } catch (e) {
        stats.errors.push(`failed to migrate permission ${file}: ${e}`)
      }
    }

    if (permValues.length > 0) {
      db.insert(PermissionTable).values(permValues).onConflictDoNothing().run()
      stats.permissions = permValues.length
    }
    log.info("migrated permissions", { count: stats.permissions })

    // Migrate session shares
    const shareGlob = new Bun.Glob("session_share/*.json")
    const shareFiles = Array.from(shareGlob.scanSync({ cwd: storageDir, absolute: true }))
    const shareValues: (typeof SessionShareTable.$inferInsert)[] = []

    for (const file of shareFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        const sessionID = path.basename(file, ".json")
        if (!sessionIDs.has(sessionID)) {
          log.warn("skipping orphaned session_share", { sessionID })
          continue
        }
        shareValues.push({ sessionID, data })
      } catch (e) {
        stats.errors.push(`failed to migrate session_share ${file}: ${e}`)
      }
    }

    if (shareValues.length > 0) {
      db.insert(SessionShareTable).values(shareValues).onConflictDoNothing().run()
      stats.shares = shareValues.length
    }
    log.info("migrated session shares", { count: stats.shares })

    // Migrate shares (downloaded shared sessions, no FK)
    const share2Glob = new Bun.Glob("share/*.json")
    const share2Files = Array.from(share2Glob.scanSync({ cwd: storageDir, absolute: true }))
    const share2Values: (typeof ShareTable.$inferInsert)[] = []

    for (const file of share2Files) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"))
        const sessionID = path.basename(file, ".json")
        share2Values.push({ sessionID, data })
      } catch (e) {
        stats.errors.push(`failed to migrate share ${file}: ${e}`)
      }
    }

    if (share2Values.length > 0) {
      db.insert(ShareTable).values(share2Values).onConflictDoNothing().run()
    }

    sqlite.run("COMMIT")
  } catch (e) {
    sqlite.run("ROLLBACK")
    throw e
  }

  // Mark migration complete
  fs.writeFileSync(migrationMarker, Date.now().toString())

  log.info("json migration complete", {
    projects: stats.projects,
    sessions: stats.sessions,
    messages: stats.messages,
    parts: stats.parts,
    diffs: stats.diffs,
    todos: stats.todos,
    permissions: stats.permissions,
    shares: stats.shares,
    errorCount: stats.errors.length,
  })

  if (stats.errors.length > 0) {
    log.warn("migration errors", { errors: stats.errors.slice(0, 20) })
  }

  return stats
}
