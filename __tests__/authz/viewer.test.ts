import {
  AuthzError,
  isOwner,
  requireOwner,
  requireScope,
  type Viewer,
} from "@/lib/authz/viewer";

const owner: Viewer = { userId: "u1", effectiveUserId: "u1", grant: null };
const grantViewer: Viewer = {
  userId: "coach",
  effectiveUserId: "athlete",
  grant: { id: "g1", ownerId: "athlete", granteeId: "coach", scopes: ["health", "exercises"] },
};

describe("isOwner / requireOwner", () => {
  it("owner viewer passes requireOwner", () => {
    expect(isOwner(owner)).toBe(true);
    expect(requireOwner(owner)).toBe(owner);
  });

  it("grant viewer is rejected by requireOwner with 403", () => {
    expect(isOwner(grantViewer)).toBe(false);
    try {
      requireOwner(grantViewer);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthzError);
      expect((e as AuthzError).status).toBe(403);
    }
  });
});

describe("requireScope", () => {
  it("owner always passes any scope", () => {
    expect(() => requireScope(owner, "labs")).not.toThrow();
  });

  it("grant viewer passes scopes included in the grant", () => {
    expect(() => requireScope(grantViewer, "exercises")).not.toThrow();
    expect(() => requireScope(grantViewer, "health")).not.toThrow();
  });

  it("grant viewer gets 404 (not 403) for missing scopes — no existence leaks", () => {
    try {
      requireScope(grantViewer, "labs");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthzError);
      expect((e as AuthzError).status).toBe(404);
    }
  });
});
