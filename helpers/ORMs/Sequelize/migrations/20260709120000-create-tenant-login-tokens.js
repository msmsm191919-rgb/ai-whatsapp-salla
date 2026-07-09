"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableExists = await queryInterface.tableExists("TenantLoginTokens");
    if (!tableExists) {
      await queryInterface.createTable("TenantLoginTokens", {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        tenant_id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: {
            model: "Tenants",
            key: "id"
          },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        token_hash: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true
        },
        purpose: {
          type: Sequelize.STRING,
          defaultValue: "login",
          allowNull: false
        },
        expires_at: {
          type: Sequelize.DATE,
          allowNull: false
        },
        used_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        revoked_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
        }
      });

      // Add index on tenant_id, purpose, expires_at
      await queryInterface.addIndex("TenantLoginTokens", ["tenant_id", "purpose", "expires_at"], {
        name: "idx_tenant_purpose_expires"
      });
      console.log("✅ Table TenantLoginTokens created successfully.");
    } else {
      console.log("⚠️ Table TenantLoginTokens already exists. Baseline schema matched, skipping creation.");
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("TenantLoginTokens");
  }
};
