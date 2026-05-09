import type { DbClient } from "./types.js";
import type { UserRow, UserIdentityRow, CreateUserInput, CreateUserIdentityInput } from "./domain.js";

export interface UserWithIdentity {
  user: UserRow;
  identity: UserIdentityRow;
}

export interface UserStore {
  upsertUser(input: CreateUserInput): Promise<UserRow>;
  upsertGitHubIdentity(input: CreateUserIdentityInput): Promise<UserIdentityRow>;
  getUserById(id: string): Promise<UserRow | null>;
  findByGitHubUserId(githubUserId: string): Promise<UserWithIdentity | null>;
}

export function makeUserStore(db: DbClient): UserStore {
  return {
    async upsertUser(input) {
      const { rows } = await db.query<UserRow>(
        `INSERT INTO users (id, email, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           email = COALESCE(EXCLUDED.email, users.email),
           display_name = COALESCE(EXCLUDED.display_name, users.display_name),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
         RETURNING *`,
        [input.id, input.email, input.display_name, input.avatar_url],
      );
      if (!rows[0]) throw new Error("upsertUser returned no rows");
      return rows[0];
    },

    async upsertGitHubIdentity(input) {
      const { rows } = await db.query<UserIdentityRow>(
        `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_login)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, provider_user_id) DO UPDATE SET
           provider_login = COALESCE(EXCLUDED.provider_login, user_identities.provider_login),
           user_id = EXCLUDED.user_id
         RETURNING *`,
        [input.user_id, input.provider, input.provider_user_id, input.provider_login],
      );
      if (!rows[0]) throw new Error("upsertGitHubIdentity returned no rows");
      return rows[0];
    },

    async getUserById(id) {
      const { rows } = await db.query<UserRow>(
        `SELECT * FROM users WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },

    async findByGitHubUserId(githubUserId) {
      const { rows: identityRows } = await db.query<UserIdentityRow>(
        `SELECT * FROM user_identities
         WHERE provider = 'github' AND provider_user_id = $1`,
        [githubUserId],
      );
      if (!identityRows[0]) return null;
      const identity = identityRows[0];

      const { rows: userRows } = await db.query<UserRow>(
        `SELECT * FROM users WHERE id = $1`,
        [identity.user_id],
      );
      if (!userRows[0]) return null;
      return { user: userRows[0], identity };
    },
  };
}
