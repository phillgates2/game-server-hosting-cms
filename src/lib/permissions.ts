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
      "servers.create":       "Create new servers",
      "servers.edit":         "Edit server settings",
      "servers.delete":       "Delete servers",
      "servers.start_stop":   "Start and stop servers",
      "servers.install":      "Install game files",
      "servers.console":      "Access server console",
      "servers.files":        "Browse and edit server files",
    },
  },
  nodes: {
    label: "Nodes",
    permissions: {
      "nodes.view":           "View nodes",
      "nodes.create":         "Add new nodes",
      "nodes.edit":           "Edit node settings",
      "nodes.delete":         "Delete nodes",
    },
  },
  games: {
    label: "Game Templates",
    permissions: {
      "games.view":           "View installed games",
      "games.templates":      "View game templates",
      "games.install":        "Install game templates",
      "games.uninstall":      "Uninstall game templates",
    },
  },
  users: {
    label: "User Management",
    permissions: {
      "users.view":           "View user list",
      "users.edit":           "Edit user profiles",
      "users.delete":         "Delete users",
      "users.roles":          "Change user roles",
      "users.suspend":        "Suspend/ban users",
    },
  },
  roles: {
    label: "Role Management",
    permissions: {
      "roles.view":           "View roles",
      "roles.create":         "Create new roles",
      "roles.edit":           "Edit roles & permissions",
      "roles.delete":         "Delete roles",
    },
  },
  forum: {
    label: "Forum",
    permissions: {
      "forum.view":           "View forum",
      "forum.post":           "Create threads & replies",
      "forum.edit_own":       "Edit own posts",
      "forum.delete_own":     "Delete own posts",
      "forum.edit_any":       "Edit any post (mod)",
      "forum.delete_any":     "Delete any post (mod)",
      "forum.pin":            "Pin/unpin threads",
      "forum.lock":           "Lock/unlock threads",
    },
  },
  cms: {
    label: "CMS / Content",
    permissions: {
      "cms.view":             "View CMS panel",
      "cms.create":           "Create posts",
      "cms.edit":             "Edit posts",
      "cms.delete":           "Delete posts",
      "cms.publish":          "Publish/unpublish posts",
    },
  },
  monitor: {
    label: "Monitoring",
    permissions: {
      "monitor.view":         "View system monitor",
      "monitor.clear_cache":  "Clear RAM buffers/cache",
    },
  },
  database: {
    label: "Database",
    permissions: {
      "database.view":        "View database tables",
      "database.edit":        "Edit database rows",
      "database.query":       "Execute SQL queries",
    },
  },
  panel: {
    label: "Panel",
    permissions: {
      "panel.settings":       "Change panel settings",
      "panel.discord":        "Manage Discord webhooks",
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
      "servers.start_stop": true, "servers.install": true, "servers.files": true,
      "nodes.view": true,
      "games.view": true, "games.templates": true,
      "users.view": true, "users.suspend": true,
      "forum.view": true, "forum.post": true, "forum.edit_own": true,
      "forum.delete_own": true, "forum.edit_any": true, "forum.delete_any": true,
      "forum.pin": true, "forum.lock": true,
      "cms.view": true, "cms.create": true, "cms.edit": true, "cms.publish": true,
      "monitor.view": true,
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
      .select({ role: users.role, roleId: users.roleId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return {};

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

export function invalidateRoleCache() {
  roleCache = null;
}
