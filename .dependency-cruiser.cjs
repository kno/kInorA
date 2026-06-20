/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-no-outer-layers",
      comment:
        "Domain layer MUST NOT import from apps, infra, frameworks, DB, auth, payment, AI, or Node network modules.",
      severity: "error",
      from: { path: "^packages/domain/src/" },
      to: {
        path: [
          // Relative imports escaping domain → apps or infra
          "/apps/",
          "^apps/",
          "/packages/infra/",
          "^packages/infra/",
          // Node built-in network modules
          "^net$",
          "^http$",
          "^https$",
          "^http2$",
        ],
      },
    },
    {
      name: "domain-no-outer-npm-deps",
      comment:
        "Domain layer MUST NOT depend on framework, DB, auth, payment, AI, or Docker npm packages.",
      severity: "error",
      from: { path: "^packages/domain/src/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "undetermined", "unknown"],
        path: [
          // Frameworks
          "node_modules/.+/fastify/",
          "node_modules/.+/next/",
          "node_modules/.+/react/",
          "node_modules/.+/react-dom/",
          // Database drivers
          "node_modules/.+/pg/",
          "node_modules/.+/mysql/",
          "node_modules/.+/mongodb/",
          "node_modules/.+/sqlite/",
          "node_modules/.+/drizzle/",
          "node_modules/.+/prisma/",
          "node_modules/.+/mongoose/",
          "node_modules/.+/knex/",
          "node_modules/.+/sequelize/",
          "node_modules/.+/typeorm/",
          // Auth
          "node_modules/.+/next-auth/",
          "node_modules/.+/@auth/",
          "node_modules/.+/passport/",
          "node_modules/.+/bcrypt/",
          "node_modules/.+/argon2/",
          // Payments
          "node_modules/.+/stripe/",
          // AI
          "node_modules/.+/openai/",
          "node_modules/.+/@ai-sdk/",
          "node_modules/.+/langchain/",
          // Docker
          "node_modules/.+/dockerode/",
        ],
      },
    },
    {
      name: "domain-no-outer-npm-unresolvable",
      comment:
        "Domain layer MUST NOT depend on framework or infra npm packages even if unresolvable.",
      severity: "error",
      from: { path: "^packages/domain/src/" },
      to: {
        dependencyTypes: ["undetermined", "unknown"],
        couldNotResolve: true,
        pathNot: ["^@kinora/", "^\\."],
      },
    },
    {
      name: "contracts-no-workspace-deps",
      comment:
        "Contracts package MUST NOT depend on any other workspace package.",
      severity: "error",
      from: { path: "^packages/contracts/src/" },
      to: { path: ["^@kinora/"] },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
  },
};