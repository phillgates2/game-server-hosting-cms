import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { eq } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════
// All permissions in the system, grouped by category
// ═══════════════════════════════════════════════════════════════

export const PERMISSION_CATEGORIES = {
  servers: {
    label: "Game Servers",
    permissions: {
      "servers.view":         "View servers",
      "servers.view.metrics": "View live server metrics",
      "servers.view.logs":    "View server logs",
      "servers.create":       "Create new servers",
      "servers.edit":         "Edit server settings",
      "servers.edit.network": "Edit server networking ports/IP",
      "servers.edit.resources": "Edit CPU/RAM limits",
      "servers.delete":       "Delete servers",
      "servers.start_stop":   "Start and stop servers",
      "servers.restart":      "Restart servers",
      "servers.clone":        "Clone servers",
      "servers.install":      "Install game files",
      "servers.console":      "Access server console",
      "servers.files":        "Browse and edit server files",
      "servers.backup":       "Run server backups",
      "servers.restore":      "Restore server backups",
      "servers.transfer":     "Transfer servers between nodes",
      "servers.schedule":     "Manage server schedules",
    },
  },
  nodes: {
    label: "Nodes",
    permissions: {
      "nodes.view":           "View nodes",
      "nodes.view.metrics":   "View node performance metrics",
      "nodes.create":         "Add new nodes",
      "nodes.edit":           "Edit node settings",
      "nodes.edit.resources": "Edit node capacity limits",
      "nodes.edit.paths":     "Edit node install paths",
      "nodes.delete":         "Delete nodes",
      "nodes.maintenance":    "Put nodes into maintenance mode",
      "nodes.monitor":        "View detailed node telemetry",
      "nodes.ssh":            "Use node SSH diagnostics",
    },
  },
  games: {
    label: "Game Templates",
    permissions: {
      "games.view":           "View installed games",
      "games.templates":      "View game templates",
      "games.install":        "Install game templates",
      "games.uninstall":      "Uninstall game templates",
      "games.edit":           "Edit installed game metadata",
      "games.edit.scripts":   "Edit install/start scripts",
      "games.create_custom":  "Create custom templates",
      "games.import":         "Import templates",
      "games.export":         "Export templates",
      "games.variables":      "Manage template variables",
    },
  },
  users: {
    label: "User Management",
    permissions: {
      "users.view":           "View user list",
      "users.view.private":   "View private account metadata",
      "users.view.detail":    "View detailed user profile data",
      "users.edit":           "Edit user profiles",
      "users.edit.security":  "Edit account security properties",
      "users.delete":         "Delete users",
      "users.roles":          "Change user roles",
      "users.suspend":        "Suspend/ban users",
      "users.create":         "Create users",
      "users.reset_password": "Reset user passwords",
      "users.2fa":            "Manage user 2FA status",
      "users.impersonate":    "Impersonate users",
      "users.limits":         "Manage user resource limits",
    },
  },
  roles: {
    label: "Role Management",
    permissions: {
      "roles.view":           "View roles",
      "roles.create":         "Create new roles",
      "roles.edit":           "Edit roles & permissions",
      "roles.assign":         "Assign roles to users",
      "roles.default":        "Set default signup role",
      "roles.delete":         "Delete roles",
    },
  },
  forum: {
    label: "Forum",
    permissions: {
      "forum.view":           "View forum",
      "forum.post":           "Create threads & replies",
      "forum.thread.edit_own": "Edit own threads",
      "forum.thread.delete_own": "Delete own threads",
      "forum.thread.edit_any": "Edit any thread (mod)",
      "forum.thread.delete_any": "Delete any thread (mod)",
      "forum.thread.pin":     "Pin/unpin threads",
      "forum.thread.lock":    "Lock/unlock threads",
      "forum.edit_own":       "Edit own posts",
      "forum.delete_own":     "Delete own posts",
      "forum.edit_any":       "Edit any post (mod)",
      "forum.delete_any":     "Delete any post (mod)",
      "forum.pin":            "Pin/unpin threads",
      "forum.lock":           "Lock/unlock threads",
      "forum.manage_categories": "Manage forum categories",
      "forum.moderate":       "Use moderation tools",
    },
  },
  ladder: {
    label: "League Ladder",
    permissions: {
      "ladder.view":          "View ladder standings",
      "ladder.view.history":  "View archived ladder history",
      "ladder.create":        "Create ladder entries",
      "ladder.create.entry":  "Create team entries",
      "ladder.edit":          "Edit ladder entries",
      "ladder.edit.entry":    "Edit team identity fields",
      "ladder.edit.stats":    "Edit wins/losses/draws/points",
      "ladder.edit.notes":    "Edit internal ladder notes",
      "ladder.delete":        "Delete ladder entries",
      "ladder.delete.entry":  "Delete team entries",
      "ladder.season":        "Manage seasons and resets",
      "ladder.season.manage": "Create/switch game seasons",
      "ladder.season.reset":  "Reset season standings",
      "ladder.manage.games":  "Move entries between games",
      "ladder.publish":       "Publish featured standings",
      "ladder.import":        "Bulk import standings",
      "ladder.export":        "Export standings",
    },
  },
  cms: {
    label: "CMS / Content",
    permissions: {
      "cms.view":             "View CMS panel",
      "cms.create":           "Create posts",
      "cms.edit":             "Edit posts",
      "cms.edit.published":   "Edit already-published posts",
      "cms.pin":              "Pin/unpin content",
      "cms.delete":           "Delete posts",
      "cms.publish":          "Publish/unpublish posts",
      "cms.media":            "Manage media assets",
    },
  },
  monitor: {
    label: "Monitoring",
    permissions: {
      "monitor.view":         "View system monitor",
      "monitor.clear_cache":  "Clear RAM buffers/cache",
      "monitor.alerts":       "Manage monitor alerts",
      "monitor.history":      "View metric history",
      "monitor.export":       "Export monitoring data",
    },
  },
  database: {
    label: "Database",
    permissions: {
      "database.view":        "View database tables",
      "database.view.schema": "View schema metadata",
      "database.view.rows":   "View table rows",
      "database.edit":        "Edit database rows",
      "database.query":       "Execute SQL queries",
      "database.export":      "Export database data",
      "database.import":      "Import database data",
      "database.schema":      "Manage database schema",
    },
  },
  scheduler: {
    label: "Scheduler",
    permissions: {
      "scheduler.view":       "View scheduler",
      "scheduler.create":     "Create tasks",
      "scheduler.edit":       "Edit tasks",
      "scheduler.delete":     "Delete tasks",
      "scheduler.run":        "Run tasks manually",
      "scheduler.logs":       "View scheduler run logs",
    },
  },
  apikeys: {
    label: "API Keys",
    permissions: {
      "apikeys.view":         "View API keys",
      "apikeys.create":       "Create API keys",
      "apikeys.revoke":       "Revoke API keys",
      "apikeys.scope":        "Manage key scopes",
      "apikeys.rotate":       "Rotate API keys",
    },
  },
  security: {
    label: "Security",
    permissions: {
      "security.audit":       "View security audit logs",
      "security.sessions":    "Manage active sessions",
      "security.settings":    "Manage security settings",
      "security.2fa.enforce": "Enforce 2FA policy",
      "security.tokens":      "Manage auth/API tokens",
    },
  },
  panel: {
    label: "Panel",
    permissions: {
      "panel.settings":       "Change panel settings",
      "panel.discord":        "Manage Discord webhooks",
      "panel.branding":       "Manage panel branding",
      "panel.i18n":           "Manage languages",
      "panel.install":        "Run installer and setup",
      "panel.updates":        "Run panel update operations",
      "panel.search.global":  "Use global cross-resource search",
      "panel.settings.email": "Manage SMTP/test email",
      "panel.settings.export": "Export panel config",
      "panel.settings.import": "Import panel config",
    },
  },
};

