"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
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
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("TenantLoginTokens");
  }
};
