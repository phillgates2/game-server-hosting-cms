/**
 * Tests for the collaborator access model (pure layer).
 *
 * The contract: owner/admin are always full-control; operators may control
 * the process but not manage; viewers may look but not touch; anyone else
 * has no access at all.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  COLLABORATOR_ROLES,
  isCollaboratorRole,
  resolveServerAccess,
  accessCanView,
  accessCanControl,
  accessCanManage,
} from "../src/lib/server-collab";

describe("isCollaboratorRole", () => {
  test("accepts only the two defined roles", () => {
    assert.equal(isCollaboratorRole("viewer"), true);
    assert.equal(isCollaboratorRole("operator"), true);
    assert.equal(isCollaboratorRole("admin"), false);
    assert.equal(isCollaboratorRole("owner"), false);
    assert.equal(isCollaboratorRole(""), false);
    assert.equal(isCollaboratorRole(null), false);
    assert.equal(isCollaboratorRole(42), false);
  });

  test("role set is exactly viewer + operator", () => {
    assert.deepEqual([...COLLABORATOR_ROLES], ["viewer", "operator"]);
  });
});

describe("resolveServerAccess", () => {
  test("admins are owner-level regardless of collaborator rows", () => {
    assert.equal(resolveServerAccess({ isAdmin: true, isOwner: false, collaboratorRole: null }), "owner");
    assert.equal(resolveServerAccess({ isAdmin: true, isOwner: false, collaboratorRole: "viewer" }), "owner");
  });

  test("owners are owner-level regardless of collaborator rows", () => {
    assert.equal(resolveServerAccess({ isAdmin: false, isOwner: true, collaboratorRole: null }), "owner");
    assert.equal(resolveServerAccess({ isAdmin: false, isOwner: true, collaboratorRole: "viewer" }), "owner");
  });

  test("collaborator roles map through; unknown means none", () => {
    assert.equal(resolveServerAccess({ isAdmin: false, isOwner: false, collaboratorRole: "operator" }), "operator");
    assert.equal(resolveServerAccess({ isAdmin: false, isOwner: false, collaboratorRole: "viewer" }), "viewer");
    assert.equal(resolveServerAccess({ isAdmin: false, isOwner: false, collaboratorRole: null }), "none");
  });
});

describe("capability matrix", () => {
  test("everyone with access can view", () => {
    assert.equal(accessCanView("owner"), true);
    assert.equal(accessCanView("operator"), true);
    assert.equal(accessCanView("viewer"), true);
    assert.equal(accessCanView("none"), false);
  });

  test("only owner/operator can control the process", () => {
    assert.equal(accessCanControl("owner"), true);
    assert.equal(accessCanControl("operator"), true);
    assert.equal(accessCanControl("viewer"), false);
    assert.equal(accessCanControl("none"), false);
  });

  test("only owner-level can manage (share/config/delete)", () => {
    assert.equal(accessCanManage("owner"), true);
    assert.equal(accessCanManage("operator"), false);
    assert.equal(accessCanManage("viewer"), false);
    assert.equal(accessCanManage("none"), false);
  });
});