// All permission keys as a flat array
export const ALL_PERMISSIONS = Object.values(PERMISSION_CATEGORIES)
  .flatMap((cat) => Object.keys(cat.permissions));

// ═══════════════════════════════════════════════════════════════
// Default role permission sets
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_ROLES = [
  {
    name: "admin",
    displayName: "Administrator",
    color: "#ef4444",
    icon: "🛡️",
    isSystem: true,
    isDefault: false,
    priority: 100,
    permissions: Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true])),
  },
  {
    name: "moderator",
    displayName: "Moderator",
    color: "#a855f7",
    icon: "⚔️",
    isSystem: true,
    isDefault: false,
    priority: 50,
    permissions: {
      "servers.view": true, "servers.create": true, "servers.edit": true,
      "servers.start_stop": true, "servers.restart": true, "servers.clone": true,
      "servers.install": true, "servers.files": true,
      "nodes.view": true, "nodes.monitor": true,
      "games.view": true, "games.templates": true, "games.variables": true,
      "users.view": true, "users.suspend": true, "users.limits": true,
      "users.view.detail": true,
      "forum.view": true, "forum.post": true, "forum.edit_own": true,
      "forum.delete_own": true, "forum.edit_any": true, "forum.delete_any": true,
      "forum.pin": true, "forum.lock": true, "forum.moderate": true,
      "forum.thread.edit_own": true, "forum.thread.delete_own": true,
      "forum.thread.edit_any": true, "forum.thread.delete_any": true,
      "forum.thread.pin": true, "forum.thread.lock": true,
      "ladder.view": true, "ladder.view.history": true, "ladder.create": true, "ladder.create.entry": true,
      "ladder.edit": true, "ladder.edit.entry": true, "ladder.edit.stats": true, "ladder.edit.notes": true,
      "ladder.season": true, "ladder.season.manage": true, "ladder.publish": true,
      "cms.view": true, "cms.create": true, "cms.edit": true, "cms.publish": true, "cms.pin": true,
      "monitor.view": true, "monitor.history": true,
      "scheduler.view": true,
      "apikeys.view": true, "apikeys.create": true,
      "security.audit": true,
      "panel.search.global": true,
    },
  },
  {
    name: "user",
    displayName: "User",
    color: "#3b82f6",
    icon: "👤",
    isSystem: true,
    isDefault: true,
    priority: 0,
    permissions: {
      "servers.view": true, "servers.create": true, "servers.start_stop": true,
      "games.view": true, "games.templates": true,
      "forum.view": true, "forum.post": true, "forum.edit_own": true, "forum.delete_own": true,
      "monitor.view": true,
      "ladder.view": true,
      "scheduler.view": true,
      "apikeys.view": true, "apikeys.create": true,
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// Permission checking
// ═══════════════════════════════════════════════════════════════

// Cache roles in memory to avoid DB lookups on every request
let roleCache: Map<number, Record<string, boolean>> | null = null;
let roleCacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

export async function getRolePermissions(roleId: number): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (roleCache && now - roleCacheTime < CACHE_TTL) {
    const cached = roleCache.get(roleId);
    if (cached) return cached;
  }

  // Rebuild cache
  try {
    const allRoles = await db.select({ id: roles.id, permissions: roles.permissions }).from(roles);
    roleCache = new Map();
    for (const r of allRoles) {
      roleCache.set(r.id, (r.permissions || {}) as Record<string, boolean>);
    }
    roleCacheTime = now;
    return roleCache.get(roleId) || {};
  } catch {
    return {};
  }
}

export async function getUserPermissions(userId: number): Promise<Record<string, boolean>> {
  try {
    const [user] = await db
      .select({ role: users.role, roleId: users.roleId, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return {};

    // Tokens live for 7 days, so status was previously only enforced at login:
    // suspending or banning a signed-in user did nothing until their token
    // expired. Denying every permission revokes access on the next request.
    if (user.status !== "active") return {};

    // Legacy admin check — "admin" role gets everything
    if (user.role === "admin") {
      return Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true]));
    }

    // If user has a roleId, use it
    if (user.roleId) {
      return getRolePermissions(user.roleId);
    }

    // Fallback to legacy role name
    const legacyMap: Record<string, Record<string, boolean>> = {
      moderator: DEFAULT_ROLES.find((r) => r.name === "moderator")!.permissions,
      user: DEFAULT_ROLES.find((r) => r.name === "user")!.permissions,
    };

    return legacyMap[user.role] || legacyMap.user;
  } catch {
    return {};
  }
}

export async function hasPermission(userId: number, permission: string): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return perms[permission] === true;
}

export async function hasAnyPermission(userId: number, permissions: string[]): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return permissions.some((permission) => perms[permission] === true);
}

export function invalidateRoleCache() {
  roleCache = null;
}
